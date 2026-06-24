# TeamSync - 企业级项目管理协作平台

> 一个展示现代全栈开发技能的综合性项目，使用 React、TypeScript、Node.js 构建

## 🌟 项目亮点

### 技术栈 (2025年主流)
- **前端**: Next.js 14 + TypeScript + Tailwind CSS
- **后端**: Node.js + Express + TypeScript  
- **数据库**: PostgreSQL + Prisma ORM
- **实时通信**: Socket.IO
- **状态管理**: Zustand + React Query
- **认证**: JWT + bcrypt
- **测试**: Jest + Cypress
- **部署**: Docker + AWS/Vercel

### 核心功能
- 🚀 **项目管理**: 看板式任务管理、甘特图、里程碑追踪
- 👥 **团队协作**: 实时聊天、文件共享、团队管理
- 📊 **数据分析**: 项目进度报表、效率分析、自定义仪表板
- 🔐 **安全认证**: JWT认证、角色权限、数据加密
- 📱 **响应式设计**: 支持桌面端和移动端
- ⚡ **实时更新**: WebSocket实时通信、推送通知

## 🏗 架构设计

```
teamsync-platform/
├── client/                 # Next.js 前端应用
│   ├── src/
│   │   ├── app/           # App Router 页面
│   │   ├── components/    # 可复用组件
│   │   ├── contexts/      # React Context
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── lib/           # 工具库和 API
│   │   └── types/         # TypeScript 类型定义
│   └── public/            # 静态资源
├── server/                # Node.js 后端API
│   ├── src/
│   │   ├── routes/        # API 路由
│   │   ├── middleware/    # 中间件
│   │   ├── socket/        # Socket.IO 处理器
│   │   └── utils/         # 工具函数
│   └── prisma/            # 数据库模式
├── shared/                # 共享类型和工具
└── docs/                  # 项目文档
```

## 维护边界

本仓库用于学习、作品集展示和自托管项目管理实验。默认 demo 配置不应直接当作生产安全配置使用；涉及真实用户、真实项目数据或公网部署前，请先补齐密钥管理、数据库迁移、日志脱敏、备份和访问控制审查。

维护前建议运行：

```bash
npm run build
npm run test
npm run api:surface
npm run api:openapi
npm run deps:sbom
npm run runtime:boundary
npm run release:readiness:checked
```

安全与维护边界见 [SECURITY.md](./SECURITY.md)。
发布就绪证据会写入 `reports/release-readiness.md` 和 `reports/release-readiness.json`。
API surface 证据会写入 `reports/api-surface.md` 和 `reports/api-surface.json`，用于确认公开与受保护接口边界。
OpenAPI 合同会写入 `reports/openapi.md` 和 `reports/openapi.json`，用于把 Express 路由、路径参数和 JWT Bearer 鉴权边界转换成可审阅的 OpenAPI 3.1 文档。
依赖 SBOM 会写入 `reports/dependency-sbom.md` 和 `reports/bom.cdx.json`，用于从 package-lock 生成 CycloneDX 风格依赖物料清单。
运行时边界证据会写入 `reports/runtime-boundary.md` 和 `reports/runtime-boundary.json`，用于区分已经从 `server/src/index.ts` 接入的后端模块与仍处于候选状态的源码。

## 🎯 简历价值点

### 技术能力展示
- **全栈开发**: 前后端分离架构，RESTful API设计
- **现代技术栈**: 使用2025年最新技术和最佳实践
- **TypeScript**: 全项目类型安全，提高代码质量
- **实时应用**: WebSocket实现实时协作功能
- **数据库设计**: 复杂关系型数据库建模
- **性能优化**: 缓存策略、懒加载、代码分割

### 工程化能力
- **代码规范**: ESLint + Prettier 统一代码风格
- **测试覆盖**: 单元测试 + 集成测试 + E2E测试
- **CI/CD**: GitHub Actions 自动化部署
- **容器化**: Docker 容器化部署
- **监控日志**: 应用性能监控和错误追踪

### 业务理解
- **企业级应用**: 复杂业务逻辑处理
- **用户体验**: 现代化UI/UX设计
- **可扩展性**: 微服务架构，支持水平扩展
- **安全性**: 数据加密、权限控制、API限流

## 🚀 快速开始

### 环境要求
- Node.js 18+
- PostgreSQL 14+
- Redis (可选，用于缓存)

### 安装和运行
```bash
# 克隆项目
git clone https://github.com/GravityblueX/GravityblueX-First-Identify.git
cd GravityblueX-First-Identify

# 安装依赖
npm install
cd client && npm install
cd ../server && npm install

# 设置数据库
cd server
cp .env.example .env
npm run db:push
npm run db:seed

# 启动开发服务器
cd ..
npm run dev
```

### 环境变量
```env
# Server (.env)
DATABASE_URL="postgresql://username:password@localhost:5432/teamsync"
JWT_SECRET="your-super-secret-jwt-key"
REDIS_URL="redis://localhost:6379"
CLOUDINARY_URL="cloudinary://api_key:api_secret@cloud_name"

# Client (.env.local)
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```

## 📈 功能演示

### 1. 项目管理
- ✅ 创建、编辑、删除项目
- ✅ 项目成员管理和权限控制
- ✅ 项目状态追踪和进度可视化

### 2. 任务系统
- ✅ 看板式任务管理 (TODO/进行中/已完成)
- ✅ 任务分配、优先级设置、截止日期
- ✅ 任务评论和文件附件

### 3. 实时协作
- ✅ 团队聊天室
- ✅ 实时通知推送
- ✅ 在线状态显示

### 4. 数据分析
- ✅ 项目进度图表
- ✅ 团队效率分析
- ✅ 任务完成率统计

## 🏆 项目优势

1. **技术前沿性**: 使用2025年最新技术栈
2. **企业级复杂度**: 涵盖认证、权限、实时通信等核心功能
3. **代码质量**: 完整的TypeScript类型支持和测试覆盖
4. **部署就绪**: 包含完整的CI/CD和部署配置
5. **可扩展性**: 模块化设计，易于扩展新功能

## 📄 许可证
MIT License

---

**这个项目完美展示了:**
- 🎯 全栈开发能力 (前端+后端+数据库)
- 🛠 现代技术栈应用 (React/Node.js/TypeScript)
- 🏢 企业级应用开发经验
- 🔧 工程化和最佳实践
- 📱 用户体验和界面设计
- ⚡ 性能优化和可扩展性
