@echo off
chcp 65001 >nul
title 360 Image Studio — Cài đặt

echo ===========================================
echo   360 Image Studio — Cài đặt Windows
echo ===========================================
echo.

:: Kiểm tra Node.js
echo [1/4] Kiểm tra Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [LỖI] Không tìm thấy Node.js.
    echo Vui lòng cài đặt Node.js LTS tại: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo       OK

:: Kiểm tra file .env
echo.
echo [2/4] Kiểm tra file .env...
if not exist ".env" (
    echo       File .env chưa có.
    if exist ".env.example" (
        echo       Đang tạo .env từ .env.example...
        copy ".env.example" ".env" >nul
        echo       Đã tạo .env. Vui lòng mở file này và điền FAL_AI_KEY + DEEPSEEK_API_KEY.
        echo       Sau đó chạy setup-windows.bat lại.
        echo.
        pause
        exit /b 1
    ) else (
        echo       [LỖI] Không có .env.example. Vui lòng tạo file .env thủ công.
        echo.
        pause
        exit /b 1
    )
) else (
    echo       OK: .env đã tồn tại.
)

:: Cài đặt dependencies
echo.
echo [3/4] Đang cài đặt thư viện (có thể mất vài phút)...
call npm install
if errorlevel 1 (
    echo.
    echo [LỖI] Cài đặt thư viện thất bại.
    echo.
    pause
    exit /b 1
)

:: Build ứng dụng
echo.
echo [4/4] Đang build ứng dụng...
call npm run build
if errorlevel 1 (
    echo.
    echo [LỖI] Build thất bại.
    echo.
    pause
    exit /b 1
)

echo.
echo ===========================================
echo   Cài đặt HOÀN TẤT.
echo   Để chạy: double-click start-windows.bat
echo ===========================================
echo.
pause
