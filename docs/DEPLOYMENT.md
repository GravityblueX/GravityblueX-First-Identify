# TeamSync 部署指南

## 🚀 生产环境部署

### 1. AWS 部署 (推荐)

#### 前置要求
- AWS账户
- Docker
- AWS CLI
- Terraform (可选)

#### 部署架构
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   CloudFront    │    │   Application    │    │   Database      │
│   (CDN)         │───▶│   Load Balancer  │───▶│   RDS PostgreSQL│
│                 │    │   (ALB)          │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   ECS Cluster    │
                       │   ┌────────────┐ │
                       │   │ Frontend   │ │
                       │   │ (Next.js)  │ │
                       │   └────────────┘ │
                       │   ┌────────────┐ │
                       │   │ Backend    │ │
                       │   │ (Node.js)  │ │
                       │   └────────────┘ │
                       └──────────────────┘
```

#### 步骤 1: 数据库设置 (RDS)
```bash
# 创建 RDS PostgreSQL 实例
aws rds create-db-instance \
  --db-instance-identifier teamsync-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username postgres \
  --master-user-password your-secure-password \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxxxxx
```

#### 步骤 2: 容器注册表 (ECR)
```bash
# 创建 ECR 仓库
aws ecr create-repository --repository-name teamsync-frontend
aws ecr create-repository --repository-name teamsync-backend

# 构建并推送镜像
docker build -t teamsync-frontend ./client
docker build -t teamsync-backend ./server

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag teamsync-frontend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/teamsync-frontend:latest
docker tag teamsync-backend:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/teamsync-backend:latest

docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/teamsync-frontend:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/teamsync-backend:latest
```

#### 步骤 3: ECS 服务部署
```bash
# 创建 ECS 集群
aws ecs create-cluster --cluster-name teamsync-cluster

# 创建任务定义
aws ecs register-task-definition --cli-input-json file://aws/task-definition.json

# 创建服务
aws ecs create-service \
  --cluster teamsync-cluster \
  --service-name teamsync-service \
  --task-definition teamsync:1 \
  --desired-count 2 \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=frontend,containerPort=3000
```

### 2. Vercel 部署 (前端)

#### 前端部署到 Vercel
```bash
# 安装 Vercel CLI
npm i -g vercel

# 在 client 目录下部署
cd client
vercel --prod
```

#### 环境变量设置
在 Vercel 仪表板中设置:
```env
NEXT_PUBLIC_API_URL=https://api.teamsync.com
NEXT_PUBLIC_SOCKET_URL=https://api.teamsync.com
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
```

### 3. Railway 部署 (全栈)

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录并初始化
railway login
railway init

# 部署
railway up
```

## 🐳 Docker Compose 生产部署

### docker-compose.prod.yml
```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on:
      - client
      - server

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: teamsync
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  server:
    build: 
      context: ./server
      dockerfile: Dockerfile.prod
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/teamsync
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  client:
    build:
      context: ./client
      dockerfile: Dockerfile.prod
    environment:
      NEXT_PUBLIC_API_URL: https://api.yourdomain.com
      NEXT_PUBLIC_SOCKET_URL: https://api.yourdomain.com
    depends_on:
      - server
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

## 🔧 环境配置

### 生产环境变量

#### 服务器 (.env)
```env
NODE_ENV=production
DATABASE_URL=postgresql://username:password@your-db-host:5432/teamsync
REDIS_URL=redis://your-redis-host:6379
JWT_SECRET=your-super-secure-jwt-secret-key-256-bits
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
PORT=5000
CLIENT_URL=https://teamsync.yourdomain.com
```

#### 客户端 (.env.local)
```env
NEXT_PUBLIC_API_URL=https://api.teamsync.yourdomain.com
NEXT_PUBLIC_SOCKET_URL=https://api.teamsync.yourdomain.com
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

## 🔒 安全配置

### SSL/TLS 证书
```bash
# 使用 Let's Encrypt 获取免费 SSL 证书
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.teamsync.yourdomain.com
sudo certbot --nginx -d teamsync.yourdomain.com
```

### Nginx 配置
```nginx
server {
    listen 80;
    server_name teamsync.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name teamsync.yourdomain.com;
    
    ssl_certificate /etc/nginx/ssl/teamsync.crt;
    ssl_certificate_key /etc/nginx/ssl/teamsync.key;
    
    location / {
        proxy_pass http://client:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name api.teamsync.yourdomain.com;
    
    ssl_certificate /etc/nginx/ssl/api.crt;
    ssl_certificate_key /etc/nginx/ssl/api.key;
    
    location / {
        proxy_pass http://server:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /socket.io/ {
        proxy_pass http://server:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📊 监控和日志

### 健康检查端点
```bash
curl https://api.teamsync.com/health
```

### 应用监控
```javascript
// server/src/monitoring/health.ts
app.get('/health', async (req, res) => {
  const health = await MonitoringService.getFullReport();
  res.json(health);
});

app.get('/metrics', async (req, res) => {
  const metrics = MonitoringService.getHealthMetrics();
  res.json(metrics);
});
```

### 日志配置
```javascript
// 使用 Winston 进行结构化日志
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

## 🔄 CI/CD 自动化部署

### GitHub Actions 部署流程
```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Build and push images
      run: |
        # Build images
        docker build -t teamsync-frontend ./client
        docker build -t teamsync-backend ./server
        
        # Push to ECR
        aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY
        docker tag teamsync-frontend:latest $ECR_REGISTRY/teamsync-frontend:latest
        docker tag teamsync-backend:latest $ECR_REGISTRY/teamsync-backend:latest
        docker push $ECR_REGISTRY/teamsync-frontend:latest
        docker push $ECR_REGISTRY/teamsync-backend:latest
    
    - name: Update ECS service
      run: |
        aws ecs update-service --cluster teamsync-cluster --service teamsync-service --force-new-deployment
```

## 🔧 数据库迁移

### 生产环境数据库设置
```bash
# 在服务器上运行迁移
cd server
npm run db:push
npm run db:seed

# 备份策略
pg_dump teamsync > backup_$(date +%Y%m%d_%H%M%S).sql
```

## 📈 性能优化

### 1. 数据库优化
```sql
-- 添加索引
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);
```

### 2. Redis 缓存
```javascript
// 缓存项目数据
const cacheKey = `project:${projectId}`;
const cachedProject = await redis.get(cacheKey);

if (cachedProject) {
  return JSON.parse(cachedProject);
}

const project = await prisma.project.findUnique({...});
await redis.setex(cacheKey, 300, JSON.stringify(project)); // 5分钟缓存
```

### 3. CDN 配置
```javascript
// Next.js 图片优化
module.exports = {
  images: {
    domains: ['res.cloudinary.com'],
    formats: ['image/webp', 'image/avif'],
  },
  // 启用静态导出优化
  output: 'standalone',
};
```

## 🛡️ 安全清单

- [ ] SSL/TLS 证书配置
- [ ] 环境变量保护 (AWS Secrets Manager)
- [ ] 数据库连接加密
- [ ] API 速率限制
- [ ] 输入验证和清理
- [ ] 安全头配置
- [ ] 定期安全扫描
- [ ] 访问日志监控
- [ ] 备份和恢复测试

## 📱 移动端适配

### PWA 配置
```json
// client/public/manifest.json
{
  "name": "TeamSync",
  "short_name": "TeamSync",
  "description": "Project Management Platform",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### Service Worker
```javascript
// client/public/sw.js
self.addEventListener('push', function(event) {
  const options = {
    body: event.data.text(),
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png'
  };
  
  event.waitUntil(
    self.registration.showNotification('TeamSync', options)
  );
});
```

## 🔍 监控配置

### 健康检查
```bash
# Kubernetes 健康检查
livenessProbe:
  httpGet:
    path: /health
    port: 5000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 5000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### 日志聚合 (ELK Stack)
```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  logstash:
    image: docker.elastic.co/logstash/logstash:8.8.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
      - ./logs:/logs

  kibana:
    image: docker.elastic.co/kibana/kibana:8.8.0
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - "5601:5601"
```

## 📦 发布流程

### 1. 版本发布
```bash
# 更新版本号
npm version patch  # 或 minor, major

# 创建发布标签
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### 2. 自动化发布
```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Create Release
      uses: actions/create-release@v1
      with:
        tag_name: ${{ github.ref }}
        release_name: Release ${{ github.ref }}
        draft: false
        prerelease: false
```

## 🏃‍♂️ 快速部署脚本

```bash
#!/bin/bash
# deploy.sh

set -e

echo "🚀 Starting TeamSync deployment..."

# 1. 环境检查
if [ ! -f "server/.env" ]; then
  echo "❌ Server .env file not found!"
  exit 1
fi

# 2. 构建应用
echo "📦 Building applications..."
docker-compose build

# 3. 数据库迁移
echo "🗄️ Running database migrations..."
docker-compose run --rm server npm run db:push

# 4. 启动服务
echo "🔄 Starting services..."
docker-compose up -d

# 5. 健康检查
echo "🏥 Checking application health..."
sleep 30
curl -f http://localhost:5000/health || exit 1

echo "✅ Deployment completed successfully!"
echo "🌐 Frontend: http://localhost:3000"
echo "🔧 Backend: http://localhost:5000"
```

## 🔄 备份和恢复

### 数据库备份
```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="teamsync_backup_$TIMESTAMP.sql"

# 创建备份
pg_dump $DATABASE_URL > "$BACKUP_DIR/$BACKUP_FILE"

# 压缩备份
gzip "$BACKUP_DIR/$BACKUP_FILE"

# 上传到 S3
aws s3 cp "$BACKUP_DIR/$BACKUP_FILE.gz" s3://teamsync-backups/

# 清理本地备份 (保留最近7天)
find $BACKUP_DIR -name "teamsync_backup_*.sql.gz" -mtime +7 -delete

echo "✅ Backup completed: $BACKUP_FILE.gz"
```

### 数据恢复
```bash
# 恢复数据库
gunzip backup_file.sql.gz
psql $DATABASE_URL < backup_file.sql
```