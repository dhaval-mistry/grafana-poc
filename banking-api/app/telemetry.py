"""configure *only* the banking API's three telemetry signals.

Telemetry is opt-in (OTEL_ENABLED=true). All exporters send to internal Alloy.
Avoid logging request bodies, raw paths, HTTP headers, SQL parameters or exceptions.
"""

import logging
import os
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from fastapi import HTTPException
import psycopg
from app.request_context import get_correlation_id

from fastapi import Request
from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.trace import Status, StatusCode

# Request context validates caller IDs and generates missing/invalid IDs.
# Lower cardinality HTTP route templates (not /accounts/<uuid>) are safe for metrics.
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "synthetic-banking-api")
ENABLED = os.getenv("OTEL_ENABLED", "false").lower() == "true"
OTLP_BASE = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy:4318").rstrip("/")

_logger = logging.getLogger("banking.observability")
_request_count = None
_request_duration = None
_payment_count = None
_business_metrics = {}

BUSINESS_ROUTES = {
    "/api/v1/auth/token": ("login.authenticate", "login"),
    "/api/v1/accounts/lookup": ("recipient.verify", "transfer"),
    "/api/v1/payments": ("payment.process", "transfer"),
}
BUSINESS_SPANS = {value[0] for value in BUSINESS_ROUTES.values()} | {
    "payment.validate_accounts", "payment.validate_balance", "payment.persist", "payment.commit",
}
FAILURE_CATEGORIES = {
    "authentication", "validation", "not_found", "insufficient_funds", "database", "internal",
}


@dataclass
class BusinessContext:
    stage: str
    journey: str
    failure: str | None = None
    replayed: bool = False
    payment_completed: bool = False


_business_context = ContextVar("business_observation", default=None)


def failure_category(error):
    """Classify by type/status only; never inspect or export exception text."""
    if isinstance(error, (psycopg.Error, OSError)):
        return "database"
    if isinstance(error, HTTPException):
        return category_for_status(error.status_code)
    return "internal"


def category_for_status(status):
    if status in {401, 403, 429}:
        return "authentication"
    if status == 404:
        return "not_found"
    if status in {400, 409, 422}:
        return "validation"
    if status == 503:
        return "database"
    return "internal"


def mark_business_failure(category):
    context = _business_context.get()
    if context is not None and category in FAILURE_CATEGORIES:
        context.failure = category


def mark_payment_outcome(*, replayed, rejected):
    """Called only after the original transaction context has committed."""
    context = _business_context.get()
    if context is not None:
        context.replayed = replayed
        context.payment_completed = not rejected
        if rejected:
            context.failure = "insufficient_funds"
            context.stage = "payment.validate_balance"


def fail_span(span, category):
    span.set_attribute("outcome", "failure")
    span.set_attribute("failure.category", category)
    span.set_status(Status(StatusCode.ERROR))


@contextmanager
def business_span(name):
    """Only controlled attributes; disable SDK exception/stacktrace capture."""
    if not ENABLED:
        yield trace.INVALID_SPAN
        return
    context = _business_context.get()
    attrs = {"journey.type": context.journey if context else "transfer", "journey.stage": name}
    correlation_id = get_correlation_id()
    if correlation_id:
        attrs["correlation_id"] = correlation_id
    with trace.get_tracer("banking.business").start_as_current_span(
        name, attributes=attrs, record_exception=False, set_status_on_exception=False,
    ) as span:
        span.set_attribute("outcome", "success")
        try:
            yield span
        except Exception as error:
            if context is not None:
                context.stage = name
            fail_span(span, failure_category(error))
            raise


class PaymentTransaction:
    """Observe the original context manager's exit without changing its semantics."""
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection.__enter__()

    def __exit__(self, exc_type, exc_value, traceback):
        with business_span("payment.commit") as span:
            if exc_type is not None:
                fail_span(span, failure_category(exc_value))
            return self.connection.__exit__(exc_type, exc_value, traceback)


class SafeSpanExporter(SpanExporter):
    """Filter automatic DB/HTTP/exception details before the existing OTLP exporter."""
    SAFE_ATTRIBUTES = {
        "correlation_id", "banking.correlation_id", "journey.type", "journey.stage",
        "outcome", "failure.category", "http.method", "http.request.method",
        "http.status_code", "http.response.status_code", "http.route",
        "db.system", "db.system.name", "db.operation", "db.operation.name",
    }
    SAFE_ROUTES = {
        "/health", "/api/v1/auth/activate", "/api/v1/auth/token",
        "/api/v1/customers/me", "/api/v1/accounts", "/api/v1/accounts/lookup",
        "/api/v1/accounts/{account_id}/transactions", "/api/v1/payments",
        "/api/v1/payments/{payment_id}",
    }

    def __init__(self, exporter):
        self.exporter = exporter

    def export(self, spans):
        safe = []
        for span in spans:
            attrs = {key: value for key, value in (span.attributes or {}).items()
                     if key in self.SAFE_ATTRIBUTES}
            if attrs.get("http.route") not in self.SAFE_ROUTES:
                attrs.pop("http.route", None)
            for key in ("db.operation", "db.operation.name"):
                if attrs.get(key) not in {"SELECT", "INSERT", "UPDATE", "DELETE", "COMMIT", "ROLLBACK"}:
                    attrs.pop(key, None)
            for key in ("http.method", "http.request.method"):
                if key in attrs and attrs[key] not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
                    attrs[key] = "OTHER"
            operation = span.name.split(maxsplit=1)[0].upper()
            if span.name in BUSINESS_SPANS:
                name = span.name
            elif span.kind == trace.SpanKind.SERVER:
                method = attrs.get("http.method", attrs.get("http.request.method", "HTTP"))
                name = f"{method} {attrs.get('http.route', 'request')}"
            elif "db.system" in attrs or "db.system.name" in attrs:
                name = operation if operation in {"SELECT", "INSERT", "UPDATE", "DELETE", "COMMIT", "ROLLBACK"} else "database.operation"
            else:
                name = "operation"
            safe.append(ReadableSpan(
                name=name, context=span.context, parent=span.parent,
                resource=span.resource, attributes=attrs, kind=span.kind,
                status=Status(span.status.status_code),
                start_time=span.start_time, end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope,
                # Exception events, link attributes, SQL, raw URLs and status
                # descriptions can carry data; none are needed for this step.
            ))
        return self.exporter.export(safe)

    def shutdown(self):
        return self.exporter.shutdown()

    def force_flush(self, timeout_millis=30000):
        return self.exporter.force_flush(timeout_millis)


def configure_telemetry():
    """Call exactly once, before constructing/instrumenting the FastAPI app."""
    global _request_count, _request_duration, _payment_count
    if not ENABLED:
        return

    resource = Resource.create({"service.name": SERVICE_NAME, "deployment.environment.name": "local-lab"})

    # Traces: 1 API request span with child PostgreSQL spans. Never add SQL arguments.
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(
        SafeSpanExporter(OTLPSpanExporter(endpoint=f"{OTLP_BASE}/v1/traces", timeout=5))
    ))
    trace.set_tracer_provider(tracer_provider)
    PsycopgInstrumentor().instrument()

    # Metrics: cumulative low-cardinality counters + histogram; no account IDs.
    metrics_provider = MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint=f"{OTLP_BASE}/v1/metrics", timeout=5),
            export_interval_millis=10000,
        )],
    )
    metrics.set_meter_provider(metrics_provider)
    meter = metrics.get_meter("banking-api")
    _request_count = meter.create_counter("banking.api.requests", unit="{request}")
    _request_duration = meter.create_histogram("banking.api.duration", unit="s")
    _payment_count = meter.create_counter("banking.payment.requests", unit="{request}")
    configure_business_metrics(meter)

    # Logs: attach an exporter to ONE dedicated, allowlisted logger only.
    # Do not attach to root: framework/DB logs can contain unsafe exception details.
    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(
        OTLPLogExporter(endpoint=f"{OTLP_BASE}/v1/logs", timeout=5)
    ))
    set_logger_provider(logger_provider)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False
    _logger.addHandler(LoggingHandler(level=logging.INFO, logger_provider=logger_provider))


def configure_business_metrics(meter):
    for name in (
        "login.attempts", "login.success", "login.failure", "transfer.attempts",
        "transfer.success", "transfer.failure", "recipient.verification.failure",
    ):
        _business_metrics[name] = meter.create_counter(f"banking.{name}", unit="{request}")
    for name in ("login.duration", "payment.duration"):
        _business_metrics[name] = meter.create_histogram(f"banking.{name}", unit="s")


def instrument_api(app):
    """Add FastAPI spans after registering ordinary app middleware/routers."""
    if ENABLED:
        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="/health,/docs,/openapi.json,/redoc",
            exclude_spans=["receive", "send"],
        )


async def telemetry_middleware(request: Request, call_next):
    if not ENABLED:
        return await call_next(request)
    # Keep the existing server-span correlation attribute before opening a child.
    server_span = trace.get_current_span()
    correlation_id = get_correlation_id()
    if server_span.is_recording() and correlation_id:
        server_span.set_attribute("banking.correlation_id", correlation_id)
    business = BUSINESS_ROUTES.get(request.url.path) if request.method == "POST" else None
    if business is None:
        return await _observe_http(request, call_next)
    name, journey = business
    context = BusinessContext(name, journey)
    token = _business_context.set(context)
    try:
        with business_span(name):
            return await _observe_http(request, call_next)
    finally:
        _business_context.reset(token)


def _metric(name, value, attributes, *, histogram=False):
    instrument = _business_metrics.get(name)
    if instrument is not None:
        (instrument.record if histogram else instrument.add)(value, attributes)


def _finish_business(request, status_code, elapsed):
    context = _business_context.get()
    if context is None:
        return
    failed = context.failure is not None or status_code >= 400
    category = context.failure or category_for_status(status_code)
    outcome = "failure" if failed else "success"
    span = trace.get_current_span()
    span.set_attribute("outcome", outcome)
    if failed:
        fail_span(span, category)
    labels = {"journey": context.journey, "outcome": outcome}
    if failed:
        labels["failure_type"] = category
    route = request.url.path
    if route == "/api/v1/auth/token":
        _metric("login.attempts", 1, {"journey": "login"})
        _metric(f"login.{outcome}", 1, labels)
        _metric("login.duration", elapsed, labels, histogram=True)
    elif route == "/api/v1/payments":
        _metric("transfer.attempts", 1, {"journey": "transfer"})
        if not context.replayed and (failed or context.payment_completed):
            _metric(f"transfer.{outcome}", 1, labels)
        _metric("payment.duration", elapsed, labels, histogram=True)
    elif failed:
        _metric("recipient.verification.failure", 1, labels)
    if failed:
        ctx = span.get_span_context()
        _logger.info("business_operation_failed", extra={
            "correlation_id": get_correlation_id() or "",
            "trace_id": format(ctx.trace_id, "032x") if ctx.is_valid else "",
            "journey.type": context.journey,
            "journey.stage": context.stage,
            "outcome": "failure",
            "failure.category": category,
        })


async def _observe_http(request: Request, call_next):
    """Capture safe metadata once per request, including failures.

    Never place a correlation ID on metric labels. HTTP route templates are
    discovered *after* routing so a customer/account UUID is never a label.
    """
    if not ENABLED:
        return await call_next(request)

    started = time.monotonic()
    correlation_id = get_correlation_id()
    span = trace.get_current_span()
    if span.is_recording():
        span.set_attribute("banking.correlation_id", correlation_id)

    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        # Avoid exception text: it may contain SQL details or user input.
        status_code = 500
        _record(request, correlation_id, status_code, time.monotonic() - started)
        _finish_business(request, status_code, time.monotonic() - started)
        raise

    response.headers["X-Correlation-ID"] = correlation_id
    _record(request, correlation_id, status_code, time.monotonic() - started)
    _finish_business(request, status_code, time.monotonic() - started)
    return response


def _record(request, correlation_id, status_code, elapsed):
    """Aggregate by *template* and status; log per-request IDs separately."""
    route = request.scope.get("route")
    route_template = getattr(route, "path", "UNMATCHED")
    # Defense in depth: no arbitrary route path can become a telemetry field.
    if not isinstance(route_template, str) or not re.fullmatch(r"[/{}a-zA-Z0-9_-]{1,120}", route_template):
        route_template = "UNMATCHED"
    method = request.method if request.method in {"GET", "POST", "PUT", "PATCH", "DELETE"} else "OTHER"
    attrs = {"http_route": route_template, "http_method": method, "http_status": str(status_code)}
    _request_count.add(1, attrs)
    _request_duration.record(elapsed, attrs)

    # Count outcomes by HTTP status only. Do not inspect a response body, which
    # might contain protected payment or identity data.
    if route_template == "/api/v1/payments" and method == "POST":
        _payment_count.add(1, {"http_status": str(status_code)})

    current_span = trace.get_current_span()
    ctx = current_span.get_span_context()
    trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else ""
    _logger.info("api_request_completed", extra={
        "correlation_id": correlation_id,
        "trace_id": trace_id,
        "http_route": route_template,
        "http_method": method,
        "http_status": status_code,
        "duration_ms": round(elapsed * 1000, 2),
    })
