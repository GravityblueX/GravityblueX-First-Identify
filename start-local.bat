@echo off
echo 🚀 TeamSync 本地启动脚本
echo ================================

echo 📋 检查 Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 请先安装 Docker Desktop
    echo 下载地址: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo 📋 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 请先安装 Node.js 20+
    echo 下载地址: https://nodejs.org
    pause
    exit /b 1
)

echo ✅ 环境检查通过

echo 📁 设置环境变量...
if not exist .env (
    copy .env.example .env
    echo ✅ 已创建 .env 配置文件
)

echo 🐳 启动 Docker 服务...
echo 正在启动数据库和缓存服务，请稍候...
docker-compose up -d postgres redis

echo ⏳ 等待数据库启动...
timeout /t 15 /nobreak >nul

echo 📦 安装依赖...
echo 正在安装根目录依赖...
call npm install

echo 正在安装后端依赖...
cd server
call npm install

echo 正在安装前端依赖...
cd ..\client
call npm install

echo 🗃️ 初始化数据库...
cd ..\server
call npx prisma generate
call npx prisma db push
call npx prisma db seed

echo 🚀 启动应用服务...
cd ..
start "后端服务" cmd /k "cd server && npm run dev"
timeout /t 5 /nobreak >nul
start "前端服务" cmd /k "cd client && npm run dev"

echo 🎉 启动完成！
echo.
echo 📱 访问地址:
echo   前端应用: http://localhost:3000
echo   后端API:  http://localhost:5000/health
echo   GraphQL:  http://localhost:5000/graphql
echo.
echo 👤 测试账户:
echo   邮箱: admin@teamsync.com
echo   密码: Admin123!
echo.
echo 🔧 管理命令:
echo   docker-compose logs     - 查看服务日志
echo   docker-compose down     - 停止所有服务
echo   docker-compose restart  - 重启服务
echo.
echo 正在打开浏览器...
timeout /t 3 /nobreak >nul
start http://localhost:3000

pause