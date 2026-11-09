#!/usr/bin/env python3
"""Read the config digest from docker-save output (not image inspect's native ID)."""
import hashlib
import json
import re
import sys
import tarfile


def metadata(archive, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit SHA")
    with tarfile.open(archive, "r:gz") as source:
        def read_small(name):
            member = source.getmember(name)
            if not member.isfile() or member.size > 1024 * 1024:
                raise ValueError("Invalid image metadata")
            return source.extractfile(member).read()
        manifests = json.loads(read_small("manifest.json"))
        if len(manifests) != 1 or manifests[0]["RepoTags"] != [f"ghcr.io/stagnantwater657/ekiden-database:{sha}"]:
            raise ValueError("Unexpected archive image")
        config = read_small(manifests[0]["Config"])
        parsed = json.loads(config)
        if parsed["config"]["Labels"]["org.opencontainers.image.revision"] != sha:
            raise ValueError("Unexpected image revision")
        return "sha256:" + hashlib.sha256(config).hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Expected archive path and commit SHA")
    print("config_digest=" + metadata(sys.argv[1], sys.argv[2]))
