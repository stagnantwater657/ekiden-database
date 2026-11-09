"""Real pipe receive deadlines, safe telemetry, and transport failure classification."""
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    loader = importlib.machinery.SourceFileLoader(name, str(ROOT / relative))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


server = load("receiver", "ops/ekiden-deploy")
logger = load("logger", "ops/transfer-log.py")


class ReceiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / "received"
        self.read_fd, self.write_fd = os.pipe()
        self.addCleanup(os.close, self.read_fd)
        self.addCleanup(self.close_writer)
        self.logs = io.StringIO()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(self.logs))
        for name, value in [("UPLOAD_SECONDS", 3), ("UPLOAD_IDLE_SECONDS", 1),
                            ("UPLOAD_EOF_SECONDS", .05), ("PROGRESS_SECONDS", .01)]:
            self.stack.enter_context(mock.patch.object(server, name, value))

    def close_writer(self):
        if self.write_fd is not None:
            os.close(self.write_fd)
            self.write_fd = None

    def receive(self, data, checksum=None):
        server.receive(self.read_fd, self.target, len(data), checksum or hashlib.sha256(data).hexdigest())

    def test_fragmented_binary_upload_finishes_with_eof_and_progress(self):
        data = bytes(range(256)) * 32
        def produce():
            try:
                for offset in range(0, len(data), 512):
                    os.write(self.write_fd, data[offset:offset + 512])
                    time.sleep(.003)
            finally:
                self.close_writer()
        writer = threading.Thread(target=produce)
        writer.start()
        try:
            self.receive(data)
        finally:
            writer.join(timeout=2)
        self.assertFalse(writer.is_alive())
        self.assertEqual(self.target.read_bytes(), data)
        self.assertIn("receive_progress", self.logs.getvalue())
        self.assertIn(f"receive_complete received={len(data)} total={len(data)}", self.logs.getvalue())
        self.assertIn("stage name=checksum_verified", self.logs.getvalue())

    def test_full_size_without_eof_has_short_independent_deadline(self):
        data = b"complete payload"
        os.write(self.write_fd, data)
        start = time.monotonic()
        with self.assertRaises(server.TransferRejected) as error:
            self.receive(data)
        self.assertEqual(error.exception.code, "UPLOAD_EOF_TIMEOUT")
        self.assertLess(time.monotonic() - start, 1)
        self.assertIn(f"received={len(data)} total={len(data)}", self.logs.getvalue())
        self.assertNotIn("checksum_verified", self.logs.getvalue())

    def test_zero_byte_stall_is_not_total_timeout(self):
        with mock.patch.object(server, "UPLOAD_IDLE_SECONDS", .02), self.assertRaises(server.TransferRejected) as error:
            self.receive(b"never sent")
        self.assertEqual(error.exception.code, "UPLOAD_STALLED")
        self.assertIn("received=0", self.logs.getvalue())

    def test_partial_stall_preserves_last_confirmed_byte_count(self):
        os.write(self.write_fd, b"abc")
        with mock.patch.object(server, "UPLOAD_IDLE_SECONDS", .02), self.assertRaises(server.TransferRejected) as error:
            self.receive(b"abcdef")
        self.assertEqual(error.exception.code, "UPLOAD_STALLED")
        self.assertIn("received=3 total=6", self.logs.getvalue())

    def test_continuous_slow_progress_still_has_bounded_total_time(self):
        clock = [0.0]
        def ready(*_args):
            clock[0] += .02
            return ([self.read_fd], [], [])
        with mock.patch.object(server.time, "monotonic", side_effect=lambda: clock[0]), \
             mock.patch.object(server.select, "select", side_effect=ready), \
             mock.patch.object(server.os, "read", return_value=b"a"), \
             mock.patch.object(server, "UPLOAD_SECONDS", .07), \
             self.assertRaises(server.TransferRejected) as error:
            self.receive(b"a" * 100)
        self.assertEqual(error.exception.code, "UPLOAD_TOTAL_TIMEOUT")
        self.assertIn("received=4 total=100", self.logs.getvalue())

    def test_early_eof_is_interruption_and_never_complete(self):
        os.write(self.write_fd, b"ab")
        self.close_writer()
        with self.assertRaises(server.TransferRejected) as error:
            self.receive(b"abcdef")
        self.assertEqual(error.exception.code, "UPLOAD_INTERRUPTED")
        self.assertNotIn("receive_complete", self.logs.getvalue())

    def test_hash_failure_is_distinct_from_transport_failure(self):
        data = b"all arrived"
        os.write(self.write_fd, data)
        self.close_writer()
        with self.assertRaises(server.TransferRejected) as error:
            self.receive(data, "0" * 64)
        self.assertEqual(error.exception.code, "CHECKSUM_MISMATCH")
        self.assertIn("receive_complete", self.logs.getvalue())
        self.assertNotIn("checksum_verified", self.logs.getvalue())

    def test_extra_bytes_remain_rejected(self):
        os.write(self.write_fd, b"too much")
        self.close_writer()
        with self.assertRaises(server.TransferRejected) as error:
            self.receive(b"too")
        self.assertEqual(error.exception.code, "UPLOAD_TOO_LARGE")

    def test_tty_stdin_fails_before_creating_file(self):
        with mock.patch.object(server.os, "isatty", return_value=True), self.assertRaises(server.TransferRejected) as error:
            self.receive(b"binary")
        self.assertEqual(error.exception.code, "TTY_STDIN")
        self.assertFalse(self.target.exists())


class LogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.report = Path(self.temp.name) / "report.json"

    def test_only_allowlisted_structured_data_is_printed(self):
        stream = io.BytesIO((
            "private-key-marker\nEKIDEN error code=TOKEN_secret\n"
            "EKIDEN stage name=load_started token=secret\n"
            + "x" * 1000 + "token-marker\n"
            "EKIDEN receive_progress received=40 total=100 elapsed_s=10 idle_s=3 rate_bps=4 window_bps=0\n"
            "EKIDEN stage name=load_started\n"
            "EKIDEN error code=LOAD_FAILED\n"
        ).encode())
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            logger.consume(stream, self.report, 100, "upload")
        output = printed.getvalue()
        for secret in ["private-key-marker", "TOKEN_secret", "token=secret", "token-marker"]:
            self.assertNotIn(secret, output)
        self.assertIn("40/100 bytes", output)
        self.assertIn("idle=3s", output)
        self.assertEqual(json.loads(self.report.read_text())["error"], "LOAD_FAILED")

    def test_error_classification_prefers_receiver_code_over_broken_pipe(self):
        for code in ["UPLOAD_TOTAL_TIMEOUT", "UPLOAD_STALLED", "UPLOAD_EOF_TIMEOUT", "CHECKSUM_MISMATCH", "LOAD_FAILED", "LOAD_TIMEOUT"]:
            self.report.write_text(json.dumps({"error": code, "received": 42, "total": 100}))
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                self.assertEqual(logger.check_result(self.report, 1, 141, 0), 1)
            self.assertIn("[" + code + "]", printed.getvalue())
            self.assertIn("42/100 bytes", printed.getvalue())

    def test_connection_and_client_timeout_are_separate(self):
        for status, code in [(255, "SSH_CONNECTION_FAILED"), (124, "CLIENT_TIMEOUT")]:
            self.report.write_text("{}")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(logger.check_result(self.report, status, 141, 0), 1)
            self.assertIn(code, output.getvalue())

    def test_success_requires_server_completion_ack(self):
        self.report.write_text(json.dumps({"complete": True, "error": None}))
        self.assertEqual(logger.check_result(self.report, 0, 0, 0), 0)
        self.report.write_text("{}")
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(logger.check_result(self.report, 0, 0, 0), 1)
        self.assertIn("ACK_MISSING", printed.getvalue())


if __name__ == "__main__":
    unittest.main()
