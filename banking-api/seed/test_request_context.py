"""Isolated correlation tests; no database, credentials, or OTLP network export.

Run in the API container with the current source mounted (see validation commands).
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
import socket
from threading import Thread
import time
import unittest
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request as HTTPRequest, urlopen
from uuid import UUID

os.environ["OTEL_ENABLED"] = "false"

from fastapi import Request
from starlette.responses import Response
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
import uvicorn

from app import main, telemetry
from app.request_context import (
    apply_request_context,
    get_correlation_id,
    get_session_id,
    validate_context_id,
)


class ContextTests(unittest.IsolatedAsyncioTestCase):
    def test_validation(self):
        for value in (None, "", "bad/id", "bad id", "a" * 129,
                      " " * 129 + "valid", "é", "-bad"):
            self.assertIsNone(validate_context_id(value))
        for value in ("test-transfer-001", "a" * 128, "session_1.test"):
            self.assertEqual(validate_context_id(value), value)

    async def test_session_context_and_cleanup(self):
        request = Request({"type": "http", "headers": [
            (b"x-correlation-id", b"test-transfer-001"),
            (b"x-session-id", b"session-001"),
        ]})

        async def next_handler(request):
            self.assertEqual(get_correlation_id(), "test-transfer-001")
            self.assertEqual(get_session_id(), "session-001")
            return Response()

        response = await apply_request_context(request, next_handler)
        self.assertEqual(response.headers["X-Correlation-ID"], "test-transfer-001")
        self.assertIsNone(get_correlation_id())
        self.assertIsNone(get_session_id())

    async def test_invalid_session_and_exception_cleanup(self):
        request = Request({"type": "http", "headers": [
            (b"x-session-id", b"invalid/session"),
        ]})

        async def next_handler(request):
            UUID(get_correlation_id())
            self.assertIsNone(get_session_id())
            raise RuntimeError("controlled test failure")

        with self.assertRaises(RuntimeError):
            await apply_request_context(request, next_handler)
        self.assertIsNone(get_correlation_id())
        self.assertIsNone(get_session_id())


class MiddlewareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use real FastAPI/Starlette/OTel middleware with an in-memory exporter.
        cls.exporter = InMemorySpanExporter()
        cls.provider = TracerProvider()
        cls.provider.add_span_processor(SimpleSpanProcessor(cls.exporter))
        trace.set_tracer_provider(cls.provider)
        telemetry._request_count = Mock()
        telemetry._request_duration = Mock()
        telemetry._payment_count = Mock()
        telemetry._logger = Mock()
        telemetry.ENABLED = True
        telemetry.instrument_api(main.app)
        cls.sock = socket.socket()
        cls.sock.bind(("127.0.0.1", 0))
        cls.base = f"http://127.0.0.1:{cls.sock.getsockname()[1]}"
        cls.server = uvicorn.Server(uvicorn.Config(
            main.app, access_log=False, log_level="critical",
        ))
        cls.thread = Thread(
            target=lambda: asyncio.run(cls.server.serve(sockets=[cls.sock])),
            daemon=True,
        )
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
        cls.provider.shutdown()

    def setUp(self):
        self.exporter.clear()
        telemetry._logger.reset_mock()
        telemetry._request_count.reset_mock()
        telemetry._request_duration.reset_mock()
        telemetry._payment_count.reset_mock()

    def request(self, path="/health", correlation=None, session=None):
        headers = {}
        if correlation is not None:
            headers["X-Correlation-ID"] = correlation
        if session is not None:
            headers["X-Session-ID"] = session
        request = HTTPRequest(self.base + path, headers=headers)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            response.read()
            return response.status, response.headers["X-Correlation-ID"]

    def test_health_generation_and_preservation(self):
        status, generated = self.request()
        self.assertEqual(status, 200)
        UUID(generated)
        self.assertEqual(self.request(correlation="test-transfer-001"),
                         (200, "test-transfer-001"))

    def test_invalid_and_oversized_ids(self):
        for invalid in ("bad/id", "a" * 129):
            status, generated = self.request(correlation=invalid)
            self.assertEqual(status, 200)
            self.assertNotEqual(generated, invalid)
            UUID(generated)

    def test_response_log_span_and_metric_labels(self):
        status, correlation = self.request(
            "/api/v1/accounts", "test-transfer-001", "session-001",
        )
        self.assertEqual(status, 401)  # Session ID never bypasses JWT authentication.
        self.assertEqual(correlation, "test-transfer-001")
        log = telemetry._logger.info.call_args.kwargs["extra"]
        self.assertEqual(log["correlation_id"], correlation)
        self.provider.force_flush()
        spans = self.exporter.get_finished_spans()
        matching = [s for s in spans if s.attributes.get("banking.correlation_id") == correlation]
        self.assertEqual(len(matching), 1)
        self.assertEqual(log["trace_id"], format(matching[0].context.trace_id, "032x"))
        for metric in (telemetry._request_count, telemetry._request_duration):
            attributes = metric.method_calls[0].args[1]
            self.assertEqual(set(attributes), {"http_route", "http_method", "http_status"})
        telemetry._payment_count.add.assert_not_called()

    def test_concurrent_context_isolation(self):
        ids = [f"concurrent-{i}" for i in range(12)]
        with ThreadPoolExecutor(max_workers=6) as executor:
            results = list(executor.map(lambda value: self.request(correlation=value), ids))
        self.assertEqual(results, [(200, value) for value in ids])
        logged_ids = [call.kwargs["extra"]["correlation_id"]
                      for call in telemetry._logger.info.call_args_list]
        self.assertCountEqual(logged_ids, ids)

    def test_headers_with_telemetry_disabled(self):
        telemetry.ENABLED = False
        try:
            self.assertEqual(self.request(correlation="disabled-001"), (200, "disabled-001"))
            UUID(self.request()[1])
            telemetry._logger.info.assert_not_called()
        finally:
            telemetry.ENABLED = True


if __name__ == "__main__":
    unittest.main(verbosity=2)
