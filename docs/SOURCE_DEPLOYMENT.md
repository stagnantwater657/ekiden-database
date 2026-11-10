# Ubuntu 本地源码构建部署

本次只提交代码和验证，不连接或修改生产服务器、不触发正式部署。旧镜像流传输/COS 测速工作流文件保留，新流程使用独立 `deploy-source.yml`；不自动选择旧流程。

## 流程与准入

PR → CI → 合并 main → **main push CI 全部通过** → 手动 `Deploy source on Ubuntu (manual)` → SSH 固定命令 → root Codeload 下载固定 SHA → 容器构建 → 仅更新 `ekiden/web` → 健康检查及失败回滚。

新工作流仅允许 main 手动运行，默认 `build_only=true`。Runner 不构建或传输镜像，只发送：

```text
build-source <完整40位小写SHA>
deploy-source <完整40位小写SHA>
```

wrapper 和 root dispatcher 分别严格校验，不接受额外参数、仓库、路径、Dockerfile、构建参数或任意 Shell。构建使用单独的 `/etc/ekiden/source-docker` 配置目录，不读取旧 GHCR 认证配置。sudoers 只委派这两个固定入口；停用旧 upload/deploy 的 SSH 授权，避免绕过源码 CI 准入。旧工作流文件不自动执行，升级后若手动运行旧上传流程会被拒绝。管理员回滚代码仍可直接使用。不给部署用户直接 Git/Docker/Bash 权限，不加入 docker 组，也不修改生产 SSH 配置或取消 ForceCommand。

- Runner 与服务器都查询固定 GitHub 仓库的 main HEAD 和 `ci.yml` 的最新 push run，要求 SHA 完全相同、run 成功，且 `check`、`Docker 29.1.3 containerd archive compatibility`、`COS benchmark offline SDK tests`、`Source deployment policy and resource limits` 四项 job 均成功，不接受跳过或仅 PR 通过的结果。
- PR #7 已增加 main push 的**测试/构建 CI**，不是生产自动部署。main 合并提交通过后才能手动部署。
- root 仅从 `https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/<40位SHA>` 下载；不接受任意 URL，不请求可变 main 压缩包、不跟随重定向。压缩包小于32MiB，完整展开 tar 最大128MiB，实际文件总量最大64MiB、最多10000个成员。完整读取 gzip 验证 CRC，剥离精确 `ekiden-database-<SHA>` 前缀；拒绝重复目标、路径穿越、链接、设备和稀疏文件。解压到 root-only `/var/lib/ekiden/source-builds/source-*`，退出即清理。生产不再调用 Git；遗留 `/var/lib/ekiden/source.git` 不使用、不删除。
- 构建结束后再通过 API 验证 main 和 CI，若 main 已前进，保留构建结果但不激活旧 SHA。
- Dockerfile 必须与 root 安装的 `/etc/ekiden/source-Dockerfile` 完全相同；以后修改 Dockerfile需管理员重新审核更新该模板。固定仓库的源代码、npm 脚本仅在隔离构建中执行，不在宿主机运行 npm。

## 资源保护：为何使用专用 BuildKit

不使用未经验证的 `docker build --memory` 参数。采用受支持的 Buildx `docker-container` driver，专用 builder 名 `ekiden-source`、容器名 `buildx_buildkit_ekiden-source0`：

- 在 Docker 容器受限父 cgroup 对 daemon 与实际 worker 合计硬限制 **1536 MiB（1.5 GiB）/1.25 CPU**，禁止额外 swap。BuildKit 会把 daemon 移入 init 叶节点，不能只检查该叶节点。
- 父级 CPU period 为 100000、quota 125000；BuildKit 最大并行 1，Next.js 生成 worker 1；Node 构建 heap 768 MiB。运行镜像仍采用原有 256 MiB heap/384 MiB Compose 限制。
- 构建超时 20 分钟；单独资源探针最多 120 秒；Codeload 下载总计180秒（连接10秒、低于1字节/秒持续30秒即读停滞失败，最多2次尝试，共享总时限）；不足 12 GiB 空闲磁盘则拒绝。构建日志为 root-only、最多 64 MiB，不回放原始内容到 Actions。
- 每次构建前验证 builder 类型、固定本地 Unix endpoint、实际 Docker HostConfig、**实际 cgroup v2 的 memory.max/cpu.max/memory.swap.max**，再用廉价 Node 探针，从宿主 /proc 核对实际 worker PID 是该容器 ID 对应受限 Docker 父 cgroup 的后代。worker 叶节点可显示 max，但不能脱离该受限父级。只配置了参数但未生效时会失败。
- 专用 builder 只挂载自己的 BuildKit state volume，不挂 Docker socket、SSH 私钥、GitHub token、runtime.env、机器人数据或其他项目目录。拒绝 security.insecure 等授权；Buildx 默认的 network.host 仅作用于 bridge 隔离的 builder，构建客户端不传任何 --allow，因此 Dockerfile 不能使用该特权。Buildx 的 rootful docker-container driver 自身需要 privileged 来运行 OCI worker，只有管理员能配置它，部署用户不能直接控制此 daemon。
- 构建超时或 SSH 中断时仅停止这个专用 BuildKit 容器，以终止残留构建；不停止 Docker Engine 或应用容器。管理员检查后再启动该专用 builder。
- 保留私有 cgroup 命名空间、bridge 网络和隔离 PID；OCI worker 的 `/ekiden-build` 位于容器的 Docker 受限父级之下，不创建宿主全局 worker cgroup，也不更改系统资源控制器。
- 输出镜像加载回宿主 Docker，通过限时180秒、最大2GiB的本地 docker save 归档读取真实 config digest（退出即清理），兼容 Docker 29 native ID 与 config digest 不同、load exporter 缺少该元数据的情况；仅创建绑定 SHA 和实际本地镜像 ID 的 Ekiden 标签；不清理 current/previous 的镜像。BuildKit 自动 GC 关闭，未来缓存占用增加时先告警/拒绝构建，不进行全局 prune。

这些上限不能承诺机器永远不受负载影响。当前可用约 1.7 GiB，给构建 1.5 GiB 的余量较小；管理员应监测现有机器人、swap 和 load，验证通过后才进行首次构建。若资源不够，保持拒绝并调整经审核的上限/机器容量，不关闭限制。cgroup v1 或未委派资源控制的 rootless Docker 不满足本实现，不能跳过探针部署。

## 1. 首次安装 / Bootstrap（当前服务器应走此章）

PR #7 已合并不代表服务器已安装。此章适用于仍使用旧 dispatcher、ForceCommand wrapper 和 sudoers 的服务器；**不要求 Git、ekiden-source.py 或 ekiden-source-policy.py 预先存在**。只供以后经授权的 root 管理员执行，本轮未执行。保持当前 root 会话，暂停人工触发部署；不停止现有站点或机器人。

### 1.1 只读检查与可信输入

以下供**后续已有 root 管理员 shell**执行，不是给 `ekiden-deploy` 任意 sudo；本轮未执行这些服务器命令：

```bash
whoami
uname -m
free -h
swapon --show
df -h /var/lib/docker /var/lib/ekiden
stat -fc %T /sys/fs/cgroup
/usr/bin/docker version
/usr/bin/docker compose version
/usr/bin/docker buildx version
/usr/bin/docker ps --format 'table {{.Names}}\t{{.ID}}\t{{.Status}}\t{{.Ports}}'
/usr/bin/docker image inspect m.daocloud.io/docker.io/library/node:24-bookworm-slim \
  --format '{{json .RepoDigests}}'
id -nG ekiden-deploy
sudo -l -U ekiden-deploy
command -v python3 curl timeout prlimit flock visudo sshd
/usr/sbin/sshd -t
# 用实际管理员来源地址填写，不改变 SSH 配置：
read -r -p '管理员来源 IP: ' ADMIN_IP
/usr/sbin/sshd -T -C "user=ekiden-deploy,host=$(hostname),addr=$ADMIN_IP" | \
  grep -E '^(forcecommand|disableforwarding|permittty|permituserrc|allowtcpforwarding|x11forwarding) '
```

记录 AstrBot、NapCat 实际容器名称/ID、状态、端口及已有业务探针结果，供升级后对比。不修改它们。要求 x86_64、cgroup2fs、Buildx 支持下面的 docker-container memory/CPU options；专用 BuildKit 版本示例为 v0.26.2，需先核验国内镜像来源及对应 Digest，不能假定已安装或已拉取。


必须确认有效 ForceCommand 恰为 `/usr/local/libexec/ekiden-ssh-command`，`permittty no`、`permituserrc no` 且转发禁用。若现有路径不同或限制不足，停止并单独审核 SSH 配置；本流程不自动改 sshd、不 reload、不取消限制。也检查部署账户的 authorized_keys 是否存在覆盖命令/转发限制（在管理员本地看，不将密钥内容贴入日志）。

在可信管理电脑上审核**已合并 main** 的完整 SHA，确认 main push 的四项 CI 成功。先独立下载相同精确 SHA 的 Codeload 归档并计算 SHA-256：

```bash
# 可信管理电脑执行，先把该 SHA 与 GitHub main/CI 页面核对。
read -r -p '已审核 main 完整 SHA: ' REVIEWED_SHA
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
curl --disable --fail --silent --show-error --proto '=https' \
  --connect-timeout 10 --max-time 180 --max-filesize 33554432 \
  --output ekiden-reviewed.tar.gz \
  "https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/$REVIEWED_SHA"
sha256sum ekiden-reviewed.tar.gz
```

私有仓库须在可信电脑通过本地 0600 header 文件增加 `--header @文件`，不可把 token 放到 URL 或命令行。将这里的 SHA-256 通过可信管理通道输入服务器；**不能从服务器同一次未验证下载自行计算一个值作为“期望值”**。若 GitHub 重新生成归档导致摘要变化，停止，在可信端重新审核并下载；不绕过校验。

Codeload 没有本项目提供的独立归档签名。本引导要求 GitHub API 对该 commit 报告 `verification.verified=true`、`reason=valid`，另比对独立取得的归档 SHA-256；HTTPS、提交签名、摘要、main/CI 准入分别校验，不将 gzip CRC 称为签名。未签名/签名无效/摘要不符一律停止，由管理员处理可信发布来源，不临时关闭校验。

### 1.2 无已安装 helper 的独立引导

以下连续块在同一个 root Bash shell 执行，任何失败停止，不继续安装。只创建独立临时目录；API policy 完整内嵌，不导入服务器或下载包中的 helper。内联 Python 使用 -I，忽略 PYTHONOPTIMIZE/PYTHONPATH 等环境注入，不允许关闭断言验证：

```bash
set -euo pipefail
set +x
umask 077
read -r -p '已审核、已合并 main 的完整40位SHA: ' REVIEWED_SHA
read -r -p '可信管理端取得的归档 SHA-256: ' EXPECTED_ARCHIVE_SHA256
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ && "$EXPECTED_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 1
export REVIEWED_SHA EXPECTED_ARCHIVE_SHA256
UPGRADE_DIR=$(mktemp -d /root/ekiden-codeload-upgrade.XXXXXX)
export UPGRADE_DIR
trap 'cd /root; rm -rf -- "$UPGRADE_DIR"' EXIT
# 仅本仓库 Contents/Actions read 的 PAT；公开仓库可留空，不复用 GHCR token。
read -r -s -p 'GitHub read token（公开仓库可留空）: ' BOOTSTRAP_READ_TOKEN
printf '\n'
printf '%s' "$BOOTSTRAP_READ_TOKEN" > "$UPGRADE_DIR/github-read-token"
unset BOOTSTRAP_READ_TOKEN
chmod 0600 "$UPGRADE_DIR/github-read-token"
python3 -I - <<'PY'
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

from pathlib import Path
root = Path(os.environ['UPGRADE_DIR'])
token = (root/'github-read-token').read_text().strip() or None
if token and any(c in token for c in '\r\n\0'): raise SystemExit('Invalid token')
sha = os.environ['REVIEWED_SHA']
approve(sha, token)
commit = github_json(f'/repos/{REPO}/commits/{sha}', token)
if commit['sha'] != sha or not commit['commit']['verification']['verified'] or commit['commit']['verification']['reason'] != 'valid':
    raise SystemExit('Commit signature is not verified; stop bootstrap')
header = root/'header'
header.write_text('Authorization: Bearer '+token+'\n' if token else '')
header.chmod(0o600)
print('Current main, required CI and commit signature verified.')
PY
HTTP_STATUS=$(timeout --kill-after=5s 200s prlimit --fsize=33554432 -- \
  /usr/bin/curl --disable --silent --fail --proto '=https' \
  --connect-timeout 10 --speed-limit 1 --speed-time 30 --max-time 180 \
  --retry 1 --retry-max-time 190 --max-filesize 33554432 \
  --header "@$UPGRADE_DIR/header" --output "$UPGRADE_DIR/source.tar.gz" \
  --write-out '%{http_code}' \
  "https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/$REVIEWED_SHA")
rm -f -- "$UPGRADE_DIR/header"
[[ "$HTTP_STATUS" == 200 ]] || { echo 'Codeload rejected; stop'; exit 1; }
python3 -I - <<'PY'
import gzip, os, shutil, tarfile
import hashlib, hmac, re
from pathlib import Path, PurePosixPath
root = Path(os.environ['UPGRADE_DIR'])
expected = os.environ['EXPECTED_ARCHIVE_SHA256']
if not re.fullmatch(r'[0-9a-f]{64}', expected): raise SystemExit('Invalid trusted archive SHA-256')
actual = hashlib.sha256((root/'source.tar.gz').read_bytes()).hexdigest()
if not hmac.compare_digest(actual, expected): raise SystemExit('Archive SHA-256 mismatch; stop')
raw = root/'source.tar'
prefix = 'ekiden-database-'+os.environ['REVIEWED_SHA']
with gzip.open(root/'source.tar.gz','rb') as src, raw.open('xb') as dst:
    total = 0
    while chunk := src.read(65536):
        total += len(chunk)
        assert total <= 128*1024*1024, 'Expanded tar too large'
        dst.write(chunk)
context = root/'context'; context.mkdir(mode=0o700)
seen = set(); total = 0
with tarfile.open(raw, 'r:') as archive:
    for count, item in enumerate(archive, 1):
        path = PurePosixPath(item.name); parts = path.parts
        assert count <= 10000 and not path.is_absolute() and '..' not in parts
        assert parts and parts[0] == prefix and '\\' not in item.name
        assert (item.isfile() or item.isdir()) and not item.issparse()
        key = str(PurePosixPath(*parts[1:])); assert key not in seen; seen.add(key)
        if len(parts) == 1:
            assert item.isdir(); continue
        total += item.size; assert 0 <= item.size and total <= 64*1024*1024
        target = context.joinpath(*parts[1:])
        if item.isdir(): target.mkdir(mode=0o700, parents=True, exist_ok=True)
        else:
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with archive.extractfile(item) as src, target.open('xb') as dst:
                shutil.copyfileobj(src, dst, 65536)
raw.unlink(); (root/'source.tar.gz').unlink()
print('Archive structure and gzip integrity verified.')
PY
```

上述操作限制压缩包32MiB、完整 tar 128MiB、实际文件64MiB、成员10000；不跟重定向、不禁用 TLS，拒绝链接/设备/穿越/重复目标，错误时 EXIT trap 清理。摘要通过前不解压、不运行包内代码。

### 1.3 验证源码内容与运行离线测试

现在才允许执行经签名、摘要与审核关联的包内代码。先检查安装清单、Dockerfile 和锁文件，再重复 API 准入：

```bash
cd "$UPGRADE_DIR/context"
python3 -I - <<'PY'
import importlib.util, json, os, re
from pathlib import Path
required = ['ops/ekiden-deploy', 'ops/ekiden-source.py', 'ops/source-policy.py',
            'ops/ekiden-ssh-command', 'ops/ekiden-deploy.sudoers', 'ops/source-buildkitd.toml',
            'Dockerfile', 'compose.yaml', 'tests/source_deployment_test.py', 'tests/source_download_test.py', 'tests/bootstrap_docs_test.py']
for name in required:
    p = Path(name)
    if not p.is_file() or p.is_symlink() or not p.stat().st_size: raise SystemExit('Missing approved file')
lock = json.loads(Path('package-lock.json').read_text())
if lock.get('lockfileVersion') != 3: raise SystemExit('Invalid lockfile')
for item in lock['packages'].values():
    if item.get('link'): raise SystemExit('Lockfile link rejected')
    if 'resolved' in item and (not re.fullmatch(r'https://registry\.npmjs\.org/[^?#\s]+', item['resolved']) or not item.get('integrity')):
        raise SystemExit('Invalid dependency source/integrity')
spec = importlib.util.spec_from_file_location('policy', 'ops/source-policy.py')
policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
token = (Path(os.environ['UPGRADE_DIR'])/'github-read-token').read_text().strip() or None
policy.approve(os.environ['REVIEWED_SHA'], token)
print('Required source files, lockfile and main/CI verified.')
PY
# 管理员对照可信端已审核内容检查关键文件，不打印 runtime.env/token。
sha256sum Dockerfile compose.yaml ops/ekiden-deploy.sudoers
python3 tests/source_deployment_test.py
python3 tests/source_download_test.py
python3 tests/deployment_test.py
python3 tests/transfer_diagnostics_test.py
python3 tests/bootstrap_docs_test.py
python3 -m py_compile ops/ekiden-deploy ops/ekiden-source.py ops/source-policy.py
bash -n ops/ekiden-ssh-command ops/runner-source.sh
visudo -cf ops/ekiden-deploy.sudoers
```

不在宿主机执行 npm 脚本，也不在生产跑 OOM/Docker 压力测试。完整应用/Docker/资源测试已由必需 CI 检查。

### 1.4 持锁备份旧部署系统（允许 helper 从未存在）

```bash
install -d -o root -g root -m 0700 /var/backups/ekiden
SOURCE_BACKUP=$(mktemp -d /var/backups/ekiden/source-upgrade.XXXXXX)
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || { echo '已有部署运行，稍后安装'; exit 1; }
# old-files 清单记录哪些文件原先存在；恢复时不能猜测。
for file in /usr/local/sbin/ekiden-deploy /usr/local/libexec/ekiden-ssh-command \
  /usr/local/libexec/ekiden-source.py /usr/local/libexec/ekiden-source-policy.py \
  /etc/sudoers.d/ekiden-deploy /etc/ekiden/compose.yaml /etc/ekiden/runtime.env \
  /etc/ekiden/source-Dockerfile /etc/ekiden/source-buildkitd.toml \
  /etc/ekiden/source-builder.json /etc/ekiden/github-read-token; do
  if [ -e "$file" ]; then
    cp -a --parents "$file" "$SOURCE_BACKUP/"
    printf '%s\n' "$file" >> "$SOURCE_BACKUP/old-files"
  fi
done
install -d -m 0700 "$SOURCE_BACKUP/state"
for file in current previous current.json previous.json; do
  if [ -f "/var/lib/ekiden/$file" ]; then cp -a "/var/lib/ekiden/$file" "$SOURCE_BACKUP/state/$file"; fi
done
/usr/bin/docker ps --format '{{.Names}} {{.ID}} {{.Status}} {{.Ports}}' > "$SOURCE_BACKUP/containers.before"
printf '恢复所需备份路径：%s\n' "$SOURCE_BACKUP"
```

不要复制或打印 SSH 私钥；备份中的 runtime.env、PAT 仍为 root-only。此备份格式也用于第2章增量升级。

### 1.5 首次安装全部 root-owned 文件

继续持锁；只更新固定 Ekiden 路径，不覆盖其他项目：

```bash
install -d -o root -g root -m 0700 /etc/ekiden /etc/ekiden/source-docker \
  /var/lib/ekiden /var/lib/ekiden/source-builds /var/lib/ekiden/ready
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 ops/ekiden-deploy /usr/local/sbin/.ekiden-deploy.new
install -o root -g root -m 0755 ops/ekiden-source.py /usr/local/libexec/.ekiden-source.py.new
install -o root -g root -m 0755 ops/source-policy.py /usr/local/libexec/.ekiden-source-policy.py.new
install -o root -g root -m 0755 ops/ekiden-ssh-command /usr/local/libexec/.ekiden-ssh-command.new
install -o root -g root -m 0440 ops/ekiden-deploy.sudoers /etc/sudoers.d/.ekiden-deploy.new
visudo -cf /etc/sudoers.d/.ekiden-deploy.new
install -o root -g root -m 0600 Dockerfile /etc/ekiden/source-Dockerfile
install -o root -g root -m 0600 ops/source-buildkitd.toml /etc/ekiden/source-buildkitd.toml
install -o root -g root -m 0600 compose.yaml /etc/ekiden/compose.yaml
# 保留已有敏感配置；新站点才创建空 runtime.env。
if [ ! -e /etc/ekiden/runtime.env ]; then install -o root -g root -m 0600 /dev/null /etc/ekiden/runtime.env; fi
chown root:root /etc/ekiden/runtime.env
chmod 0600 /etc/ekiden/runtime.env
if [ -s "$UPGRADE_DIR/github-read-token" ]; then
  install -o root -g root -m 0600 "$UPGRADE_DIR/github-read-token" /etc/ekiden/github-read-token
fi
mv -f /usr/local/libexec/.ekiden-source.py.new /usr/local/libexec/ekiden-source.py
mv -f /usr/local/libexec/.ekiden-source-policy.py.new /usr/local/libexec/ekiden-source-policy.py
mv -f /usr/local/sbin/.ekiden-deploy.new /usr/local/sbin/ekiden-deploy
mv -f /etc/sudoers.d/.ekiden-deploy.new /etc/sudoers.d/ekiden-deploy
mv -f /usr/local/libexec/.ekiden-ssh-command.new /usr/local/libexec/ekiden-ssh-command
visudo -c
EKIDEN_IMAGE="ekiden-source:$REVIEWED_SHA" /usr/bin/docker compose \
  --project-name ekiden --project-directory /etc/ekiden --env-file /dev/null \
  -f /etc/ekiden/compose.yaml config --quiet
flock -u 9
exec 9>&-
# 若存在旧文本状态，先由新 root 程序迁移；不在已持同一锁时调用。
if [ -f /var/lib/ekiden/current ] && [ ! -f /var/lib/ekiden/current.json ]; then
  /usr/local/sbin/ekiden-deploy migrate
fi
```

迁移只核对现有 Ekiden 健康状态/本地镜像，写 JSON 及本地标签，不重启容器。不允许忽略不可识别或缺失镜像的旧状态；迁移失败即停止，不能删状态“重新开始”。

| 仓库文件 | 服务器位置 / 模式 |
| --- | --- |
| ops/ekiden-deploy | /usr/local/sbin/ekiden-deploy 0755 |
| ops/ekiden-source.py | /usr/local/libexec/ekiden-source.py 0755 |
| ops/source-policy.py | /usr/local/libexec/ekiden-source-policy.py 0755 |
| ops/ekiden-ssh-command | /usr/local/libexec/ekiden-ssh-command 0755 |
| ops/ekiden-deploy.sudoers | /etc/sudoers.d/ekiden-deploy 0440 |
| Dockerfile | /etc/ekiden/source-Dockerfile 0600 |
| ops/source-buildkitd.toml | /etc/ekiden/source-buildkitd.toml 0600 |
| compose.yaml | /etc/ekiden/compose.yaml 0600 |

另由管理员配置 root-only source-builder.json 和 GitHub 只读 token（公开仓库可匿名）；runtime.env 和状态独立于代码。所有父路径不可由部署用户写入。Runner 的 transfer-log.py 无需服务器安装。

### 1.6 验证 ForceCommand、sudoers 与固定协议

```bash
/usr/sbin/sshd -t
/usr/sbin/sshd -T -C "user=ekiden-deploy,host=$(hostname),addr=$ADMIN_IP" | \
  grep -E '^(forcecommand|disableforwarding|permittty|permituserrc) '
visudo -c
sudo -l -U ekiden-deploy
id -nG ekiden-deploy
namei -l /usr/local/sbin/ekiden-deploy /usr/local/libexec/ekiden-ssh-command \
  /usr/local/libexec/ekiden-source.py /etc/ekiden/compose.yaml /etc/ekiden/source-docker
# 以下必须全部拒绝；不会执行成功的 deploy-source/build-source。
for command in 'id' 'deploy-source main' 'build-source AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
  'build-source aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra' \
  'build-source aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;id'; do
  if runuser -u ekiden-deploy -- env "SSH_ORIGINAL_COMMAND=$command" \
    /usr/local/libexec/ekiden-ssh-command; then echo 'Unexpected protocol access'; exit 1; fi
done
# sudo 的 -l 只查询授权，不运行下面的程序；查询成功则视为权限过宽并停止。
for program in /bin/bash /usr/bin/docker /usr/bin/git; do
  if runuser -u ekiden-deploy -- sudo -n -l -- "$program" >/dev/null 2>&1; then
    echo 'Unexpected sudo grant'; exit 1
  fi
done
```

期望仅授权 `/usr/local/sbin/ekiden-deploy build-source *` 和 `deploy-source *`，root 程序再严格检查唯一 SHA。检查其他 sudoers/组不能间接放开权限，不允许 docker 组或任意 shell。离线测试已用模拟 sudo 验证合法命令确实转发、注入/额外参数被拒绝。此处不拿真实 SHA 执行正向部署测试。

SSH ForceCommand 路径不变，仅替换 wrapper 内容；保留专用密钥、严格 known_hosts、无交互/无转发配置。真正 SSH 正向验证留给管理员完成授权后的 build-only 工作流，仍不开放普通 Shell。

### 1.7 已缓存镜像 Digest 与专用 Builder

使用服务器已经下载的 Node 24 和 BuildKit v0.26.2，先核对本地 RepoDigests，不为简化而切换国外源或重新 pull：

```bash
/usr/bin/docker image inspect m.daocloud.io/docker.io/moby/buildkit:v0.26.2 --format '{{json .RepoDigests}}'
/usr/bin/docker image inspect m.daocloud.io/docker.io/library/node:24-bookworm-slim --format '{{json .RepoDigests}}'
```

将核对后的 `sha256:<64位摘要>` 分别填到下方提示。不要拿 Docker 29 的 `.Id` 代替 Registry Digest；不使用 latest 或未固定的生产 tag。若来源、manifest、拉取或 Node 24 验证失败，停止准备，不清空 Docker、不切换国外源。

```bash
read -r -p '已核验 Node Registry Digest（sha256:...）: ' NODE_DIGEST
read -r -p '已核验 BuildKit Registry Digest（sha256:...）: ' BUILDKIT_DIGEST
[[ "$NODE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ && "$BUILDKIT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
NODE_IMAGE="m.daocloud.io/docker.io/library/node:24-bookworm-slim@$NODE_DIGEST"
BUILDKIT_IMAGE="m.daocloud.io/docker.io/moby/buildkit:v0.26.2@$BUILDKIT_DIGEST"
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || exit 1
printf '{"node_image":"%s","buildkit_image":"%s"}\n' "$NODE_IMAGE" "$BUILDKIT_IMAGE" > /etc/ekiden/source-builder.json
chown root:root /etc/ekiden/source-builder.json
chmod 0600 /etc/ekiden/source-builder.json
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null
/usr/bin/docker image inspect "$BUILDKIT_IMAGE" >/dev/null
/usr/bin/docker run --rm --pull never --network none --memory 128m --memory-swap 128m --cpus 0.25 "$NODE_IMAGE" node --version
/usr/bin/docker run --rm --pull never --network none --entrypoint buildkitd "$BUILDKIT_IMAGE" --version

# 仅首次创建；若同名存在则停止并检查，不能覆盖未知实例。
/usr/bin/docker --host unix:///var/run/docker.sock --config /etc/ekiden/source-docker buildx ls
/usr/bin/docker ps -a --filter name=buildx_buildkit_ekiden-source0
if /usr/bin/docker --host unix:///var/run/docker.sock --config /etc/ekiden/source-docker buildx inspect ekiden-source >/dev/null 2>&1; then echo 'Builder exists; inspect instead of replacing'; exit 1; fi
if /usr/bin/docker container inspect buildx_buildkit_ekiden-source0 >/dev/null 2>&1; then echo 'Builder container exists; stop setup'; exit 1; fi
/usr/bin/docker --host unix:///var/run/docker.sock --config /etc/ekiden/source-docker buildx create \
  --name ekiden-source --driver docker-container \
  --driver-opt "image=$BUILDKIT_IMAGE" \
  --driver-opt memory=1536m,memory-swap=1536m,cpu-period=100000,cpu-quota=125000 \
  --buildkitd-flags '--oci-worker-gc=false' \
  --buildkitd-config /etc/ekiden/source-buildkitd.toml \
  --bootstrap unix:///var/run/docker.sock

/usr/bin/docker inspect buildx_buildkit_ekiden-source0 \
  --format 'Memory={{.HostConfig.Memory}} Swap={{.HostConfig.MemorySwap}} Quota={{.HostConfig.CpuQuota}} Period={{.HostConfig.CpuPeriod}} Mounts={{json .Mounts}}'
# 核对宿主 Docker 父级，而非 BuildKit 移入的 init 叶节点：
BUILDER_PID=$(/usr/bin/docker inspect --format '{{.State.Pid}}' buildx_buildkit_ekiden-source0)
BUILDER_ID=$(/usr/bin/docker inspect --format '{{.Id}}' buildx_buildkit_ekiden-source0)
BUILDER_CGROUP=$(awk -F: '$1=="0" {print $3}' "/proc/$BUILDER_PID/cgroup")
printf 'ID=%s cgroup=%s\n' "$BUILDER_ID" "$BUILDER_CGROUP"
# systemd 常见：/system.slice/docker-<完整ID>.scope/init
# cgroupfs 常见：/docker/<完整ID>/init
# 去掉 /init 后，读取 Docker 容器父级（具体路径必须含上述完整 ID）：
BUILDER_PARENT=${BUILDER_CGROUP%/init}
cat "/sys/fs/cgroup$BUILDER_PARENT/memory.max" "/sys/fs/cgroup$BUILDER_PARENT/cpu.max" "/sys/fs/cgroup$BUILDER_PARENT/memory.swap.max"
unset BUILDER_PID BUILDER_ID BUILDER_CGROUP BUILDER_PARENT
flock -u 9
exec 9>&-
unset NODE_DIGEST BUILDKIT_DIGEST NODE_IMAGE BUILDKIT_IMAGE
```

Docker 容器父级实际预期为 `1610612736`、`125000 100000`、`0`。挂载只有自身 `buildx_buildkit_ekiden-source0_state` 到 `/var/lib/buildkit`。程序识别包含完整容器 ID 的 Docker 父级，并核对真实 worker PID 的祖先关系。若父级显示 max、宿主总量或 worker 逃离该父级则拒绝部署；不能仅凭 HostConfig 判定，也不能跳过探针。

Docker Engine 中已缓存 Node 镜像**不代表专用 BuildKit 内容缓存已预热**。首次 worker 探针可能仍从同一国内镜像源拉取一次 Node；同时 Buildx bootstrap 也可能向配置的国内 BuildKit 源核验镜像。Dockerfile 不再请求额外的国外 Dockerfile frontend 镜像，不能将 frontend/BuildKit 的国外下载隐藏在初始化过程中。

构建期间另一个管理员终端可 `docker stats --no-stream buildx_buildkit_ekiden-source0`，同时观察 `free -h`、`swapon --show` 和机器人既有探针。**不要在生产机上运行 OOM 压力测试**；硬 OOM 拦截和受限应用构建在本 PR 隔离 CI daemon 中验证。

### 1.8 第一次仅构建，不启动网站

保持 `build_only=true` 手动运行新工作流前，先完成安装验收并获得构建测试授权。本轮不触发它。其命令为 `build-source <SHA>`，会执行完整资源探针、受限本地构建及镜像 revision 校验，不执行 Compose up，不推进 current/previous。也可由已授权 root 管理员执行：

```bash
/usr/local/sbin/ekiden-deploy build-source "$REVIEWED_SHA"
/usr/bin/docker ps --format '{{.Names}} {{.ID}} {{.Status}} {{.Ports}}'
# 与备份 containers.before 比较 AstrBot/NapCat 的 ID、状态、端口及既有业务探针。
# 退出管理会话或完成验证后清理临时源代码/凭据，不删除备份：
cd /root
rm -rf -- "$UPGRADE_DIR"
trap - EXIT
unset UPGRADE_DIR REVIEWED_SHA EXPECTED_ARCHIVE_SHA256
```

期望 source_build_complete；仅新增 ready 和本地镜像，站点未启动/未更新。若有旧站点，先后读取 current/previous 和健康接口确认未变。首次没有网站时，127.0.0.1:3001 可能尚未监听，这不授权自动激活。仅限此 builder 可在超时后被停止，机器人和 Engine 不停止。

### 1.9 首次安装失败：恢复旧程序、wrapper、sudoers 和配置

适用于安装中途失败或 build-only 失败；**从未激活新应用时**恢复配置，不需要停止站点。保持 root 会话；先不再人工触发 Actions，持同一锁。下列固定清单会恢复旧文件，若新 helper/配置安装前不存在则删除该新文件，不删除目录/镜像/卷：

```bash
read -r -p '安装前备份目录完整路径: ' SOURCE_BACKUP
[[ "$SOURCE_BACKUP" == /var/backups/ekiden/source-upgrade.* && -f "$SOURCE_BACKUP/old-files" ]] || exit 1
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || exit 1
visudo -cf "$SOURCE_BACKUP/etc/sudoers.d/ekiden-deploy"
for file in /usr/local/sbin/ekiden-deploy /usr/local/libexec/ekiden-ssh-command \
  /usr/local/libexec/ekiden-source.py /usr/local/libexec/ekiden-source-policy.py \
  /etc/sudoers.d/ekiden-deploy /etc/ekiden/compose.yaml /etc/ekiden/runtime.env \
  /etc/ekiden/source-Dockerfile /etc/ekiden/source-buildkitd.toml \
  /etc/ekiden/source-builder.json /etc/ekiden/github-read-token; do
  if grep -Fxq "$file" "$SOURCE_BACKUP/old-files"; then
    cp -a -- "$SOURCE_BACKUP$file" "$file.restore"
    mv -f -- "$file.restore" "$file"
  else
    rm -f -- "$file"
  fi
done
visudo -c
/usr/sbin/sshd -t
flock -u 9
exec 9>&-
/usr/bin/docker ps --format '{{.Names}} {{.ID}} {{.Status}} {{.Ports}}'
```

**不自动还原过期状态文件**。migrate 仅新增 JSON 时可保留；旧版程序/状态格式是否兼容由管理员对照备份确认。若正式部署曾成功，先用仍安装的新程序 `rollback` 并验证旧站健康，再评估恢复程序/配置；不能直接覆盖状态或更换不匹配 Compose。新 builder/state volume 可保留空闲，不执行 prune/down、不删除镜像，不重启 Engine/机器人。需要暂停它时仅 `docker stop buildx_buildkit_ekiden-source0`，不能匹配其他容器。路径相同无需重载 SSH。

## 2. 以后版本增量升级（已完成首次安装后）

此章不适用于目前的旧服务器。先确认全部 source helper/policy/wrapper/sudoers 已安装；不以“GitHub 已合并”作为判断。下载仍不需要 Git，也不必信任已安装 helper：复用 **1.1–1.3 的独立内嵌 API/签名/独立归档摘要/安全解压/测试**，得到已验证的 `$UPGRADE_DIR/context`。再执行 **1.4 同一备份步骤**，保持部署锁。

若仅升级本 PR #8 的下载链路，且其他文件与批准版本相同，只更新两项：

```bash
install -o root -g root -m 0755 ops/ekiden-source.py /usr/local/libexec/.ekiden-source.py.new
install -o root -g root -m 0755 ops/ekiden-deploy /usr/local/sbin/.ekiden-deploy.new
mv -f /usr/local/libexec/.ekiden-source.py.new /usr/local/libexec/ekiden-source.py
mv -f /usr/local/sbin/.ekiden-deploy.new /usr/local/sbin/ekiden-deploy
flock -u 9
exec 9>&-
```

不重建 builder、不重写敏感配置；如果未来 policy、wrapper、sudoers、Dockerfile 或 Compose 发生变化，必须审核相应 diff，并使用1.5的对应安装/语法/权限验证步骤，不默认跳过。之后重复1.6权限核查和1.8 build-only，失败用1.9同一固定清单恢复。保持原有 current/previous 和镜像；不得用旧状态覆盖已成功部署的版本。

## 3. 首次正式部署、健康检查和回滚

仅在 build-only 成功、机器人无异常并获得首次部署授权后，重新手动运行新工作流，取消勾选 build_only。旧镜像上传和 COS 工作流不必运行。

root 使用原锁 `/run/lock/ekiden-deploy.lock` 串行化整个流程；构建/下载/准入失败不调用 Compose。构建成功且二次确认 main/CI 后复用既有 `activate()`，只执行固定项目 `ekiden` 的 `web` 服务更新。健康通过后才推进 current，保存旧版本 previous；健康失败恢复旧站并复验。首次无历史版本失败只停止 Ekiden web，不操作其他项目。这不是零停机蓝绿部署。

管理员只读验收：

```bash
curl --fail --silent http://127.0.0.1:3001/api/health
printf '\n'
cat /var/lib/ekiden/current.json
cat /var/lib/ekiden/previous.json  # 首次部署可能不存在
ss -lnt | grep '127.0.0.1:3001'
/usr/bin/docker ps --format 'table {{.Names}}\t{{.ID}}\t{{.Status}}\t{{.Ports}}'
```

对比之前记录的 AstrBot/NapCat 容器 ID、状态、端口与原有业务探针；本流程不删除、重启或重建它们。网站继续只监听 `127.0.0.1:3001`。

管理员应用回滚（不开放 SSH rollback 子命令）：

```bash
/usr/local/sbin/ekiden-deploy rollback
```

不得删除 current/previous 的本地固定标签或镜像。构建超时/中断后专用 builder 可能已停止，管理员先看 root-only 本地诊断及资源，确认可继续后仅启动它：`docker start buildx_buildkit_ekiden-source0`，重新核对限制；不是重启 Docker Engine。

### 错误分类

Actions 只显示白名单固定阶段/代码，不回放 curl、API、npm 的原始输出或 token。源码临时目录退出时清理，构建日志限制在该 root-only 临时目录，失败退出也清理；需要深查时管理员应在授权的 build-only 调试中受控收集，勿将敏感配置贴入 PR。

- `CI_NOT_APPROVED` / `CI_CHECK_FAILED` / `MAIN_SHA_MISMATCH`：准入或 main 已变化，拒绝部署。
- `SOURCE_FETCH_FAILED` / `SOURCE_FETCH_TIMEOUT`：Codeload 下载中断/读取停滞/整体超时。
- `SOURCE_CONNECT_TIMEOUT`：Codeload 连接超时。
- `SOURCE_HTTP_FORBIDDEN` / `SOURCE_HTTP_NOT_FOUND`：HTTP 403/404，检查仓库读取权限与提交存在性，不回放响应。
- `SOURCE_DOWNLOAD_TOO_LARGE` / `SOURCE_ARCHIVE_INVALID`：下载超限或压缩包完整性/结构错误。
- `BUILD_IMAGE_UNAVAILABLE`：国内镜像/预加载镜像不可用、专用 builder 未运行，或资源准备未完成。
- `BUILD_LIMITS_INVALID`：实际 driver、挂载或 cgroup/worker 限制不合格。
- `NPM_CI_FAILED`：容器内依赖安装失败；不修改 lock integrity 或禁用 TLS。
- `SOURCE_BUILD_OOM` / `SOURCE_BUILD_TIMEOUT` / `SOURCE_BUILD_FAILED`：内存/heap、20 分钟时限或其他构建失败，旧站不替换。
- `SOURCE_DISK_LOW`：少于 12 GiB 空间，不构建、不全局清理。
- `SOURCE_HEALTH_FAILED`：新站健康失败，检查原有回滚结果，不碰其他服务。

## 4. 成功后如何启用 main 自动部署

**本 PR 不启用。** 稳定完成若干次 build-only、正式更新及回滚验证后，再单独审核增加新 workflow 的 `workflow_run` 触发器：仅在 `workflows: [CI]`、`types: [completed]`、`branches: [main]`，且上游事件为 push、结论 success 时运行。使用上游 `head_sha`，不是 workflow_run 事件自身的 github.sha，并保留 Runner/服务器的 main HEAD + 全部 CI job 校验。

该改动需要同时调整 job 的事件条件及 checkout ref，防止从 PR workflow_run 接收不受信任代码。仍使用 production Environment 审批、同一 `ekiden-production` 并发组与服务端锁。不要仅添加一个绕过 CI 的 push 部署，也不要因 main 更新使旧 SHA 获得准入。
