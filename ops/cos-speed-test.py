#!/usr/bin/env python3
"""One private COS PutObject benchmark. No bucket management or object cleanup."""
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import signal
import sys
import tempfile
import time

import requests
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosClientError, CosServiceError

REGION = "ap-shanghai"
EXPECTED_BUCKET = "ekiden-deploy-test-1416877161"
FILE_BYTES = 10 * 1024 * 1024
CONNECT_SECONDS = 10
READ_SECONDS = 120
TOTAL_SECONDS = 600


class ConfigurationError(Exception):
    pass


class BenchmarkDeadline(Exception):
    pass


class UnexpectedRedirect(Exception):
    pass


@contextlib.contextmanager
def quiet_sdk():
    # SDK debug/error logs may contain headers, URLs and raw response bodies.
    previous = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        yield
    finally:
        logging.disable(previous)


@contextlib.contextmanager
def request_deadline():
    def expired(_signum, _frame):
        raise BenchmarkDeadline("Benchmark request deadline exceeded")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, TOTAL_SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def forbid_redirect(response, *_args, **_kwargs):
    # The SDK considers 3xx successful when redirects are disabled; reject them.
    if 300 <= response.status_code < 400:
        raise UnexpectedRedirect("Unexpected COS endpoint redirect")
    return response


def classify(error):
    """Inspect typed exception chains, never parse or print credential-bearing text."""
    chain = []
    pending = [error]
    seen = set()
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        chain.append(current)
        pending.extend([current.__cause__, current.__context__])
    for kind, code in [
        (ConfigurationError, "CONFIGURATION_ERROR"),
        (BenchmarkDeadline, "TOTAL_TIMEOUT"),
        (requests.exceptions.ConnectTimeout, "CONNECT_TIMEOUT"),
        (requests.exceptions.ReadTimeout, "READ_TIMEOUT"),
        (requests.exceptions.SSLError, "TLS_ERROR"),
        (requests.exceptions.ConnectionError, "NETWORK_ERROR"),
        (requests.exceptions.Timeout, "NETWORK_TIMEOUT"),
        (UnexpectedRedirect, "ENDPOINT_REDIRECT"),
    ]:
        if any(isinstance(item, kind) for item in chain):
            return code, None
    for item in chain:
        if isinstance(item, CosServiceError):
            status = int(item.get_status_code())
            return ("PERMISSION_ERROR" if status in (401, 403) else "COS_SERVICE_ERROR"), status
    if any(isinstance(item, CosClientError) for item in chain):
        return "SDK_CLIENT_ERROR", None
    return "INTERNAL_ERROR", None


def create_payload(path):
    digest = hashlib.sha256()
    with path.open("xb") as output:
        for _ in range(10):
            chunk = os.urandom(1024 * 1024)
            output.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def benchmark(environ, now_ns=time.perf_counter_ns):
    result = {
        "status": "failure", "region": REGION, "object_key": None,
        "file_bytes": FILE_BYTES, "sha256": None, "elapsed_ns": 0,
        "elapsed_seconds": 0.0, "average_mib_per_second": None,
        "error_category": None, "http_status": None,
        "sdk_retries": 0, "connect_timeout_seconds": CONNECT_SECONDS,
        "read_timeout_seconds": READ_SECONDS, "total_timeout_seconds": TOTAL_SECONDS,
    }
    try:
        run_id = environ.get("GITHUB_RUN_ID", "")
        if not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
            raise ConfigurationError("Invalid GitHub run ID")
        result["object_key"] = f"benchmarks/{run_id}/test-10m.bin"
        with tempfile.TemporaryDirectory(prefix="cos-speed-", dir=environ.get("RUNNER_TEMP")) as directory:
            payload = Path(directory) / "test-10m.bin"
            result["sha256"] = create_payload(payload)
            if (not environ.get("COS_SECRET_ID") or not environ.get("COS_SECRET_KEY")
                    or environ.get("COS_BUCKET") != EXPECTED_BUCKET):
                raise ConfigurationError("Missing credentials or incorrect benchmark bucket")
            with quiet_sdk(), requests.Session() as session:
                session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
                session.hooks["response"].append(forbid_redirect)
                config = CosConfig(
                    Region=REGION, SecretId=environ["COS_SECRET_ID"], SecretKey=environ["COS_SECRET_KEY"],
                    Scheme="https", Timeout=(CONNECT_SECONDS, READ_SECONDS), VerifySSL=True,
                    AllowRedirects=False, AutoSwitchDomainOnRetry=False,
                )
                client = CosS3Client(config, retry=0, session=session)
                with payload.open("rb") as body, request_deadline():
                    started = now_ns()
                    try:
                        client.put_object(
                            Bucket=environ["COS_BUCKET"], Key=result["object_key"], Body=body,
                            ContentLength=str(FILE_BYTES), ContentType="application/octet-stream", EnableMD5=False,
                        )
                    finally:
                        result["elapsed_ns"] = max(0, now_ns() - started)
                        result["elapsed_seconds"] = result["elapsed_ns"] / 1_000_000_000
                result["status"] = "success"
                if result["elapsed_ns"]:
                    result["average_mib_per_second"] = (FILE_BYTES / 1024**2) / result["elapsed_seconds"]
    except Exception as error:
        result["status"] = "failure"
        result["average_mib_per_second"] = None
        result["error_category"], result["http_status"] = classify(error)
    return result


def summary(result):
    rate = result["average_mib_per_second"]
    speed = f"{rate:.6f}" if rate is not None else "unavailable (full upload not confirmed)"
    lines = [
        "## COS upload benchmark", "",
        f"- Status: **{result['status']}**",
        f"- Object Key: `{result['object_key']}`",
        f"- Region: `{REGION}`",
        f"- File bytes: `{result['file_bytes']}` (10 MiB)",
        f"- SHA-256: `{result['sha256']}`",
        f"- Upload elapsed: `{result['elapsed_seconds']:.9f}` seconds (`{result['elapsed_ns']}` ns)",
        f"- Average MiB/s: `{speed}`",
        f"- Error category: `{result['error_category'] or 'none'}`; HTTP status: `{result['http_status']}`",
    ]
    return "\n".join(lines) + "\n"


def main():
    result = benchmark(os.environ)
    # All fields are locally computed values or fixed enums, never SDK responses.
    text = json.dumps(result, ensure_ascii=True, sort_keys=True)
    print(text, flush=True)
    try:
        Path(os.environ["COS_BENCHMARK_RESULT"]).write_text(text + "\n")
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as output:
            output.write(summary(result))
    except (OSError, KeyError):
        print("::error::Could not write benchmark result/summary; no raw exception logged.", flush=True)
        return 1
    if result["status"] != "success":
        print(f"::error::COS upload failed: {result['error_category']}; raw SDK output suppressed.", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
