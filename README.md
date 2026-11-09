# Ekiden Database

日本大学驿传数据库。Next.js + TypeScript + Tailwind CSS 基础工程，当前提供赛事入口预览和 `/api/health`，尚未接入数据库、登录或正式业务。

```bash
npm ci
npm run dev
```

检查：`npm run typecheck`、`npm run lint`、`npm test`、`python3 tests/deployment_test.py`、`npm run build`。

- [管理员初始化、部署权限与回滚说明](docs/DEPLOYMENT.md)
- [项目计划](docs/PROJECT_PLAN.md)
- [原始 SSH 连通性测试](docs/SSH_TEST.md)（部署专用账户启用固定命令后，此旧测试会按设计被拒绝）

PR 和 main 更新自动执行 CI；生产新入口为 `Deploy source on Ubuntu (manual)`，仅 main 手动运行，默认只构建不激活。Runner 仅经受限 SSH 发送 SHA，服务器验证 main/CI 后在资源受限的专用 BuildKit 中本地构建，再健康检查及失败回滚。旧部署工作流文件保留作历史参考；新服务器授权不再接受旧上传命令。管理员完成升级授权之前不要运行部署工作流。

- [Ubuntu 本地源码构建部署与管理员升级命令](docs/SOURCE_DEPLOYMENT.md)（新独立手动入口；默认仅构建）
