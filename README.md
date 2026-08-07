# 360 Image Studio

AI-powered web editor chuyên biệt cho ảnh panorama 360° (Equirectangular).

Mục tiêu: xem ảnh, chọn vùng, chỉnh AI, cân đường chân trờằ, xuất ảnh — tất cả trong cùng một ứng dụng, tối ưu cho equirectangular.

## Yêu cầu hệ thống

- Windows 10/11 (64-bit)
- [Node.js](https://nodejs.org/) phiên bản LTS (khuyến nghị 20.x trở lên)
- Git (để clone code)
- API key:
  - `FAL_AI_KEY` — lấy tại [fal.ai](https://fal.ai)
  - `DEEPSEEK_API_KEY` — lấy tại [deepseek.com](https://deepseek.com) (dùng để dịch prompt)

## Cài đặt trên Windows (một lần duy nhất)

### Bước 1: Clone code về máy

```powershell
git clone https://github.com/Trimaxos/360-image-studio.git
cd 360-image-studio
```

Hoặc tải ZIP về, giải nén ra thư mục `360-image-studio`.

### Bước 2: Tạo file cấu hình môi trường

Trong thư mục `360-image-studio`, copy file:

```
.env.example  →  .env
```

Mở file `.env` bằng Notepad, điền key:

```env
FAL_AI_KEY=your_fal_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here
```

### Bước 3: Chạy script cài đặt

Double-click vào file:

```
setup-windows.bat
```

Script này sẽ tự động:

1. Cài đặt các thư viện (`npm install`)
2. Build ứng dụng client (`npm run build`)
3. Kiểm tra cấu hình `.env`

Chờ chạy xong, cửa sổ sẽ tự đóng.

## Chạy ứng dụng

### Cách 1: Double-click để chạy

Mở file:

```
start-windows.bat
```

Máy sẽ tự động:

1. Khởi động server backend
2. Mở trình duyệt mặc định tại `http://localhost:3001`

### Cách 2: Tự động chạy khi bật máy

1. Nhấn `Win + R`, gõ `shell:startup`, nhấn Enter
2. Copy file `start-windows.bat` vào thư mục Startup vừa mở
3. Từ lần sau, mỗi khi bật máy Windows, ứng dụng sẽ tự khởi động và mở trình duyệt

## Cấu trúc thư mục

```
360-image-studio/
├── client/          # Giao diện React + TypeScript
├── server/          # Backend Node.js + Express
├── shared/          # Kiểu dữ liệu dùng chung
├── docs/            # Tài liệu kỹ thuật
├── dist/            # File build (tự động tạo sau setup-windows.bat)
├── setup-windows.bat
└── start-windows.bat
```

## Script có sẵn

| Script | Mục đích |
|--------|----------|
| `setup-windows.bat` | Cài đặt lần đầu, build toàn bộ ứng dụng |
| `start-windows.bat` | Khởi động server và mở trình duyệt |

## Cập nhật khi có code mới

Khi pull code mới về, chạy lại:

```
setup-windows.bat
```

Script sẽ cài thêm thư viện mới (nếu có) và build lại.

## Lưu ý

- Máy cần kết nối Internet để sử dụng tính năng AI (fal.ai) và dịch prompt (DeepSeek).
- Mặc định server chạy tại `http://localhost:3001`.
- File `.env` chứa API key, **không được commit** lên Git (đã có trong `.gitignore`).
- Ảnh tải lên và kết quả chỉnh sửa được lưu tạm trong thư mục cache của user (`%USERPROFILE%\.cache\360-image-studio`).
