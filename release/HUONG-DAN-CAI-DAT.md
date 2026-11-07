# Hướng dẫn cài đặt 360 Image Studio (bản đóng gói)

Tài liệu này dành cho máy Windows chạy ứng dụng hoàn toàn tại `http://localhost:3001`. Không cần domain, Nginx hoặc SSL.

Bộ cài này đã có sẵn image ứng dụng, **không cần source code và không cần build**.

Tải `360-image-studio-package.zip` trong phần **Assets** tại [Releases](https://github.com/Trimaxos/360-image-studio/releases). Các mục **Source code (zip/tar.gz)** do GitHub tạo tự động không phải bộ cài chứa image.

## 1. Yêu cầu máy tính

- Windows 10/11 64-bit.
- RAM tối thiểu 8 GB, khuyến nghị 16 GB khi xử lý ảnh panorama lớn.
- Còn trống tối thiểu 10 GB ổ đĩa.
- Đã bật Virtualization trong BIOS/UEFI.
- Có kết nối Internet khi sử dụng AI cloud.
- Có tài khoản ChatGPT dùng được Codex (gói trả phí), để dùng model AI mặc định.

## 2. Nội dung bộ cài

Thư mục bộ cài gồm:

```text
360-image-studio/
├── 360-image-studio.tar      # image ứng dụng đã đóng gói
├── compose.yaml              # cấu hình chạy ứng dụng
├── .env.example              # mẫu cấu hình, cần sao chép thành .env
├── SHA256.txt                # mã kiểm tra toàn vẹn file image (tùy chọn)
└── HUONG-DAN-CAI-DAT.md      # tài liệu này
```

Giải nén bộ cài vào một thư mục cố định, ví dụ:

```text
D:\360-image-studio
```

Không chạy trực tiếp ứng dụng bên trong file ZIP khi chưa giải nén.

## 3. Cài WSL 2

Mở PowerShell bằng quyền **Run as administrator**, chạy:

```powershell
wsl --install
```

Khởi động lại Windows nếu hệ thống yêu cầu.

## 4. Cài Docker Desktop

1. Cài Docker Desktop for Windows (nhờ quản trị viên cung cấp installer nếu máy không có mạng ngoài).
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

## 5. Cài Codex CLI và đăng nhập ChatGPT (model AI mặc định)

Model mặc định của ứng dụng là **GPT Image — ChatGPT trực tiếp**: tạo ảnh bằng hạn mức của tài khoản ChatGPT, không tốn tiền fal.ai. Ứng dụng dùng phiên đăng nhập ChatGPT của **Codex CLI** (chương trình dòng lệnh của OpenAI) trên chính máy Windows này. Chỉ đăng nhập ChatGPT trên trình duyệt là **chưa đủ**. Bỏ qua mục này nếu chỉ dùng model fal.ai.

1. Cài Node.js bản LTS (18 trở lên) từ [nodejs.org](https://nodejs.org), giữ các tùy chọn mặc định. Kiểm tra trong PowerShell:

   ```powershell
   node -v
   npm -v
   ```

2. Cài Codex CLI:

   ```powershell
   npm install -g @openai/codex
   codex --version
   ```

3. Đăng nhập:

   ```powershell
   codex login
   ```

   Trình duyệt tự mở trang đăng nhập OpenAI. Đăng nhập bằng tài khoản ChatGPT do quản trị viên cung cấp, chờ trang báo thành công rồi quay lại PowerShell.

4. Kiểm tra:

   ```powershell
   codex login status
   ```

   Kết quả đúng là `Logged in using ChatGPT`.

Chỉ cần làm **một lần**. Không cần giữ cửa sổ nào mở trong lúc dùng ứng dụng. Ứng dụng tự gia hạn phiên đăng nhập. Chỉ khi ứng dụng báo đăng nhập hết hạn hoặc cần đổi tài khoản thì chạy lại `codex login`.

Mỗi máy dùng hạn mức của tài khoản ChatGPT đăng nhập trên máy đó.

Cập nhật Codex CLI lên bản mới:

```powershell
npm install -g @openai/codex@latest
```

9router không còn cần cho ứng dụng: các model 9router đang tạm ẩn vì OpenAI thay đổi cách tạo ảnh, 9router chưa hỗ trợ.

## 6. Tạo cấu hình môi trường

Mở PowerShell trong thư mục bộ cài và tạo file `.env` từ file mẫu:

```powershell
cd D:\360-image-studio
Copy-Item .env.example .env
```

Không cần điền gì vào file này: API key được nhập ngay trong ứng dụng (mục 7).

## 7. Nạp image và chạy lần đầu

Đảm bảo Docker Desktop đang chạy, sau đó thực hiện:

```powershell
cd D:\360-image-studio
docker load -i 360-image-studio.tar
```

Kết quả đúng có dòng `Loaded image: 360-image-studio:latest`.

Kiểm tra nhanh mã toàn vẹn file image (tùy chọn, so với nội dung `SHA256.txt`):

```powershell
Get-FileHash .\360-image-studio.tar -Algorithm SHA256
```

Khởi động ứng dụng:

```powershell
docker compose up -d
```

Lần chạy đầu có thể mất khoảng một phút. Kiểm tra:

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

Model mặc định **GPT Image — ChatGPT trực tiếp** không cần nhập key, chỉ cần đã đăng nhập Codex CLI (mục 5). Kiểm tra nhanh: mở một ảnh, chọn vùng, nhập prompt rồi bấm **Generate**. Sau khoảng 15–30 giây phải có kết quả.

Chỉ cần ⚙ Settings khi dùng model fal.ai. Bấm nút **⚙ Settings** trên thanh trên cùng, điền rồi bấm **Lưu**.

- `Key fal.ai`: dùng cho model GPT Image 2.5 Flare Edit (Medium) của fal.ai (tính tiền theo ảnh). Để trống thì không dùng được model này.
- `URL 9router`, `API key 9router`: để nguyên hoặc để trống, các model 9router đang tạm ẩn.

Chỉ cần nhập một lần: tắt mở lại máy hay cập nhật phiên bản mới (mục 10) đều không phải nhập lại. Bấm Generate khi model đang chọn chưa có key, ứng dụng sẽ nhắc mở Settings.

## 8. Sử dụng hằng ngày

Thông thường chỉ cần:

1. Mở Docker Desktop.
2. Chờ Docker Engine khởi động.
3. Mở `http://localhost:3001`.

Nếu Generate báo **chưa đăng nhập Codex CLI** hoặc **đăng nhập đã hết hạn**: mở PowerShell, chạy `codex login`, đăng nhập lại rồi bấm Generate lần nữa (không cần khởi động lại ứng dụng).

Nếu ứng dụng chưa chạy:

```powershell
cd D:\360-image-studio
docker compose up -d
```

## 9. Dừng và khởi động lại

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

## 10. Cập nhật phiên bản mới

1. Nhận file `360-image-studio.tar` và `compose.yaml` phiên bản mới từ quản trị viên.
2. Chép đè các file cũ trong thư mục bộ cài (giữ nguyên file `.env`).
3. Nếu máy chưa cài Codex CLI: làm mục 5 trước.
4. Chạy:

```powershell
cd D:\360-image-studio
docker compose down
docker load -i 360-image-studio.tar
docker compose up -d
```

Dữ liệu trong Docker volume vẫn được giữ khi cập nhật.

## 11. Kiểm tra và xử lý lỗi

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

Nếu Generate với model ChatGPT báo lỗi:

- `chưa đăng nhập Codex CLI` hoặc `đã hết hạn`: chạy `codex login` (mục 5).
- `ChatGPT error: 429`: tài khoản đã dùng hết hạn mức tạo ảnh, chờ hạn mức hồi lại hoặc đổi tài khoản bằng `codex login`.
- Đã đăng nhập mà vẫn báo chưa đăng nhập: kiểm tra `codex login status` và có file `%USERPROFILE%\.codex\auth.json`, kiểm tra thư mục bộ cài dùng `compose.yaml` bản mới (có dòng `.codex:/codex`), rồi chạy `docker compose up -d` trong thư mục bộ cài.

Gửi kết quả `docker compose ps` và `docker compose logs --tail=100` cho quản trị viên nếu không tự xử lý được.

## 12. Bảo vệ dữ liệu

Không chạy lệnh sau nếu chưa được quản trị viên xác nhận:

```powershell
docker compose down -v
```

Tùy chọn `-v` xóa Docker volume chứa cache, dữ liệu cục bộ và các key đã nhập trong ⚙ Settings.

Nên dùng chức năng **Download Project** thường xuyên. Docker volume không thay thế file project sao lưu; nếu Windows hoặc ổ đĩa hỏng, dữ liệu trong volume vẫn có thể mất.
