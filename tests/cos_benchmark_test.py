"""Exercise the official SDK against an in-memory HTTP transport, never COS."""
import contextlib
import hashlib
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest import mock
import zlib

import requests

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cos_benchmark", ROOT / "ops/cos-speed-test.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
SECRET_MARKER = "credential-marker-never-log"


class RecordingSession(requests.Session):
    def __init__(self, status=200, error=None):
        super().__init__()
        self.status = status
        self.error = error
        self.calls = []

    def send(self, request, **kwargs):
        # HTTP requests are prepared/signed by the real requests/COS SDK code,
        # but no adapter/socket transport is invoked.
        call = {"method": request.method, "url": request.url, "timeout": kwargs["timeout"],
                "redirects": kwargs["allow_redirects"], "headers": request.headers}
        self.calls.append(call)
        if self.error:
            raise self.error
        data = request.body.read()
        call.update(size=len(data), sha256=hashlib.sha256(data).hexdigest(), sample=data[:1024 * 1024])
        response = requests.Response()
        response.status_code = self.status
        response.url = request.url
        response.request = request
        response.headers = {"ETag": '"test-etag"'}
        response._content = (
            b"<Error><Code>AccessDenied</Code><Message>" + SECRET_MARKER.encode() +
            b" Authorization q-sign-secret-id=hidden</Message><Resource>signed-url-marker</Resource></Error>"
            if self.status >= 400 else b""
        )
        return requests.hooks.dispatch_hook("response", request.hooks, response, **kwargs)


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.env = {"GITHUB_RUN_ID": "123456789", "RUNNER_TEMP": str(self.directory),
                    "COS_SECRET_ID": SECRET_MARKER, "COS_SECRET_KEY": SECRET_MARKER,
                    "COS_BUCKET": benchmark.EXPECTED_BUCKET}
        # A missed transport mock must fail, not contact a real endpoint.
        self.network_guard = mock.patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden in tests"))
        self.network_guard.start()
        self.addCleanup(self.network_guard.stop)

    def run_benchmark(self, session, env=None):
        output, errors = io.StringIO(), io.StringIO()
        with mock.patch.object(benchmark.requests, "Session", return_value=session), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            result = benchmark.benchmark(env or self.env, now_ns=mock.Mock(side_effect=[1_000_000_000, 3_500_000_000]))
        for marker in [SECRET_MARKER, "Authorization", "q-sign-secret-id", "signed-url-marker"]:
            self.assertNotIn(marker, output.getvalue() + errors.getvalue() + json.dumps(result))
        self.assertEqual(list(self.directory.glob("cos-speed-*")), [])
        return result

    def test_exact_random_10mib_one_private_put_and_precise_metrics(self):
        session = RecordingSession()
        result = self.run_benchmark(session)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["object_key"], "benchmarks/123456789/test-10m.bin")
        self.assertEqual(result["file_bytes"], 10485760)
        self.assertEqual(result["elapsed_ns"], 2500000000)
        self.assertEqual(result["elapsed_seconds"], 2.5)
        self.assertEqual(result["average_mib_per_second"], 4.0)
        self.assertEqual(len(session.calls), 1)
        call = session.calls[0]
        self.assertEqual(call["method"], "PUT")
        self.assertEqual(call["size"], result["file_bytes"])
        self.assertEqual(call["sha256"], result["sha256"])
        self.assertGreater(len(zlib.compress(call["sample"])), len(call["sample"]) * .99)
        self.assertIn("Authorization", call["headers"])
        self.assertFalse(any(name.lower().startswith("x-cos-acl") for name in call["headers"]))
        self.assertEqual(call["timeout"], (10, 120))
        self.assertFalse(call["redirects"])
        self.assertTrue(call["url"].startswith("https://" + benchmark.EXPECTED_BUCKET + ".cos.ap-shanghai."))
        self.assertEqual(session.adapters["https://"].max_retries.total, 0)
        self.assertIn("4.000000", benchmark.summary(result))

    def test_permission_error_does_not_retry_or_print_sdk_response(self):
        for status in [401, 403]:
            with self.subTest(status=status):
                session = RecordingSession(status=status)
                result = self.run_benchmark(session)
                self.assertEqual(result["status"], "failure")
                self.assertEqual(result["error_category"], "PERMISSION_ERROR")
                self.assertEqual(result["http_status"], status)
                self.assertIsNone(result["average_mib_per_second"])
                self.assertEqual(len(session.calls), 1)

    def test_wrapped_typed_network_failures_and_total_deadline(self):
        cases = [
            (requests.exceptions.ConnectTimeout(SECRET_MARKER), "CONNECT_TIMEOUT"),
            (requests.exceptions.ReadTimeout(SECRET_MARKER), "READ_TIMEOUT"),
            (requests.exceptions.ConnectionError(SECRET_MARKER), "NETWORK_ERROR"),
            (requests.exceptions.SSLError(SECRET_MARKER), "TLS_ERROR"),
            (benchmark.BenchmarkDeadline(SECRET_MARKER), "TOTAL_TIMEOUT"),
        ]
        for error, category in cases:
            with self.subTest(category=category):
                session = RecordingSession(error=error)
                result = self.run_benchmark(session)
                self.assertEqual(result["error_category"], category)
                self.assertEqual(result["elapsed_ns"], 2500000000)
                self.assertIsNone(result["average_mib_per_second"])
                self.assertEqual(len(session.calls), 1)

    def test_server_5xx_is_single_attempt(self):
        session = RecordingSession(status=503)
        result = self.run_benchmark(session)
        self.assertEqual(result["error_category"], "COS_SERVICE_ERROR")
        self.assertEqual(result["http_status"], 503)
        self.assertEqual(len(session.calls), 1)

    def test_redirect_cannot_be_mistaken_for_success(self):
        session = RecordingSession(status=307)
        result = self.run_benchmark(session)
        self.assertEqual(result["status"], "failure")
        self.assertEqual(result["error_category"], "ENDPOINT_REDIRECT")
        self.assertEqual(len(session.calls), 1)

    def test_invalid_configuration_never_sends(self):
        for key, value in [("COS_SECRET_ID", ""), ("COS_SECRET_KEY", ""),
                           ("COS_BUCKET", "another-bucket"), ("GITHUB_RUN_ID", "../" + SECRET_MARKER)]:
            with self.subTest(key=key):
                session = RecordingSession()
                result = self.run_benchmark(session, self.env | {key: value})
                self.assertEqual(result["error_category"], "CONFIGURATION_ERROR")
                self.assertEqual(session.calls, [])

    def test_main_saves_only_safe_metrics_and_returns_nonzero_for_failure(self):
        result = self.run_benchmark(RecordingSession(status=403))
        env = self.env | {"COS_BENCHMARK_RESULT": str(self.directory / "result.json"),
                          "GITHUB_STEP_SUMMARY": str(self.directory / "summary.md")}
        output = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(benchmark, "benchmark", return_value=result), \
             contextlib.redirect_stdout(output):
            self.assertEqual(benchmark.main(), 1)
        saved = (self.directory / "result.json").read_text()
        summary = (self.directory / "summary.md").read_text()
        self.assertEqual(json.loads(saved), result)
        self.assertIn("PERMISSION_ERROR", summary)
        self.assertIn(result["sha256"], summary)
        for marker in [SECRET_MARKER, "Authorization", "signed-url-marker"]:
            self.assertNotIn(marker, saved + summary + output.getvalue())

    def test_request_deadline_is_bounded_and_restores_previous_handler(self):
        with mock.patch.object(benchmark.signal, "signal", return_value="previous-handler") as handler, \
             mock.patch.object(benchmark.signal, "setitimer") as timer:
            with benchmark.request_deadline():
                callback = handler.call_args_list[0].args[1]
                with self.assertRaises(benchmark.BenchmarkDeadline):
                    callback(None, None)
            self.assertEqual(timer.call_args_list[0].args, (benchmark.signal.ITIMER_REAL, 600))
            self.assertEqual(timer.call_args_list[-1].args, (benchmark.signal.ITIMER_REAL, 0))
            self.assertEqual(handler.call_args_list[-1].args[1], "previous-handler")

    def test_failure_logging_is_suppressed_even_if_sdk_debug_is_enabled(self):
        sink = io.StringIO()
        logger = logging.getLogger()
        handler = logging.StreamHandler(sink)
        old_level = logger.level
        logger.setLevel(logging.DEBUG)
        logger.addHandler(handler)
        try:
            self.run_benchmark(RecordingSession(status=403))
        finally:
            logger.removeHandler(handler)
            logger.setLevel(old_level)
        self.assertEqual(sink.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
