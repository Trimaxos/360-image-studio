@echo off
chcp 65001 >nul
title 360 Image Studio — Khởi động

echo ===========================================
echo   360 Image Studio — Đang khởi động...
echo ===========================================
echo.

:: Kiểm tra Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [LỖI] Không tìm thấy Node.js.
    echo Vui lòng cài đặt Node.js LTS tại: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Nếu chưa build thì build tự động
if not exist "dist\client\index.html" (
    echo [THÔNG BÁO] Chưa có file build. Đang build tự động...
    call npm run build
    if errorlevel 1 (
        echo.
        echo [LỖI] Build thất bại. Vui lòng chạy setup-windows.bat trước.
        echo.
        pause
        exit /b 1
    )
)

:: Khởi động server trong cửa sổ riêng
start "360 Image Studio Server" cmd /c "npm run server"

:: Chờ server khởi động
echo [ĐỢI] Đang chờ server sẵn sàng...
timeout /t 3 /nobreak >nul

:: Mở trình duyệt
start http://localhost:3001

echo.
echo 360 Image Studio đang chạy tại http://localhost:3001
echo Bạn có thể đóng cửa sổ này. Server chạy trong cửa sổ "360 Image Studio Server".
echo.
timeout /t 2 /nobreak >nul
exit
