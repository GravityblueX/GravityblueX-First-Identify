# GravityblueX-First-Identify 维护说明

## v0.1.0 - 2026-06-11

本仓库是 TypeScript 全栈项目（TeamSync Platform），包含 Next.js 客户端、Node/Express 服务端、共享包、Docker Compose、Kubernetes、Terraform、监控与 CI 配置。本次维护以低风险发布基线为目标，不改动业务逻辑。

### 当前结构

- `client/`：Next.js / React 前端。
- `server/`：Node.js / TypeScript 后端、Prisma、REST/GraphQL、测试。
- `shared/`：共享包。
- `microservices/`：API Gateway 与微服务 compose。
- `k8s/`、`infrastructure/terraform/`、`monitoring/`：部署、基础设施与监控资源。

### 本次维护

- 补充维护说明，明确项目范围、验证入口与风险边界。
- 不改动前后端业务代码、部署配置和数据库 schema，避免破坏旧系统行为。
- 创建 v0.1.0 GitHub Release 作为后续维护基线。

### 建议验证

```bash
npm install
npm run lint
npm test
npm run build
```

如只验证子项目：

```bash
cd client && npm install && npm run build
cd server && npm install && npm test
```

### 后续建议

- 先修复 CI 中可复现的 lint/test/build 问题，再做功能重构。
- 对 Prisma 迁移、K8s、Terraform 和高级部署 workflow 单独做 dry-run 检查。
