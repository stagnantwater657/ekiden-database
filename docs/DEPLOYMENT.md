# Ekiden 部署基础工程：管理员操作手册

本 PR 只交付代码和本地验证，不运行生产部署。首次部署必须在管理员完成下列授权后，再由项目负责人手动触发。

## 结构与边界

- Next.js + TypeScript + Tailwind CSS；standalone Node.js 服务，`GET /api/health` 返回 `{"status":"ok","service":"ekiden-database"}`，不依赖数据库。
- 多阶段 Docker 镜像，UID/GID 1001，256 MiB V8 old-space、384 MiB 容器上限、只读根文件系统、临时 `/tmp`。当前没有图片优化、上传、ISR 写盘或数据卷；以后增加此类功能需要重新设计持久目录和容量。
- Compose 项目固定 `ekiden`，服务固定 `web`，端口固定 `127.0.0.1:3001:3000`；不运行 PostgreSQL，不挂载 Docker socket，不访问 AstrBot、NapCat。
- 镜像仓库固定 `ghcr.io/stagnantwater657/ekiden-database`。构建使用完整 40 位提交 SHA 标签，实际部署同时固定 `SHA@sha256:镜像摘要`，即使标签被覆盖也不会悄悄部署另一镜像。不发布 `latest`。
- 当前仅构建 `linux/amd64`。管理员先确认服务器为 `x86_64`；ARM 服务器需先调整构建平台并验证。
- `ci.yml` 仅 PR 触发，运行依赖安装、类型检查、Lint、测试、构建和 Docker 构建。`deploy.yml` 仅手动触发且只接受 `main`，并在构建阶段重新检查；没有 push 自动部署。
- `production` GitHub Environment 建议配置 Required reviewers（套餐支持时）和仅允许 `main` 部署的分支规则。构建 job 具有 `packages: write`；部署 job 只有 `contents: read`，无 GHCR 写权限。

## 管理员初始化命令（尚未执行）

以下全部在 **服务器管理员已获得的 root shell** 内执行，不是让 `ekiden-deploy` 获取通用 sudo。不要把命令作为工作流步骤运行。现有 Docker/Compose 不重装，不更改其他容器。请先审核并合并本 PR，再记录审核后的完整提交 SHA。

### 1. 检查前置条件并取得审核版本

```bash
whoami                    # 必须为 root
uname -m                  # 本版要求 x86_64
command -v docker         # 后续脚本固定要求 /usr/bin/docker
/usr/bin/docker compose version
command -v curl python3 flock sudo sshd visudo
id ekiden-deploy
id -nG ekiden-deploy      # 不应包含 docker 或 sudo 等特权组

git clone https://github.com/stagnantwater657/ekiden-database.git /root/ekiden-bootstrap
cd /root/ekiden-bootstrap
read -r -p '审核后的完整 40 位 Git SHA: ' REVIEWED_SHA
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
git checkout --detach "$REVIEWED_SHA"
git log -1 --oneline
```

仓库私有时，先使用管理员自己的只读 GitHub 访问方式取得代码；不要复用部署私钥进行 GitHub 登录。如缺少上述工具，由管理员按服务器维护流程处理，自动部署脚本不安装软件。现有目录已存在时，不重复 clone；在受控目录 fetch 并 checkout 已审核版本。

### 2. 安装 root 控制的配置、脚本和权限规则

```bash
install -d -o root -g root -m 0755 /etc/ekiden /usr/local/libexec
install -d -o root -g root -m 0700 /etc/ekiden/docker /var/lib/ekiden
install -o root -g root -m 0600 compose.yaml /etc/ekiden/compose.yaml
# 首次初始化才创建运行配置；后续更新不得覆盖已有密钥配置。
if [ ! -e /etc/ekiden/runtime.env ]; then
  install -o root -g root -m 0600 ops/runtime.env.example /etc/ekiden/runtime.env
fi
install -o root -g root -m 0755 ops/ekiden-deploy /usr/local/sbin/ekiden-deploy
install -o root -g root -m 0755 ops/ekiden-ssh-command /usr/local/libexec/ekiden-ssh-command
visudo -cf ops/ekiden-deploy.sudoers
install -o root -g root -m 0440 ops/ekiden-deploy.sudoers /etc/sudoers.d/ekiden-deploy
visudo -c
sudo -l -U ekiden-deploy  # 核对没有额外的通用 root/Docker 授权
```

确认 `/etc`、`/etc/ekiden`、`/usr/local/sbin`、`/usr/local/libexec` 及其父目录均不可被 `ekiden-deploy` 写入。不得把仓库工作目录、用户家目录内的 Compose 文件交给 root Docker 执行。运行配置在 `/etc/ekiden`，部署状态在 `/var/lib/ekiden`，凭据在 `/etc/ekiden/docker`，均不在 Git 中。未来数据库或上传数据必须使用单独持久卷和备份方案。

脚本只接受一个严格校验的 `40位SHA@sha256:64位摘要` 参数，固定 Docker socket、仓库、Compose 文件、项目和服务；不执行 `eval` 或来源不明的 Shell 命令。sudoers 中的 `*` 只传递参数，真正的参数数目及格式限制由 root 持有的脚本执行；不授权 `docker`、Shell、`env` 或编辑器。

### 3. 配置私有 GHCR 拉取权限（必须显式完成）

GitHub Actions 中的 `GITHUB_TOKEN` 只用于 CI 推送，不会自动授权服务器。管理员使用能读取该 package 的 GitHub 账户及 **PAT classic，最少 `read:packages`**；涉及组织时还需满足组织 SSO 与 package 授权规则。不要使用具有写包或删包权限的凭据。若 package 尚未由首次构建创建，可先保存凭据，首次部署前确认 package 的访问授权。

```bash
read -r -p '可读取该 GHCR package 的 GitHub 用户名: ' GHCR_USER
read -r -s -p 'GHCR PAT (read:packages): ' GHCR_READ_TOKEN
printf '\n'
printf '%s' "$GHCR_READ_TOKEN" | /usr/bin/docker --host unix:///var/run/docker.sock \
  --config /etc/ekiden/docker login ghcr.io --username "$GHCR_USER" --password-stdin
unset GHCR_READ_TOKEN GHCR_USER
chmod 0700 /etc/ekiden/docker
chmod 0600 /etc/ekiden/docker/config.json
```

不要开启 `set -x`、打印 config.json 或把 token 放到命令参数、Git、PR、Actions 日志。未配置 credential helper 时 Docker 将凭据以可还原形式保存在该 root-only 文件中，需按服务器密钥管理要求保护和轮换。GitHub package 设置必须允许 Actions 所属仓库写入，以及上述管理员账户读取。首次推送若遇到 existing package 权限问题，先由 package 管理员授权，不能假设权限继承。

### 4. 为 ekiden-deploy 安装固定 SSH 命令

此配置对该用户的所有 SSH 会话生效，不保留交互 Shell。原 `ssh-test.yml` 的 `whoami` 测试此后会被拒绝，这是部署权限收紧后的预期变化。若该账户另有用途，管理员应先清理并迁移后再应用。

保持当前 root 管理连接开启；将下面提示中的公钥设为 `DEPLOY_SSH_KEY` 对应的 **公钥**，不是私钥。

```bash
install -d -o root -g root -m 0755 /etc/ssh/authorized_keys
read -r -p '部署 SSH 公钥（单行 ssh-ed25519 ... 或 ssh-rsa ...）: ' DEPLOY_PUBLIC_KEY
printf '%s\n' "$DEPLOY_PUBLIC_KEY" | ssh-keygen -l -f -
printf 'restrict %s\n' "$DEPLOY_PUBLIC_KEY" > /etc/ssh/authorized_keys/ekiden-deploy
unset DEPLOY_PUBLIC_KEY
chown root:root /etc/ssh/authorized_keys/ekiden-deploy
chmod 0644 /etc/ssh/authorized_keys/ekiden-deploy
cat > /etc/ssh/sshd_config.d/00-ekiden-deploy.conf <<'SSHD'
Match User ekiden-deploy
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    AuthorizedKeysCommand none
    ForceCommand /usr/local/libexec/ekiden-ssh-command
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding yes
    PermitTTY no
    PermitUserRC no
Match all
SSHD
chown root:root /etc/ssh/sshd_config.d/00-ekiden-deploy.conf
chmod 0644 /etc/ssh/sshd_config.d/00-ekiden-deploy.conf
/usr/sbin/sshd -t
# 用真实客户端地址核对 Match 后最终有效配置；此命令不连接服务器。
read -r -p '用于核对配置的客户端公网 IP: ' CHECK_CLIENT_IP
/usr/sbin/sshd -T -C "user=ekiden-deploy,host=client,addr=$CHECK_CLIENT_IP" \
  | rg 'forcecommand|authorizedkeysfile|authenticationmethods|disableforwarding|permittty|permituserrc'
unset CHECK_CLIENT_IP
# 核对输出符合本节限制后，由管理员执行：
systemctl reload ssh
```

如果服务器没有 `rg`，上面的只读过滤命令可替换为 `grep -E`。检查 sshd 主配置确实 Include 此目录，排除更早匹配的冲突规则；配置验证不通过时不要 reload。公钥文件为 root 持有的 0644：允许 sshd 在用户身份下读取，但部署用户无写权限；公钥本身不是秘密。不得让 `ekiden-deploy` 修改此公钥文件、固定命令或 sudoers。专用密钥仍具有更新 Ekiden 应用的能力，应像生产凭据一样管理；它不具备 Docker 通用管理能力。

以上安装步骤不启动任何容器。

## 管理员完成后，首次手动部署

1. 在仓库 Settings → Environments 创建 `production`，配置审核人与仅 `main` 规则（按可用功能配置）。现有五个 SSH Secrets 可保留为仓库 Secrets；若采用同名 Environment Secrets，请确认值一致。
2. 核对 `DEPLOY_USER=ekiden-deploy`，主机、端口和经可信渠道核验的 known_hosts 内容正确；非 22 端口通常需 `[主机]:端口` 条目。
3. 获得首次部署授权后，打开 Actions → **Deploy Ekiden (manual)** → **Run workflow** → 选择 `main`。只有这个操作会构建推送 GHCR 并请求生产部署；本 PR 不触发。
4. 构建 job 用 SHA 标签推送并输出摘要；部署 job 通过严格 SSH 主机公钥校验发送 `deploy SHA@sha256:DIGEST`，固定命令调用受限 root 脚本。
5. SSH 整体最长 420 秒；脚本中的每次 Docker 调用最长 120 秒。脚本串行加锁，拉取镜像，仅更新 `ekiden/web`，等待容器健康，再检查 `127.0.0.1:3001/api/health`。成功输出 `Ekiden deployment passed health checks.`。

管理员在服务器 root shell 验收（不是给部署用户的权限）：

```bash
curl --fail --silent http://127.0.0.1:3001/api/health
printf '\n'
ss -lnt | grep '127.0.0.1:3001'
cat /var/lib/ekiden/current
EKIDEN_CONTAINER_ID=$(/usr/bin/docker ps -q --filter label=com.docker.compose.project=ekiden --filter label=com.docker.compose.service=web)
/usr/bin/docker inspect --format 'User={{.Config.User}} Memory={{.HostConfig.Memory}} ReadOnly={{.HostConfig.ReadonlyRootfs}}' "$EKIDEN_CONTAINER_ID"
# cgroup v2 服务器上应为 402653184（384 MiB），而不是 max 或宿主总上限：
/usr/bin/docker exec "$EKIDEN_CONTAINER_ID" cat /sys/fs/cgroup/memory.max
unset EKIDEN_CONTAINER_ID
```

站点仅监听服务器回环端口，尚未配置域名、HTTPS、Nginx 或公网入口。不要为本阶段把 3001 绑定为 `0.0.0.0`。

## 回滚与故障处理

拉取失败不替换正在运行的容器。部署或健康检查失败时，脚本自动恢复 `current` 中此前健康的精确镜像；首次部署没有旧版本时只停止 Ekiden 的 web 服务。`previous` 保存上一个成功版本，不删除镜像，不执行全局 prune、Compose down、remove-orphans 或其他项目操作。

管理员手动应用回滚（root shell）：

```bash
/usr/local/sbin/ekiden-deploy "$(cat /var/lib/ekiden/previous)"
```

回滚经过同样的拉取及健康检查。应保留 GHCR 中的 current/previous 摘要及服务器本地对应镜像，不设置会删除它们的清理策略。突发断电、SIGKILL、Docker 不可用或回滚也失败时，需管理员核对 `/var/lib/ekiden/current` 与实际运行容器，再以已知可用版本调用脚本；这不提供数据库回滚，也不是零停机蓝绿部署。

Actions 不打印原始 SSH 输出/错误以避免泄露敏感连接信息。失败时管理员从服务器受控渠道检查 SSH 授权、sudoers、GHCR 权限、磁盘空间以及固定项目状态，不把凭据或完整环境贴入工单。

## 本地开发与检查

```bash
npm ci
npm run dev
# 另一个终端：
curl --fail http://localhost:3000/api/health
npm run typecheck
npm run lint
npm test
python3 tests/deployment_test.py
npm run build
docker build -t ekiden-local .
# 可选本地容器测试；不使用生产 Compose 或任何现有容器：
docker run --rm --name ekiden-local-check -p 127.0.0.1:3002:3000 ekiden-local
```

生产 Compose 引用 `/etc/ekiden/runtime.env`，不适合直接在开发电脑 `compose up`。云端开发环境若需要代理 CA，可使用 `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t ekiden-local .`，不要禁用 TLS 校验。

本轮云端本地检查已验证镜像构建、首页 HTTP 内容、健康接口、容器健康检查、UID 1001 和只读文件系统。云端 rootless Docker 的 HostConfig 记录了 384 MiB 限制，但其 cgroup 实际继承宿主 8 GiB 上限，因此未将本地结果当作硬内存上限验收；首次服务器测试时应按上述命令核对。浏览器预览基础设施追加了 Next.js 不支持的 `--host`/`--strictPort` 参数，未完成浏览器视觉验收。
