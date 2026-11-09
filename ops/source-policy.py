#!/usr/bin/python3 -I
"""Shared, fail-closed GitHub main/CI admission policy. Never print API responses."""
import json
import os
import re
import sys
import urllib.request

REPO = "stagnantwater657/ekiden-database"
REQUIRED_JOBS = {"check", "Docker 29.1.3 containerd archive compatibility",
                 "COS benchmark offline SDK tests", "Source deployment policy and resource limits"}


class PolicyError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise PolicyError("CI_CHECK_FAILED")


def github_json(path, token=None):
    if not path.startswith(f"/repos/{REPO}/"):
        raise PolicyError("CI_CHECK_FAILED")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "ekiden-source-admission"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        request = urllib.request.Request("https://api.github.com" + path, headers=headers)
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            body = response.read(4 * 1024 * 1024 + 1)
            if len(body) > 4 * 1024 * 1024:
                raise PolicyError("CI_CHECK_FAILED")
            return json.loads(body)
    except Exception:
        raise PolicyError("CI_CHECK_FAILED") from None


def approve(sha, token=None, get=None):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise PolicyError("INVALID_SOURCE_SHA")
    get = get or (lambda path: github_json(path, token))
    try:
        if get(f"/repos/{REPO}/branches/main")["commit"]["sha"] != sha:
            raise PolicyError("MAIN_SHA_MISMATCH")
        runs = get(f"/repos/{REPO}/actions/workflows/ci.yml/runs?event=push&head_sha={sha}&per_page=100")["workflow_runs"]
        matching = [r for r in runs if r["event"] == "push" and r["head_sha"] == sha
                    and r["head_branch"] == "main" and r["path"] == ".github/workflows/ci.yml"
                    and r["repository"]["full_name"] == REPO]
        if not matching:
            raise PolicyError("CI_NOT_APPROVED")
        run = max(matching, key=lambda item: item["id"])
        if run["status"] != "completed" or run["conclusion"] != "success":
            raise PolicyError("CI_NOT_APPROVED")
        jobs = get(f"/repos/{REPO}/actions/runs/{run['id']}/jobs?filter=latest&per_page=100")
        passed = {j["name"] for j in jobs["jobs"] if j["status"] == "completed" and j["conclusion"] == "success"}
        if jobs["total_count"] > 100 or not REQUIRED_JOBS <= passed:
            raise PolicyError("CI_NOT_APPROVED")
    except PolicyError:
        raise
    except Exception:
        raise PolicyError("CI_CHECK_FAILED") from None


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise PolicyError("INVALID_SOURCE_SHA")
        approve(sys.argv[1], os.environ.get("GITHUB_TOKEN"))
        print("Current main HEAD has passed all required CI jobs.")
    except PolicyError as error:
        print("::error::Source admission failed: " + str(error))
        sys.exit(1)
