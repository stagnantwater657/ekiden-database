# 阶段 0：SSH 连通性测试

工作流：`.github/workflows/ssh-test.yml`（SSH connectivity test）。

## 执行方法

1. 将本 PR 合并至 `main`，让 GitHub 在默认分支发现手动工作流。
2. 打开仓库的 **Actions → SSH connectivity test → Run workflow**。
3. 选择 `main`，点击 **Run workflow**，查看 `Verify ekiden-deploy SSH access` 的结果。

工作流只有 `workflow_dispatch` 触发器，提交、PR 或合并均不会自动连接服务器。本次交付不主动运行测试。

## Secrets

在仓库 Settings → Secrets and variables → Actions 中配置以下仓库 Secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 专用 SSH 私钥；需支持非交互认证 |
| `DEPLOY_HOST` | 服务器域名或 IP，不含用户名、端口或 URL 协议 |
| `DEPLOY_USER` | 必须为 `ekiden-deploy` |
| `DEPLOY_PORT` | 1–65535 范围内的 SSH 端口 |
| `DEPLOY_KNOWN_HOSTS` | 经可信渠道核验的完整 OpenSSH known_hosts 条目 |

非默认端口的 known_hosts 条目通常使用 `[主机]:端口` 格式，必须匹配 `DEPLOY_HOST` 和 `DEPLOY_PORT`。不要用未经核验的运行时 `ssh-keyscan` 结果替代可信主机公钥。带口令且需要交互解锁的私钥不适用于本工作流。

## 行为与预期结果

- 使用 GitHub 官方 `ubuntu-22.04` runner，权限为 `contents: read`，无第三方 Action，也不 checkout 仓库。
- 私钥和 known_hosts 仅写入 runner 的权限受限临时目录，步骤结束时清理。
- 强制公钥认证、`BatchMode=yes`、`StrictHostKeyChecking=yes`，禁用密码提示、代理转发和端口转发。
- SSH 建连超时 10 秒，只尝试一次；整次 SSH 调用最长 45 秒，job 最长 3 分钟。
- 远端仅执行 `whoami && hostname && uname -s`，在 runner 本地检查三行结果及登录用户 `ekiden-deploy`，并验证内核为 `Linux`。
- 成功日志包含 `SSH connectivity test passed.`、已验证的用户名及内核；不输出私钥、原始 SSH 错误、主机地址或主机名。
- Secret 缺失、用户名错误、端口无效、主机密钥不匹配、认证失败、网络超时或返回内容不符合预期，都会使工作流失败。

失败时在仓库设置及服务器管理渠道检查对应配置。工作流故意不打印可能含连接信息的原始 SSH 错误。

## 范围

不安装软件、不执行 Docker、sudo、文件修改、服务重启或正式部署操作。工作流使用的命令只读取基础信息；SSH 密钥本身能执行哪些操作，仍由服务器对 `ekiden-deploy` 的授权决定，本工作流不会修改这些权限。SSH 登录可能产生服务器正常的认证审计记录。

本工作流验证连通性和 Linux 内核，不足以证明远端发行版为 Ubuntu 22.04。
