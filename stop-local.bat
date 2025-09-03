@echo off
echo 🛑 TeamSync 停止脚本
echo ================================

echo 🔄 停止所有 Docker 服务...
docker-compose down

echo 🔄 停止 Node.js 进程...
taskkill /f /im node.exe >nul 2>&1

echo ✅ 所有服务已停止

echo 🧹 清理选项:
echo [1] 保留数据 (推荐)
echo [2] 清理所有数据和容器
set /p choice="请选择 (1/2): "

if "%choice%"=="2" (
    echo 🗑️ 清理所有数据...
    docker-compose down -v
    docker system prune -f
    echo ✅ 数据已清理
) else (
    echo ✅ 数据已保留
)

pause