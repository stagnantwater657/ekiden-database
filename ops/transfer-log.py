#!/usr/bin/env python3
"""Allowlisted SSH telemetry only. Never replay raw stdout/stderr or exception text."""
import json
from pathlib import Path
import re
import sys

ERRORS = {
    "SOURCE_HTTP_FORBIDDEN": "Codeload returned HTTP 403; check repository read access.",
    "SOURCE_HTTP_NOT_FOUND": "Codeload returned HTTP 404 for the fixed repository/commit.",
    "SOURCE_CONNECT_TIMEOUT": "Codeload connection timed out.",
    "SOURCE_DOWNLOAD_TOO_LARGE": "Codeload source archive exceeds the compressed size limit.",
    "INVALID_SOURCE_SHA": "Invalid source commit SHA.",
    "SOURCE_CONFIG_INVALID": "Root source configuration is missing, unpinned or writable.",
    "CI_CHECK_FAILED": "GitHub CI admission query failed; no deployment permitted.",
    "CI_NOT_APPROVED": "Current main commit has not passed every required CI job.",
    "MAIN_SHA_MISMATCH": "Requested SHA is no longer the current main HEAD.",
    "SOURCE_FETCH_FAILED": "Fixed-SHA Codeload source download failed.",
    "SOURCE_FETCH_TIMEOUT": "Codeload source download stalled or exceeded its deadline.",
    "SOURCE_ARCHIVE_INVALID": "Codeload archive integrity or structure is invalid or excessive.",
    "DOCKERFILE_APPROVAL_REQUIRED": "Dockerfile differs from the root-approved template.",
    "LOCKFILE_SOURCE_INVALID": "Lockfile contains unapproved dependency sources/integrity.",
    "BUILD_LIMITS_INVALID": "Actual builder/worker cgroup limits were not verified; refusing build.",
    "BUILD_IMAGE_UNAVAILABLE": "Pinned domestic builder/base image is unavailable or builder is stopped.",
    "SOURCE_BUILD_TIMEOUT": "Local containerized build exceeded deadline; dedicated builder stopped.",
    "SOURCE_BUILD_OOM": "Local build hit container or Node heap memory limit; old website retained.",
    "NPM_CI_FAILED": "Containerized npm ci failed; old website retained.",
    "SOURCE_BUILD_FAILED": "Containerized image build failed; old website retained.",
    "SOURCE_IMAGE_IDENTITY_FAILED": "Built image revision does not match requested main SHA.",
    "SOURCE_MIGRATION_REQUIRED": "Administrator must migrate legacy deployment state first.",
    "SOURCE_DISK_LOW": "Less than 12 GiB free; refusing local build.",
    "SOURCE_HEALTH_FAILED": "Activation health check failed; verify application rollback.",
    "UPLOAD_TOTAL_TIMEOUT": "Receiver total upload deadline exceeded; inspect received bytes and average rate.",
    "UPLOAD_STALLED": "Receiver saw no new bytes for 180 seconds; inspect network/stdin relay.",
    "UPLOAD_EOF_TIMEOUT": "All bytes arrived but stdin EOF was missing for 15 seconds; inspect SSH/sudo stdin forwarding.",
    "UPLOAD_INTERRUPTED": "Receiver input closed/interrupted before upload completion.",
    "UPLOAD_TOO_LARGE": "Receiver rejected bytes beyond the declared archive size.",
    "SERVER_IO_FAILED": "Server filesystem/input operation failed; administrator must inspect locally.",
    "TTY_STDIN": "Receiver got a terminal instead of a binary pipe; verify SSH -T and sudo !use_pty.",
    "CHECKSUM_MISMATCH": "Archive arrived but SHA-256 verification failed.",
    "ARCHIVE_INVALID": "Archive/image integrity or format validation failed before docker load.",
    "LOAD_FAILED": "Transfer and archive validation passed, but docker load failed.",
    "LOAD_TIMEOUT": "Transfer passed, but docker load exceeded its 600-second limit.",
    "IMPORT_IDENTITY_FAILED": "Loaded image identity did not match the expected commit.",
    "OPERATION_INTERRUPTED": "Server operation was interrupted by a signal.",
    "REMOTE_REJECTED": "Server rejected the operation; administrator must check root script/configuration.",
    "INTERNAL_ERROR": "Unexpected server error; administrator must inspect locally.",
}
STAGES = {"source_fetch", "source_resource_probe", "source_image_build", "source_build_complete",
          "source_health_check", "source_complete","checksum_verified", "archive_verify", "archive_verified", "load_started",
          "load_complete", "upload_complete", "deploy_complete"}
PROGRESS = re.compile(
    r"EKIDEN (receive_started|receive_progress|receive_complete) received=([0-9]{1,10}) "
    r"total=([0-9]{1,10}) elapsed_s=([0-9]{1,6}) idle_s=([0-9]{1,6}) "
    r"rate_bps=([0-9]{1,15}) window_bps=([0-9]{1,15})"
)


def consume(stream, destination, expected_size, phase):
    result = {"received": 0, "total": expected_size, "elapsed_s": 0, "idle_s": 0,
              "error": None, "complete": False, "telemetry": False, "phase": phase}
    while True:
        raw = stream.readline(513)
        if not raw:
            break
        if not raw.endswith(b"\n"):
            while raw and not raw.endswith(b"\n"):
                raw = stream.readline(513)
            continue
        try:
            line = raw.decode("ascii").rstrip("\r\n")
        except UnicodeDecodeError:
            continue
        match = PROGRESS.fullmatch(line)
        if match and phase == "upload":
            event = match[1]
            received, total, elapsed, idle, rate, window = map(int, match.groups()[1:])
            if total != expected_size or not result["received"] <= received <= total + 1 or idle > elapsed + 1:
                continue
            result.update(received=received, elapsed_s=elapsed, idle_s=idle, telemetry=True)
            print(f"Receiver {event}: {received}/{total} bytes ({100*received/total:.1f}%), "
                  f"avg={rate/1024:.1f} KiB/s window={window/1024:.1f} KiB/s "
                  f"idle={idle}s elapsed={elapsed}s", flush=True)
            continue
        match = re.fullmatch(r"EKIDEN stage name=([a-z_]+)", line)
        if match and match[1] in STAGES:
            name = match[1]
            result["telemetry"] = True
            if name == {"upload": "upload_complete", "deploy": "deploy_complete", "source": "source_complete",
                        "build-source": "source_build_complete"}[phase]:
                result["complete"] = True
            print("Server stage: " + name, flush=True)
            continue
        match = re.fullmatch(r"EKIDEN error code=([A-Z_]+)", line)
        if match and match[1] in ERRORS:
            result["error"] = match[1]
            result["telemetry"] = True
            print("Server error: " + match[1] + " — " + ERRORS[match[1]], flush=True)
    destination.write_text(json.dumps(result))


def check_result(destination, ssh_status, sender_status, logger_status):
    try:
        report = json.loads(destination.read_text())
    except (OSError, ValueError):
        report = {}
    code = report.get("error")
    if code in ERRORS:
        explanation = ERRORS[code]
    elif logger_status:
        code, explanation = "DIAGNOSTICS_FAILED", "Runner telemetry reader failed. Raw SSH output remains suppressed."
    elif ssh_status in (124, 137):
        code, explanation = "CLIENT_TIMEOUT", "Runner SSH deadline expired; check the last receiver stage/progress."
    elif ssh_status == 255:
        code, explanation = "SSH_CONNECTION_FAILED", "SSH handshake/authentication/connection failed or was interrupted."
    elif ssh_status:
        code, explanation = "REMOTE_EXIT", "Remote process failed without a recognized code; check server script/ForceCommand/sudoers."
    elif sender_status:
        code, explanation = "SENDER_FAILED", "Runner could not finish writing the archive into SSH stdin."
    elif not report.get("complete"):
        code, explanation = "ACK_MISSING", "No structured completion acknowledgement; verify the server script upgrade and stdin relay."
    else:
        return 0
    received = report.get("received", 0)
    total = report.get("total", 0)
    detail = f"Receiver last confirmed {received}/{total} bytes. " if report.get("phase", "upload") == "upload" else ""
    print(f"::error::[{code}] {explanation} {detail}"
          f"ssh_exit={ssh_status} sender_exit={sender_status} logger_exit={logger_status}", flush=True)
    return 1


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "stream" and sys.argv[4] in {"upload", "deploy", "source", "build-source"}:
        size = int(sys.argv[3])
        if not 0 < size <= 536870912:
            sys.exit(1)
        consume(sys.stdin.buffer, Path(sys.argv[2]), size, sys.argv[4])
    elif len(sys.argv) == 6 and sys.argv[1] == "result":
        sys.exit(check_result(Path(sys.argv[2]), *map(int, sys.argv[3:])))
    else:
        sys.exit("Invalid diagnostics invocation")
