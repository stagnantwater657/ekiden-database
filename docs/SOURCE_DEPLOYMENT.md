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
- 因旧 CI 只在 PR 触发，本 PR 增加 main push 的**测试/构建 CI**，不是生产自动部署。main 合并提交通过后才能手动部署。
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

## 1. 升级前只读检查

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
```

记录 AstrBot、NapCat 实际容器名称/ID、状态、端口及已有业务探针结果，供升级后对比。不修改它们。要求 x86_64、cgroup2fs、Buildx 支持下面的 docker-container memory/CPU options；专用 BuildKit 版本示例为 v0.26.2，需先核验国内镜像来源及对应 Digest，不能假定已安装或已拉取。

## 2. 获取代码与备份

无需使用 `/root/ekiden-bootstrap` 或 Git。以下在**后续已授权的 root shell**中运行；先在 GitHub 审核已合并 main 的完整 SHA，并等待其 main push CI 全部成功。使用 PR #7 已安装且 root 控制的准入程序验证 API（不执行下载包内代码）：

```bash
set -euo pipefail
set +x
umask 077
read -r -p '已审核且已合并 main 的完整40位SHA: ' REVIEWED_SHA
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
export REVIEWED_SHA
UPGRADE_DIR=$(mktemp -d /root/ekiden-codeload-upgrade.XXXXXX)
export UPGRADE_DIR
trap 'cd /root; rm -rf -- "$UPGRADE_DIR"' EXIT
python3 - <<'PY'
import importlib.util, os
from pathlib import Path
path = Path('/usr/local/libexec/ekiden-source-policy.py')
assert path.stat().st_uid == 0 and not path.stat().st_mode & 0o022 and not path.is_symlink()
spec = importlib.util.spec_from_file_location('approved_policy', path)
policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
token_path = Path('/etc/ekiden/github-read-token')
token = None
if token_path.exists():
    assert token_path.stat().st_uid == 0 and not token_path.stat().st_mode & 0o077 and not token_path.is_symlink()
    token = token_path.read_text().strip()
    assert token and not any(c in token for c in '\r\n\0')
policy.approve(os.environ['REVIEWED_SHA'], token)
header = Path(os.environ['UPGRADE_DIR'])/'header'
header.write_text('Authorization: Bearer '+token+'\n' if token else '')
header.chmod(0o600)
print('Current main HEAD and all required CI jobs verified.')
PY
# 32MiB 文件硬上限；连接10秒、停滞30秒、单请求180秒，至多重试一次；总计200秒。
# 无 -L、不降低 TLS；header 不进入 argv/URL/日志。只请求固定 Codeload 域名。
HTTP_STATUS=$(timeout --kill-after=5s 200s prlimit --fsize=33554432 -- \
  /usr/bin/curl --disable --silent --fail --proto '=https' \
  --connect-timeout 10 --speed-limit 1 --speed-time 30 --max-time 180 \
  --retry 1 --retry-max-time 190 --max-filesize 33554432 \
  --header "@$UPGRADE_DIR/header" --output "$UPGRADE_DIR/source.tar.gz" \
  --write-out '%{http_code}' \
  "https://codeload.github.com/stagnantwater657/ekiden-database/tar.gz/$REVIEWED_SHA")
rm -f -- "$UPGRADE_DIR/header"
[[ "$HTTP_STATUS" == 200 ]] || { echo 'Codeload rejected; stop upgrade'; exit 1; }
```

在独立目录先完整验证 gzip，再安全剥离固定 SHA 前缀。此引导解压程序直接供管理员审阅，不依赖尚未安装的新脚本，也不执行压缩包里的程序：

```bash
python3 - <<'PY'
import gzip, os, shutil, tarfile
from pathlib import Path, PurePosixPath
root = Path(os.environ['UPGRADE_DIR'])
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
cd "$UPGRADE_DIR/context"
# 再用新版本相同的准入规则验证 main/CI；token 仅用于 API，不输出。
python3 - <<'PY'
import importlib.util, os
from pathlib import Path
spec = importlib.util.spec_from_file_location('policy', 'ops/source-policy.py')
policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
p = Path('/etc/ekiden/github-read-token')
policy.approve(os.environ['REVIEWED_SHA'], p.read_text().strip() if p.exists() else None)
PY
python3 tests/source_deployment_test.py
python3 tests/source_download_test.py
python3 tests/deployment_test.py
python3 -m py_compile ops/ekiden-deploy ops/ekiden-source.py ops/source-policy.py
# 引导仅运行已审核的 Python Mock 测试；不在宿主机运行 npm 脚本。
```

任何错误均停止，EXIT trap 清理下载/部分解压目录；不要继续安装。Gzip CRC 只证明传输/格式完整，提交身份和 main/CI 准入由固定 GitHub API + 精确 SHA HTTPS URL 共同约束。不要关闭 API 校验或换成分支压缩包地址。

测试通过后备份旧程序及状态，持用原部署锁：

```bash
install -d -o root -g root -m 0700 /var/backups/ekiden
SOURCE_BACKUP=$(mktemp -d /var/backups/ekiden/source-upgrade.XXXXXX)
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || { echo '已有部署运行，稍后升级'; exit 1; }
cp -a /usr/local/sbin/ekiden-deploy "$SOURCE_BACKUP/ekiden-deploy"
cp -a /usr/local/libexec/ekiden-source.py "$SOURCE_BACKUP/ekiden-source.py"
cp -a /usr/local/libexec/ekiden-source-policy.py "$SOURCE_BACKUP/ekiden-source-policy.py"
cp -a /usr/local/libexec/ekiden-ssh-command "$SOURCE_BACKUP/ekiden-ssh-command"
cp -a /etc/sudoers.d/ekiden-deploy "$SOURCE_BACKUP/ekiden-deploy.sudoers"
cp -a /etc/ekiden/compose.yaml "$SOURCE_BACKUP/compose.yaml"
for file in current previous current.json previous.json; do
  if [ -f "/var/lib/ekiden/$file" ]; then cp -a "/var/lib/ekiden/$file" "$SOURCE_BACKUP/$file"; fi
done
printf '备份路径：%s\n' "$SOURCE_BACKUP"
```

保留当前管理连接及备份路径。已有状态不删除、不改写；本次无需迁移状态。

## 3. 原子安装受信任代码和 sudoers

本次增量升级仅更新两个服务器文件：source helper 和 dispatcher 的安全错误码白名单。继续上面的持锁 root shell：

```bash
install -o root -g root -m 0755 ops/ekiden-source.py /usr/local/libexec/.ekiden-source.py.new
install -o root -g root -m 0755 ops/ekiden-deploy /usr/local/sbin/.ekiden-deploy.new
mv -f /usr/local/libexec/.ekiden-source.py.new /usr/local/libexec/ekiden-source.py
mv -f /usr/local/sbin/.ekiden-deploy.new /usr/local/sbin/ekiden-deploy
flock -u 9
exec 9>&-
cd /root
rm -rf -- "$UPGRADE_DIR"
trap - EXIT
unset UPGRADE_DIR REVIEWED_SHA
```

无需更新 sudoers、SSH wrapper、source-policy.py、Dockerfile 模板、BuildKit 配置、Compose 或 runtime.env；不需 reload SSH、不改变资源限额。`ops/transfer-log.py` 由 Actions 从仓库读取，随合并更新，无需安装到服务器。旧脚本/状态的备份保持 root-only。

### GitHub 只读认证

Runner 使用有 `contents: read` 和 `actions: read` 的自动 `GITHUB_TOKEN` 核对 CI，不将它发送到服务器。服务器需要自己的 GitHub 只读凭据；**Codeload 已通不代表 CI API 有权限**。

私有仓库使用仅授权本仓库的 fine-grained PAT，Repository permissions 只需 **Contents: read、Actions: read**（及默认 metadata read），不要写权限、组织全局权限。公开仓库可匿名请求，但限流/请求失败同样拒绝部署。管理员将服务器自己的 token 隐藏输入到固定 root-only 文件：

```bash
umask 077
read -r -s -p '仅本仓库 Contents/Actions read 的 GitHub token: ' EKIDEN_READ_TOKEN
printf '\n'
printf '%s\n' "$EKIDEN_READ_TOKEN" > /etc/ekiden/github-read-token
unset EKIDEN_READ_TOKEN
chown root:root /etc/ekiden/github-read-token
chmod 0600 /etc/ekiden/github-read-token
```

不要 set -x、打印该文件或将它写入仓库。token 只供固定 GitHub API 和 Codeload HTTPS 请求使用。Codeload header 存在 root-only 临时文件，通过 curl --header @file 读取，退出清理；不在 URL、命令行参数或日志中，也不进入构建环境；构建没有 SSH 密钥/凭据挂载。

## 4. 国内镜像、Digest 和实际资源限制验证

Node 已拉取的结果可以复用做检查；专用 BuildKit 镜像尚未验证，必须由管理员确认。只使用国内 DaoCloud HTTPS 地址，无国外 fallback：

```bash
/usr/bin/docker manifest inspect m.daocloud.io/docker.io/moby/buildkit:v0.26.2 >/dev/null
/usr/bin/docker pull m.daocloud.io/docker.io/moby/buildkit:v0.26.2
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
printf '{"node_image":"%s","buildkit_image":"%s"}\n' "$NODE_IMAGE" "$BUILDKIT_IMAGE" > /etc/ekiden/source-builder.json
chown root:root /etc/ekiden/source-builder.json
chmod 0600 /etc/ekiden/source-builder.json
/usr/bin/docker image inspect "$NODE_IMAGE" >/dev/null
/usr/bin/docker image inspect "$BUILDKIT_IMAGE" >/dev/null
/usr/bin/docker run --rm --network none "$NODE_IMAGE" node --version

# 仅首次创建；同名 builder 已存在时先检查，不覆盖未知实例。
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
unset NODE_DIGEST BUILDKIT_DIGEST NODE_IMAGE BUILDKIT_IMAGE
```

Docker 容器父级实际预期为 `1610612736`、`125000 100000`、`0`。挂载只有自身 `buildx_buildkit_ekiden-source0_state` 到 `/var/lib/buildkit`。程序识别包含完整容器 ID 的 Docker 父级，并核对真实 worker PID 的祖先关系。若父级显示 max、宿主总量或 worker 逃离该父级则拒绝部署；不能仅凭 HostConfig 判定，也不能跳过探针。

Docker Engine 中已缓存 Node 镜像**不代表专用 BuildKit 内容缓存已预热**。首次 worker 探针可能仍从同一国内镜像源拉取一次 Node；同时 Buildx bootstrap 也可能向配置的国内 BuildKit 源核验镜像。Dockerfile 不再请求额外的国外 Dockerfile frontend 镜像，不能将 frontend/BuildKit 的国外下载隐藏在初始化过程中。

构建期间另一个管理员终端可 `docker stats --no-stream buildx_buildkit_ekiden-source0`，同时观察 `free -h`、`swapon --show` 和机器人既有探针。**不要在生产机上运行 OOM 压力测试**；硬 OOM 拦截和受限应用构建在本 PR 隔离 CI daemon 中验证。

## 5. 第一次仅构建，不激活

合并本 PR 后，先等待该 main SHA 的所有 CI 通过，再运行新 `Deploy source on Ubuntu (manual)`，选择 main，保持默认 `build_only=true`。

预期：源码/CI 准入、资源探针、本地镜像构建及 revision 校验成功，日志出现 `source_build_complete`。只新增 ready/本地镜像，不改变 current、previous 或现有网站。CLI 不接受用户填写 SHA 输入，使用触发时 GitHub 的完整 main SHA。

国内 npm 使用 `https://registry.npmmirror.com`，保留 npm ci。当前锁文件 432 个 resolved 都为 npm 官方源且均有 integrity；构建中的 Node helper 仅替换这些 URL 的 origin，版本/integrity 不变。遇到新外部 URL、带凭据 URL、本地链接或缺 integrity 的包会失败；仓库 lockfile 不改写。GitHub CI 默认仍使用官方 Node/registry，TLS 和 npm strict-ssl 不降低。

## 6. 首次正式部署、健康检查和回滚

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

## 7. 恢复旧部署程序

先停止人工触发部署，持锁，从之前记录的备份**原子恢复** dispatcher、source helper；不恢复过期的 current/previous 状态覆盖已成功部署版本。专用 BuildKit 可保留，不影响旧站或机器人。恢复时必须同时恢复匹配的旧 source helper，避免新旧接口不一致。

```bash
read -r -p '升级前备份目录完整路径: ' SOURCE_BACKUP
[[ "$SOURCE_BACKUP" == /var/backups/ekiden/source-upgrade.* && -d "$SOURCE_BACKUP" ]] || exit 1
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || exit 1
visudo -cf "$SOURCE_BACKUP/ekiden-deploy.sudoers"
install -o root -g root -m 0755 "$SOURCE_BACKUP/ekiden-deploy" /usr/local/sbin/.ekiden-deploy.restore
install -o root -g root -m 0755 "$SOURCE_BACKUP/ekiden-source.py" /usr/local/libexec/.ekiden-source.py.restore
mv -f /usr/local/sbin/.ekiden-deploy.restore /usr/local/sbin/ekiden-deploy
mv -f /usr/local/libexec/.ekiden-source.py.restore /usr/local/libexec/ekiden-source.py
visudo -c
flock -u 9
exec 9>&-
```

恢复到 PR #7 会恢复 Git 依赖；网络未恢复时只能保持现有站点及管理员应用回滚，不要反复 fetch 或部署。恢复程序不代表应重跑旧的跨境镜像上传。新流程与旧上传流程使用同一 JSON 状态格式，旧 dispatcher 的管理员 rollback 仍可使用已保存的本地引用。不要覆盖运行配置、删除 builder state volume、清空 Docker 数据或对其他项目执行 compose down。

## 8. 成功后如何启用 main 自动部署

**本 PR 不启用。** 稳定完成若干次 build-only、正式更新及回滚验证后，再单独审核增加新 workflow 的 `workflow_run` 触发器：仅在 `workflows: [CI]`、`types: [completed]`、`branches: [main]`，且上游事件为 push、结论 success 时运行。使用上游 `head_sha`，不是 workflow_run 事件自身的 github.sha，并保留 Runner/服务器的 main HEAD + 全部 CI job 校验。

该改动需要同时调整 job 的事件条件及 checkout ref，防止从 PR workflow_run 接收不受信任代码。仍使用 production Environment 审批、同一 `ekiden-production` 并发组与服务端锁。不要仅添加一个绕过 CI 的 push 部署，也不要因 main 更新使旧 SHA 获得准入。
