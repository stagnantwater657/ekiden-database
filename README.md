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

PR 自动执行 CI；生产部署仅支持在 `main` 手动运行 `Deploy Ekiden (manual)`。管理员完成授权之前不要运行部署工作流。
