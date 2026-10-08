"""Business telemetry acceptance tests with real middleware and in-memory signals.

Database/auth dependencies are mocked; no lab records or credentials are used.
Run separately from test_request_context because OTel providers are process-global.
"""
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
import os
import socket
from threading import Thread
import time
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import UUID

os.environ["OTEL_ENABLED"] = "false"

from fastapi import HTTPException
import psycopg
import uvicorn
from opentelemetry import trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import Event, ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Status, StatusCode

from app import accounts, auth, main, payments, telemetry
from app.security import get_current_customer

CUSTOMER = UUID("10000000-0000-4000-8000-000000000001")
SOURCE = UUID("20000000-0000-4000-8000-000000000001")
DESTINATION = UUID("20000000-0000-4000-8000-000000000002")
USER = UUID("30000000-0000-4000-8000-000000000001")
PAYMENT = UUID("40000000-0000-4000-8000-000000000001")
KEY = "private-idempotency-key-001"
NOW = datetime.now(timezone.utc)


class CaptureLogs(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def connection_with(rows):
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.__exit__.return_value = False
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = rows
    return connection, cursor


class BusinessTelemetryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.exporter = InMemorySpanExporter()
        cls.provider = TracerProvider()
        cls.provider.add_span_processor(SimpleSpanProcessor(telemetry.SafeSpanExporter(cls.exporter)))
        trace.set_tracer_provider(cls.provider)
        cls.reader = InMemoryMetricReader()
        cls.meter_provider = MeterProvider(metric_readers=[cls.reader])
        telemetry.configure_business_metrics(cls.meter_provider.get_meter("business-test"))
        telemetry._request_count = Mock()
        telemetry._request_duration = Mock()
        telemetry._payment_count = Mock()
        cls.logs = CaptureLogs()
        telemetry._logger = logging.getLogger("banking.observability.test")
        telemetry._logger.handlers = [cls.logs]
        telemetry._logger.setLevel(logging.INFO)
        telemetry._logger.propagate = False
        telemetry.ENABLED = True
        telemetry.instrument_api(main.app)
        main.app.dependency_overrides[get_current_customer] = lambda: {"customer_id": CUSTOMER}
        cls.sock = socket.socket()
        cls.sock.bind(("127.0.0.1", 0))
        cls.base = f"http://127.0.0.1:{cls.sock.getsockname()[1]}"
        cls.server = uvicorn.Server(uvicorn.Config(main.app, access_log=False, log_level="critical"))
        cls.thread = Thread(target=lambda: asyncio.run(cls.server.serve(sockets=[cls.sock])), daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 10
        while not cls.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("Test server did not start")
            time.sleep(0.01)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.sock.close()
        main.app.dependency_overrides.clear()
        cls.meter_provider.shutdown()
        cls.provider.shutdown()

    def setUp(self):
        self.exporter.clear()
        self.logs.records.clear()
        self.before = self.metrics()

    def metrics(self):
        data = self.reader.get_metrics_data()
        result = {}
        if data:
            for resource in data.resource_metrics:
                for scope in resource.scope_metrics:
                    for metric in scope.metrics:
                        for point in metric.data.data_points:
                            value = point.count if hasattr(point, "count") else point.value
                            result[(metric.name, tuple(sorted(point.attributes.items())))] = value
        return result

    def delta(self, name, **labels):
        key = ("banking." + name, tuple(sorted(labels.items())))
        return self.metrics().get(key, 0) - self.before.get(key, 0)

    def request(self, path, body=None, form=False, key=KEY):
        headers = {"X-Correlation-ID": "business-test-001"}
        if form:
            body = b"username=private-username&password=private-password"
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if path == "/api/v1/payments":
            headers["Idempotency-Key"] = key
        try:
            response = urlopen(Request(self.base + path, data=body, headers=headers), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            content = response.read()
            try:
                body = json.loads(content)
            except json.JSONDecodeError:
                body = content.decode()
            return response.status, body

    def payment_row(self, rejected=False):
        return (PAYMENT, SOURCE, DESTINATION, Decimal("7.37"),
                "rejected" if rejected else "completed",
                "INSUFFICIENT_FUNDS" if rejected else None, NOW, NOW)

    def payment_connection(self, *, rejected=False, replay=False):
        row = self.payment_row(rejected)
        if replay:
            rows = [(USER,), row]
        else:
            rows = [(USER,), None,
                    (SOURCE, CUSTOMER, Decimal("0.00" if rejected else "100.00"), True, "USD"),
                    (DESTINATION, CUSTOMER, Decimal("50.00"), True, "USD"), row]
            if not rejected:
                rows.append((Decimal("92.63"),))
        return connection_with(rows)

    def transfer(self):
        return self.request("/api/v1/payments", {
            "source_account_id": str(SOURCE), "destination_account_id": str(DESTINATION),
            "amount": "7.37",
        })

    def assert_failure(self, category):
        logs = [r for r in self.logs.records if r.msg == "business_operation_failed"]
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].__dict__["failure.category"], category)
        self.assertEqual(logs[0].correlation_id, "business-test-001")

    def assert_private(self):
        spans = self.exporter.get_finished_spans()
        payload = json.dumps([{
            "name": s.name, "attributes": dict(s.attributes),
            "events": [e.name for e in s.events], "description": s.status.description,
        } for s in spans])
        payload += json.dumps([r.__dict__ for r in self.logs.records], default=str)
        for secret in ("private-username", "private-password", "private-jwt", "private-sql",
                       "private-exception", "LAB-PRIVATE", "recipient-private", "7.37",
                       str(CUSTOMER), str(SOURCE), str(DESTINATION), str(USER), str(PAYMENT), KEY):
            self.assertNotIn(secret, payload)
        for _, labels in self.metrics():
            self.assertLessEqual({key for key, _ in labels}, {"journey", "outcome", "failure_type"})
        for span in spans:
            if span.name in telemetry.BUSINESS_SPANS:
                self.assertEqual(span.attributes["correlation_id"], "business-test-001")
                self.assertEqual(span.events, ())

    def test_login_success(self):
        connection, _ = connection_with([(USER, "private-hash", True)])
        with patch.object(auth, "get_connection", return_value=connection), \
             patch.object(auth, "password_hasher") as hasher, \
             patch.object(auth, "get_jwt_secret", return_value="private-signing-secret"), \
             patch.object(auth.jwt, "encode", return_value="private-jwt"), \
             patch.object(auth, "check_login_allowed"), patch.object(auth, "clear_login_failures"):
            hasher.verify.return_value = True
            status, body = self.request("/api/v1/auth/token", form=True)
        self.assertEqual(status, 200)
        self.assertEqual(body["access_token"], "private-jwt")
        self.assertEqual(self.delta("login.attempts", journey="login"), 1)
        self.assertEqual(self.delta("login.success", journey="login", outcome="success"), 1)
        self.assertEqual(self.delta("login.duration", journey="login", outcome="success"), 1)
        self.assertIn("login.authenticate", [s.name for s in self.exporter.get_finished_spans()])
        self.assert_private()

    def test_login_failure(self):
        connection, _ = connection_with([None])
        with patch.object(auth, "get_connection", return_value=connection), \
             patch.object(auth, "check_login_allowed"), patch.object(auth, "record_login_failure"):
            self.assertEqual(self.request("/api/v1/auth/token", form=True)[0], 401)
        self.assert_failure("authentication")
        self.assertEqual(self.delta("login.failure", journey="login", outcome="failure", failure_type="authentication"), 1)
        self.assert_private()

    def test_login_throttle(self):
        with patch.object(auth, "check_login_allowed", side_effect=HTTPException(429)):
            self.assertEqual(self.request("/api/v1/auth/token", form=True)[0], 429)
        self.assert_failure("authentication")

    def test_login_database_failure(self):
        with patch.object(auth, "check_login_allowed"), \
             patch.object(auth, "get_connection", side_effect=psycopg.Error("private-exception")):
            self.assertEqual(self.request("/api/v1/auth/token", form=True)[0], 503)
        self.assert_failure("database")
        self.assert_private()

    def test_signing_failure_is_internal(self):
        connection, _ = connection_with([(USER, "private-hash", True)])
        with patch.object(auth, "get_connection", return_value=connection), \
             patch.object(auth, "password_hasher") as hasher, \
             patch.object(auth, "get_jwt_secret", side_effect=RuntimeError("private-exception")), \
             patch.object(auth, "check_login_allowed"), patch.object(auth, "clear_login_failures"):
            hasher.verify.return_value = True
            self.assertEqual(self.request("/api/v1/auth/token", form=True)[0], 503)
        self.assert_failure("internal")
        self.assert_private()

    def test_transfer_success_and_span_hierarchy(self):
        connection, cursor = self.payment_connection()
        with patch.object(payments, "get_connection", return_value=connection):
            self.assertEqual(self.transfer()[0], 201)
        connection.__exit__.assert_called_once_with(None, None, None)
        sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(sum("INSERT INTO public.transactions" in statement for statement in sql), 2)
        self.assertEqual(self.delta("transfer.success", journey="transfer", outcome="success"), 1)
        spans = self.exporter.get_finished_spans()
        parent = next(s for s in spans if s.name == "payment.process")
        server = next(s for s in spans if s.kind == trace.SpanKind.SERVER)
        self.assertEqual(server.attributes["banking.correlation_id"], "business-test-001")
        self.assertEqual(parent.parent.span_id, server.context.span_id)
        children = [s for s in spans if s.name.startswith("payment.") and s is not parent]
        self.assertEqual({s.name for s in children}, {
            "payment.validate_accounts", "payment.validate_balance", "payment.persist", "payment.commit",
        })
        for span in children:
            self.assertEqual(span.parent.span_id, parent.context.span_id)
        persist = next(s for s in children if s.name == "payment.persist")
        commit = next(s for s in children if s.name == "payment.commit")
        self.assertLessEqual(persist.end_time, commit.start_time)
        self.assert_private()

    def test_insufficient_funds_is_committed_failure(self):
        connection, cursor = self.payment_connection(rejected=True)
        with patch.object(payments, "get_connection", return_value=connection):
            status, body = self.transfer()
        self.assertEqual((status, body["error_code"]), (409, "INSUFFICIENT_FUNDS"))
        connection.__exit__.assert_called_once_with(None, None, None)
        sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertTrue(any("INSERT INTO public.payments" in statement for statement in sql))
        self.assertFalse(any("UPDATE public.accounts" in statement or "INSERT INTO public.transactions" in statement for statement in sql))
        self.assert_failure("insufficient_funds")
        self.assertEqual(self.delta("transfer.failure", journey="transfer", outcome="failure", failure_type="insufficient_funds"), 1)
        self.assert_private()

    def test_replays_do_not_count_execution_outcomes(self):
        for rejected in (False, True):
            connection, cursor = self.payment_connection(rejected=rejected, replay=True)
            with patch.object(payments, "get_connection", return_value=connection):
                self.assertEqual(self.transfer()[0], 409 if rejected else 200)
            sql = [call.args[0] for call in cursor.execute.call_args_list]
            self.assertFalse(any("INSERT" in statement or "UPDATE" in statement for statement in sql))
        self.assertEqual(self.delta("transfer.attempts", journey="transfer"), 2)
        self.assertEqual(self.delta("transfer.success", journey="transfer", outcome="success"), 0)
        self.assertEqual(self.delta("transfer.failure", journey="transfer", outcome="failure", failure_type="insufficient_funds"), 0)
        self.assertEqual(self.delta("payment.duration", journey="transfer", outcome="success"), 1)
        self.assertEqual(self.delta("payment.duration", journey="transfer", outcome="failure", failure_type="insufficient_funds"), 1)
        self.assert_private()

    def test_idempotency_conflict_remains_validation_failure(self):
        connection, _ = connection_with([(USER,), self.payment_row()])
        with patch.object(payments, "get_connection", return_value=connection):
            status, _ = self.request("/api/v1/payments", {
                "source_account_id": str(SOURCE), "destination_account_id": str(DESTINATION),
                "amount": "9.00",
            })
        self.assertEqual(status, 409)
        self.assert_failure("validation")
        self.assertIs(connection.__exit__.call_args.args[0], HTTPException)

    def test_commit_failure_never_counts_success(self):
        connection, _ = self.payment_connection()
        connection.__exit__.side_effect = psycopg.OperationalError("private-exception")
        with patch.object(payments, "get_connection", return_value=connection):
            self.assertEqual(self.transfer()[0], 503)
        self.assertEqual(connection.__exit__.call_count, 1)
        self.assertEqual(self.delta("transfer.success", journey="transfer", outcome="success"), 0)
        self.assert_failure("database")
        span = next(s for s in self.exporter.get_finished_spans() if s.name == "payment.commit")
        self.assertEqual(span.status.status_code, StatusCode.ERROR)
        self.assert_private()

    def test_validation_rolls_back_and_labels_not_found(self):
        connection, _ = connection_with([(USER,), None, None])
        with patch.object(payments, "get_connection", return_value=connection):
            self.assertEqual(self.transfer()[0], 404)
        args = connection.__exit__.call_args.args
        self.assertIs(args[0], HTTPException)
        self.assertEqual(args[1].status_code, 404)
        self.assertIsNotNone(args[2])
        self.assertEqual(connection.__exit__.call_count, 1)
        self.assert_failure("not_found")

    def test_recipient_not_found(self):
        connection, _ = connection_with([None])
        with patch.object(accounts, "get_connection", return_value=connection):
            self.assertEqual(self.request("/api/v1/accounts/lookup", {"account_number": "LAB-PRIVATE"})[0], 404)
        self.assert_failure("not_found")
        self.assertEqual(self.delta("recipient.verification.failure", journey="transfer", outcome="failure", failure_type="not_found"), 1)
        self.assertIn("recipient.verify", [s.name for s in self.exporter.get_finished_spans()])
        self.assert_private()

    def test_recipient_database_failure(self):
        with patch.object(accounts, "get_connection", side_effect=psycopg.Error("private-exception")):
            self.assertEqual(self.request("/api/v1/accounts/lookup", {"account_number": "LAB-PRIVATE"})[0], 503)
        self.assert_failure("database")
        self.assert_private()

    def test_recipient_success_has_no_failure_metric(self):
        connection, _ = connection_with([(DESTINATION, "LAB-PRIVATE", "checking")])
        with patch.object(accounts, "get_connection", return_value=connection):
            self.assertEqual(self.request("/api/v1/accounts/lookup", {"account_number": "LAB-PRIVATE"})[0], 200)
        self.assertEqual(self.metrics(), self.before)
        self.assertFalse(any(r.msg == "business_operation_failed" for r in self.logs.records))
        self.assert_private()

    def test_unexpected_exception_is_safe_internal_failure(self):
        with patch.object(accounts, "get_connection", side_effect=RuntimeError("private-exception")):
            self.assertEqual(self.request("/api/v1/accounts/lookup", {"account_number": "LAB-PRIVATE"})[0], 500)
        self.assert_failure("internal")
        self.assert_private()

    def test_auth_dependency_failure_is_observed(self):
        def reject():
            raise HTTPException(401)
        main.app.dependency_overrides[get_current_customer] = reject
        try:
            with patch.object(payments, "get_connection") as connection:
                self.assertEqual(self.transfer()[0], 401)
                connection.assert_not_called()
        finally:
            main.app.dependency_overrides[get_current_customer] = lambda: {"customer_id": CUSTOMER}
        self.assert_failure("authentication")

    def test_pre_endpoint_validation_observed(self):
        with patch.object(payments, "get_connection") as connection:
            self.assertEqual(self.request("/api/v1/payments", {"amount": "bad"})[0], 422)
            connection.assert_not_called()
        self.assert_failure("validation")
        self.assertEqual(self.delta("transfer.failure", journey="transfer", outcome="failure", failure_type="validation"), 1)

    def test_disabled_telemetry_preserves_payment(self):
        telemetry.ENABLED = False
        try:
            connection, _ = self.payment_connection()
            with patch.object(payments, "get_connection", return_value=connection):
                self.assertEqual(self.transfer()[0], 201)
            connection.__exit__.assert_called_once_with(None, None, None)
            self.assertEqual(self.metrics(), self.before)
            self.assertEqual(self.logs.records, [])
        finally:
            telemetry.ENABLED = True

    def test_exporter_removes_automatic_sql_and_exception_details(self):
        exporter = InMemorySpanExporter()
        wrapper = telemetry.SafeSpanExporter(exporter)
        wrapper.export([ReadableSpan(
            "SELECT private-sql", attributes={
                "db.system": "postgresql", "db.statement": "private-sql",
                "db.user": "private-username", "account_id": str(SOURCE),
                "http.url": "http://example/private-jwt", "amount": "7.37",
            }, events=[Event("exception", {"exception.message": "private-exception"})],
            status=Status(StatusCode.ERROR, "private-exception"),
        )])
        span = exporter.get_finished_spans()[0]
        self.assertEqual(span.name, "SELECT")
        self.assertEqual(dict(span.attributes), {"db.system": "postgresql"})
        self.assertEqual(span.events, ())
        self.assertIsNone(span.status.description)


if __name__ == "__main__":
    unittest.main(verbosity=2)
