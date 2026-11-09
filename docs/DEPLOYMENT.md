# Ekiden：受限 SSH 镜像上传与部署（升级版）

本版本解决服务器从 GHCR 下载缓慢、超过旧脚本 120 秒限制的问题，不推断 Docker 存储损坏。本 PR 只交付代码、测试和升级说明；以下服务器命令尚未执行。

不删除或重装 Docker、不重启 Docker Engine、不清理 Docker 全局存储、不修改 AstrBot/NapCat，也不赋予部署用户 Docker 组或通用 sudo 权限。

## 部署流程与身份校验

1. 只在 `main` 手动运行 Actions。Runner 构建单平台 `linux/amd64` 镜像，并打上 `ghcr.io/stagnantwater657/ekiden-database:<完整40位SHA>` 标签及 `org.opencontainers.image.revision` 标签。
2. Runner 使用 `docker image save | gzip -1 -n`，`pipefail` 检查整个导出管道。计算压缩文件 SHA-256、精确字节数，以及归档内**配置 JSON 的 SHA-256**。
3. 使用专用 SSH 密钥、严格 known_hosts 校验和 ForceCommand，将压缩文件通过标准输入发送到 `upload` 命令。不开启 SFTP/SCP、交互 Shell、任意路径写入或 Docker CLI 权限。
4. root 程序在专用临时目录接收定长数据并等待 EOF，核验长度和 SHA-256，再验证镜像标签、revision、linux/amd64、配置摘要及每层的未压缩摘要。
5. 将 Docker save 归档规范化为**仅含一个目标镜像**的 Docker archive：只复制通过校验的配置和层，移除 OCI index 等其他元数据，防止导入其他项目标签。不把归档路径解压到宿主机。
6. `docker image load` 导入后，检查实际镜像标签及 revision，从服务器 Docker 读取本地 `.Id`，创建 `ekiden-local:<提交SHA>-<本地ID十六进制>` 固定标签，并记录 ready 元数据。
7. 第二个独立 SSH 命令 `deploy` 校验提交 SHA 和配置摘要与 ready 记录一致，固定 Compose 路径和项目，仅更新 `ekiden/web`，强制 `--pull never`。健康检查通过后才更新当前部署版本；失败恢复旧镜像。

服务器整个流程**不执行 GHCR pull，也不需要 GHCR 拉取认证**。本版不再推送 GHCR，工作流仅需 `contents: read`；镜像名称中的 `ghcr.io` 只作为本地导入标签。服务器原有 root-only GHCR 凭据可暂时保留以兼容管理员的其他维护操作，不会被此部署流程使用。

### Docker 29 / containerd 的关键差异

`docker image inspect .Id` 在 containerd image store 中可能是 manifest/index 摘要，与配置 JSON 摘要不同；规范化后导入的本地 ID 也可能与导出前不同。因此协议中的 `CONFIG_DIGEST` 来自归档配置文件，**不来自 Runner 的 `.Id`**。部署状态分别保存配置摘要和导入后的本地 ID，Compose 使用服务器创建的固定本地标签，不假设 `docker load` 会恢复 GHCR Registry Digest。

接受 Docker save 的 Docker/OCI 混合归档，支持未压缩或 gzip 压缩的层；不接收多平台 OCI-only 归档或 zstd 层。本工作流使用 Docker 单平台 exporter（`load: true`、`provenance: false`），再执行 Docker save，与上述协议匹配。

## 协议、安全限制与超时

原始命令必须精确匹配以下语法，单空格分隔，不接受额外参数、换行、Shell 操作符、上传路径或其他仓库名：

```text
upload <40位小写提交SHA> <64位压缩文件SHA256> sha256:<64位配置摘要> <十进制压缩文件字节数>
deploy <40位小写提交SHA> sha256:<64位配置摘要>
```

- SSH wrapper 和 root 程序分别校验。`migrate`、`rollback` 只允许管理员在 root shell 直接执行，不通过 SSH 协议或 sudoers 授权给部署用户。
- 私钥只保存在 Runner 权限受限的临时目录，退出即清理；不打印原始 SSH 输出、Token、私钥或运行环境。没有 GitHub Token/私钥写入镜像或仓库。
- 压缩上传最大 **512 MiB**，归档及展开层总量各最大 **2 GiB**；限制成员数量、扩展头大小，拒绝符号链接、硬链接、稀疏文件及路径穿越。上传前要求专用目录所在文件系统至少 **8 GiB** 可用空间，覆盖临时归档、层校验与规范化文件。
- 临时目录 `/var/lib/ekiden/uploads/image-*` 为 root 创建、0700；正常失败、EOF 中断、超时、HUP/INT/TERM 均清理临时文件。ready 记录只在成功导入后生成，不保留上传归档。
- 同一个 root 文件锁 `/run/lock/ekiden-deploy.lock` 覆盖上传、校验、导入、激活和回滚。冲突立即失败，不同时部署两个版本；Actions 也使用 `ekiden-production` 并发组，不中断正在运行的部署。
- 接收数据最长 **1200 秒**；镜像导入最长 **600 秒**。Runner 上传/导入 SSH 总超时 **2100 秒**，激活 SSH 单独超时 **600 秒**。SSH 连接超时 10 秒、BatchMode、公钥认证和服务器保活均启用。上传没有 `ssh -n`，激活使用 `-n`。
- Compose 更新单次最长 150 秒，健康等待 90 秒；其他 Docker 查询最长 30 秒。部署仅指向固定 `/etc/ekiden/compose.yaml`、项目 `ekiden`、服务 `web`，不调用全局 prune、down、remove-orphans、其他项目或任意 Shell。
- 运行配置仍在 `/etc/ekiden/runtime.env`；站点只绑定 `127.0.0.1:3001:3000`，非 root、只读文件系统、384 MiB 配置上限，不启动 PostgreSQL。

## 从旧版平滑升级：管理员 root 命令

**不要现在自动执行。** 先合并并审核本 PR，暂停人为触发旧部署工作流，确认没有正在运行的部署；保持现有管理员连接开启。下面全部在 Ubuntu **已有的 root shell** 执行，不是让 `ekiden-deploy` 获得通用 sudo。Compose 配置和 runtime.env 保持现状，不重启 SSH 或 Docker Engine。

### 1. 取得已审核代码，备份现有脚本与状态

若已有 `/root/ekiden-bootstrap`，进入该目录 fetch；不要覆盖其中已有管理文件。没有此目录才 clone（私有仓库使用管理员自己的只读 GitHub 认证）。

```bash
whoami                         # 必须为 root
uname -m                       # x86_64
/usr/bin/docker version
/usr/bin/docker compose version
command -v python3 gzip flock sudo visudo

# 仅在目录不存在时：
# git clone https://github.com/stagnantwater657/ekiden-database.git /root/ekiden-bootstrap
cd /root/ekiden-bootstrap
git fetch origin main
read -r -p '审核后的完整40位Git提交SHA: ' REVIEWED_SHA
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
git checkout --detach "$REVIEWED_SHA"
git log -1 --oneline

umask 077
install -d -o root -g root -m 0700 /var/backups/ekiden
BACKUP_DIR=$(mktemp -d /var/backups/ekiden/ssh-upload-upgrade.XXXXXX)
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || { echo '已有部署正在运行，请稍后再升级'; exit 1; }
cp -a /usr/local/sbin/ekiden-deploy "$BACKUP_DIR/ekiden-deploy"
cp -a /usr/local/libexec/ekiden-ssh-command "$BACKUP_DIR/ekiden-ssh-command"
cp -a /etc/sudoers.d/ekiden-deploy "$BACKUP_DIR/ekiden-deploy.sudoers"
cp -a /etc/ekiden/compose.yaml "$BACKUP_DIR/compose.yaml"
for state_file in current previous current.json previous.json; do
  if [ -f "/var/lib/ekiden/$state_file" ]; then
    cp -a "/var/lib/ekiden/$state_file" "$BACKUP_DIR/$state_file"
  fi
done
printf '备份目录：%s\n' "$BACKUP_DIR"
```

保留这个备份目录路径。以上不复制或打印 GHCR 密码、SSH 私钥或 runtime.env 内容。若有脚本路径与旧版说明不同，先由管理员核对实际 ForceCommand 与 sudoers，不直接覆盖未知路径。

### 2. 语法检查、原子安装脚本和 sudoers

继续使用上面持锁的 root shell：

```bash
python3 -m py_compile ops/ekiden-deploy
bash -n ops/ekiden-ssh-command ops/runner-transfer.sh
python3 tests/deployment_test.py
visudo -cf ops/ekiden-deploy.sudoers

install -d -o root -g root -m 0700 /var/lib/ekiden /var/lib/ekiden/uploads /var/lib/ekiden/ready
install -o root -g root -m 0755 ops/ekiden-deploy /usr/local/sbin/.ekiden-deploy.new
install -o root -g root -m 0755 ops/ekiden-ssh-command /usr/local/libexec/.ekiden-ssh-command.new
install -o root -g root -m 0440 ops/ekiden-deploy.sudoers /etc/sudoers.d/.ekiden-deploy.new
visudo -cf /etc/sudoers.d/.ekiden-deploy.new

mv -f /usr/local/sbin/.ekiden-deploy.new /usr/local/sbin/ekiden-deploy
mv -f /etc/sudoers.d/.ekiden-deploy.new /etc/sudoers.d/ekiden-deploy
mv -f /usr/local/libexec/.ekiden-ssh-command.new /usr/local/libexec/ekiden-ssh-command
visudo -c
sudo -l -U ekiden-deploy
stat -c '%U:%G %a %n' /usr/local/sbin/ekiden-deploy /usr/local/libexec/ekiden-ssh-command \
  /etc/sudoers.d/ekiden-deploy /etc/ekiden/compose.yaml /var/lib/ekiden/uploads /var/lib/ekiden/ready
flock -u 9
exec 9>&-
```

预期脚本 root:root 755、sudoers root:root 440，状态与上传目录 root:root 700，Compose 仍由 root 控制且部署用户不可写。核对父目录也不可被部署用户写入，不添加 Docker 组。sudoers 仅放行脚本的 `upload ...` 和 `deploy ...`，root 程序再次限制参数；为二进制 stdin 关闭该命令的 sudo pseudo-TTY，不授予 Shell、env 或 Docker 命令权限。

现有 SSH `ForceCommand /usr/local/libexec/ekiden-ssh-command` 的**路径保持不变**，只原子替换该 root-owned wrapper 的内容，因此不需要修改 sshd 配置或 reload。保留现有专用公钥、StrictModes、DisableForwarding、PermitTTY no、PermitUserRC no 等限制；旧 `deploy SHA@registryDigest` 命令在升级后会被拒绝，旧只读 SSH 测试也仍会被拒绝。

### 3. 将旧版状态迁移为可离线回滚的本地引用

```bash
/usr/local/sbin/ekiden-deploy migrate
```

此命令只检查本地镜像/健康状态并创建 root 控制的本地标签和 JSON 状态，**不 pull、不重启容器、不部署新版本**。旧 `current`/`previous` 文本文件保留不动。若已有 JSON 状态，它会先验证状态；无旧站点、无状态则无需迁移。

旧站点当前必须健康。旧版本镜像已在本地时，迁移把 `SHA@registryDigest` 引用转换为 `ekiden-local:SHA-本地ID`，在上传可能重写 SHA 标签之前保护回滚镜像。迁移后新程序优先读取 `current.json`、`previous.json`；只有成功激活新版本才推进 current。历史 previous 镜像若已不在本地，会报告需管理员离线恢复，不会偷偷访问 GHCR。

如果旧状态引用已失效、或存在运行中的 Ekiden web 但没有可信状态，程序会停止，管理员应先核对该容器实际镜像和版本并恢复受信任记录；不要删除状态、猜测版本或强制覆盖运行网站。没有 `current.json` 但仍有旧 `current` 时，上传会被拒绝，必须先完成迁移。

## 首次上传测试（授权后执行，不更新网站）

1. 确认已合并新工作流、完成上述升级和状态迁移。
2. 保留现有五个 Actions Secrets：`DEPLOY_SSH_KEY`、`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PORT`、`DEPLOY_KNOWN_HOSTS`。`DEPLOY_USER` 必须为 `ekiden-deploy`，非 22 端口的 known_hosts 条目通常为 `[主机]:端口`，由可信渠道核验公钥。
3. 在 Actions → **Deploy Ekiden (manual)** → **Run workflow** 选择 `main`，勾选 **upload_only**。
4. 预期日志显示 `Ekiden image upload and integrity checks passed.` 及 `Upload-only test completed; no container was updated.`。它导入镜像并写入 ready，不推进 current、不更新服务。

管理员可只读核对：

```bash
find /var/lib/ekiden/uploads -mindepth 1 -maxdepth 1 -type d -name 'image-*'
ls -l /var/lib/ekiden/ready
# uploads 在正常操作完成后为空；ready 中有 root-only 的提交SHA.json。
```

不需要在服务器构建镜像、获取 GitHub Token 或重新配置 GHCR 登录。

## 首次手动激活与验收（另行授权后）

再次手动运行相同工作流，选择 `main`，**不勾选 upload_only**。Runner 会重新构建/上传；即使同一提交的重建产生不同镜像内容，旧站点的专用本地标签仍不受影响，激活会核对本次上传的配置摘要。建议 `production` Environment 继续限制 `main` 并配置审核人（套餐支持时）。没有 push 自动部署。

成功日志为 `Ekiden deployment passed health checks.`。管理员在 root shell 验收：

```bash
curl --fail --silent http://127.0.0.1:3001/api/health
printf '\n'
cat /var/lib/ekiden/current.json
EKIDEN_CONTAINER_ID=$(/usr/bin/docker ps -q --filter label=com.docker.compose.project=ekiden --filter label=com.docker.compose.service=web)
/usr/bin/docker inspect --format 'Image={{.Image}} User={{.Config.User}} Memory={{.HostConfig.Memory}} ReadOnly={{.HostConfig.ReadonlyRootfs}}' "$EKIDEN_CONTAINER_ID"
/usr/bin/docker exec "$EKIDEN_CONTAINER_ID" cat /sys/fs/cgroup/memory.max
unset EKIDEN_CONTAINER_ID
ss -lnt | grep '127.0.0.1:3001'
```

健康接口预期 `{"status":"ok","service":"ekiden-database"}`。cgroup v2 的内存限制预期 402653184 字节；仍不配置公网端口、反向代理或 HTTPS。

## 应用回滚与异常恢复

上传、校验或导入失败时，不调用 Compose、不替换正在运行的网站；临时文件清理。导入成功但新站健康检查失败时，恢复 root 记录的旧固定本地镜像并复验健康。首次部署无旧版时，只停止失败的 Ekiden web，不操作其他服务。此为单容器更新和自动恢复，更新/恢复过程中可能短暂中断，不是零停机切换。

管理员手动回滚（root shell，无 SSH 子命令开放）：

```bash
/usr/local/sbin/ekiden-deploy rollback
```

`previous.json` 保存上一成功版本的固定本地引用；回滚成功后也经过健康检查，并保留被替换版本以便恢复。不要手工删除这些本地镜像或使用全局镜像清理。新脚本不再使用旧式 `ekiden-deploy "$(cat previous)"` 命令。

突发断电、SIGKILL、Docker 故障或自动回滚也失败时，程序无法保证自动恢复；管理员应在没有任务持锁时核对 current/previous 与实际运行镜像。异常遗留上传目录仅在确认无任务运行后按具体目录清理，不对 Docker 存储执行全局清理或重建。

### 仅升级脚本失败、尚未激活新站时恢复旧脚本

使用之前记录的真实备份路径，保持 root shell；暂停 Actions 手动操作。此步骤只适用于**没有用新协议激活过版本**。已经激活新站时，应优先用新脚本应用回滚，不能直接恢复可能过期的旧文本状态。

```bash
read -r -p '升级前备份目录的完整路径: ' BACKUP_DIR
[[ "$BACKUP_DIR" == /var/backups/ekiden/ssh-upload-upgrade.* && -d "$BACKUP_DIR" ]] || exit 1
exec 9>/run/lock/ekiden-deploy.lock
flock -n 9 || exit 1
visudo -cf "$BACKUP_DIR/ekiden-deploy.sudoers"
install -o root -g root -m 0755 "$BACKUP_DIR/ekiden-deploy" /usr/local/sbin/.ekiden-deploy.restore
install -o root -g root -m 0755 "$BACKUP_DIR/ekiden-ssh-command" /usr/local/libexec/.ekiden-ssh-command.restore
install -o root -g root -m 0440 "$BACKUP_DIR/ekiden-deploy.sudoers" /etc/sudoers.d/.ekiden-deploy.restore
mv -f /usr/local/sbin/.ekiden-deploy.restore /usr/local/sbin/ekiden-deploy
mv -f /etc/sudoers.d/.ekiden-deploy.restore /etc/sudoers.d/ekiden-deploy
mv -f /usr/local/libexec/.ekiden-ssh-command.restore /usr/local/libexec/ekiden-ssh-command
visudo -c
flock -u 9
exec 9>&-
```

不删除新的 JSON 状态、旧文本备份或 Docker 数据。旧流程仍有 GHCR 拉取缓慢问题，恢复旧脚本不意味着应触发旧部署。

## 自动化验证与本地检查

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
python3 tests/deployment_test.py
bash -n ops/ekiden-ssh-command ops/runner-transfer.sh
python3 -m py_compile ops/ekiden-deploy ops/image-metadata.py
```

协议测试使用临时目录和模拟 Docker，不访问服务器，覆盖正常上传、SHA-256 错误、非法参数、中断、大小上限、并发、导入失败、健康失败、旧版回滚、迁移、拒绝任意 Shell、OCI 元数据隔离以及 native ID 与 config digest 不同的情况。

`ci.yml` 新增独立 **Docker 29.1.3 containerd archive compatibility** job：仅在一次性 GitHub Runner 上启动隔离测试 daemon，明确启用 containerd snapshotter，实际执行构建 → save/gzip → 规范化 → load → 本地引用 → 容器健康检查。它不连接或重启生产 Docker。也可在已有隔离开发 Docker 上运行：

```bash
TEST_SHA=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
docker build --label "org.opencontainers.image.revision=$TEST_SHA" \
  -t "ghcr.io/stagnantwater657/ekiden-database:$TEST_SHA" .
EKIDEN_DOCKER_TEST=1 python3 tests/docker_archive_test.py "$TEST_SHA"
```

集成测试默认只允许本地 Unix socket，可用 `DOCKER_TEST_SOCKET=/受控测试daemon/docker.sock` 指定 CI 独立 socket；不要指向生产 Docker。它只删除自己创建的测试容器及测试本地标签。云端构建若需代理 CA，使用 Docker BuildKit 的 `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"`，不禁用 TLS。
