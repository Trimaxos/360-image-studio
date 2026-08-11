# Hướng dẫn cài đặt 360 Image Studio

Tài liệu này dành cho máy Windows chạy ứng dụng hoàn toàn tại `http://localhost:3001`. Không cần domain, Nginx hoặc SSL.

## 1. Yêu cầu máy tính

- Windows 10/11 64-bit.
- RAM tối thiểu 8 GB, khuyến nghị 16 GB khi xử lý ảnh panorama lớn.
- Còn trống tối thiểu 10 GB ổ đĩa.
- Đã bật Virtualization trong BIOS/UEFI.
- Có kết nối Internet trong lần build đầu và khi sử dụng AI cloud.

## 2. Cài WSL 2

Mở PowerShell bằng quyền **Run as administrator**, chạy:

```powershell
wsl --install
```

Khởi động lại Windows nếu hệ thống yêu cầu.

## 3. Cài Docker Desktop

1. Tải và cài Docker Desktop for Windows.
2. Mở Docker Desktop.
3. Vào **Settings → General** và bật:
   - `Use the WSL 2 based engine`.
   - `Start Docker Desktop when you sign in`.
4. Chờ Docker Desktop báo engine đã sẵn sàng.

Kiểm tra trong PowerShell:

```powershell
docker version
docker compose version
```

## 4. Giải nén source

Giải nén file được cung cấp vào một thư mục cố định, ví dụ:

```text
D:\360-image-studio
```

Không chạy trực tiếp ứng dụng bên trong file ZIP.

## 5. Tạo cấu hình môi trường

Mở PowerShell trong thư mục vừa giải nén:

```powershell
cd D:\360-image-studio
Copy-Item .env.example .env
notepad .env
```

Điền các API key do quản trị viên cung cấp:

```env
FAL_AI_KEY=your_fal_ai_key_here
AI_MODEL=fal-ai/flux-2/klein/9b/edit
DEEPSEEK_API_KEY=your_deepseek_api_key_here
PORT=3001
```

Giữ nguyên `AUTH_USERNAME` và `AUTH_PASSWORD_HASH` nếu quản trị viên không yêu cầu thay đổi.

Không gửi file `.env` cho người ngoài vì file này chứa API key.

## 6. Build và chạy lần đầu

Đảm bảo Docker Desktop đang chạy, sau đó thực hiện:

```powershell
cd D:\360-image-studio
docker compose up -d --build
```

Lần build đầu có thể mất vài phút. Khi hoàn thành, kiểm tra:

```powershell
docker compose ps
```

Trạng thái đúng phải có `Up` và `healthy`.

Mở ứng dụng:

```powershell
Start-Process http://localhost:3001
```

Hoặc nhập vào trình duyệt:

```text
http://localhost:3001
```

## 7. Sử dụng hằng ngày

Thông thường chỉ cần:

1. Mở Docker Desktop.
2. Chờ Docker Engine khởi động.
3. Mở `http://localhost:3001`.

Nếu ứng dụng chưa chạy:

```powershell
cd D:\360-image-studio
docker compose up -d
```

## 8. Dừng và khởi động lại

Dừng ứng dụng nhưng giữ container:

```powershell
docker compose stop
```

Chạy lại:

```powershell
docker compose start
```

Khởi động lại khi ứng dụng có vấn đề:

```powershell
docker compose restart
```

## 9. Cập nhật source mới

1. Đóng ứng dụng.
2. Giữ lại file `.env` hiện tại.
3. Giải nén source mới đè vào thư mục ứng dụng.
4. Chạy:

```powershell
cd D:\360-image-studio
docker compose up -d --build
```

Dữ liệu trong Docker volume vẫn được giữ khi build lại.

## 10. Kiểm tra và xử lý lỗi

Kiểm tra trạng thái:

```powershell
docker compose ps
```

Xem 100 dòng log gần nhất:

```powershell
docker compose logs --tail=100
```

Theo dõi log trực tiếp:

```powershell
docker compose logs -f
```

Nhấn `Ctrl + C` để thoát màn hình log; ứng dụng vẫn tiếp tục chạy.

Kiểm tra API:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

Kết quả đúng là `status: ok`.

Nếu port 3001 bị chiếm:

```powershell
netstat -ano | Select-String ':3001'
```

Gửi kết quả `docker compose ps` và `docker compose logs --tail=100` cho quản trị viên nếu không tự xử lý được.

## 11. Bảo vệ dữ liệu

Không chạy lệnh sau nếu chưa được quản trị viên xác nhận:

```powershell
docker compose down -v
```

Tùy chọn `-v` xóa Docker volume chứa cache và dữ liệu cục bộ.

Nên dùng chức năng **Download Project** thường xuyên. Docker volume không thay thế file project sao lưu; nếu Windows hoặc ổ đĩa hỏng, dữ liệu trong volume vẫn có thể mất.
