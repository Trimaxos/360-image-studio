# 360 Image Studio

Trình chỉnh sửa ảnh panorama 360° và ảnh phẳng trên trình duyệt, tích hợp AI qua fal.ai. Chọn vùng cần sửa, tạo mask, xem các phương án AI và ghép kết quả vào ảnh gốc trong cùng một ứng dụng.

- Xem panorama equirectangular, điều chỉnh góc nhìn và đường chân trời.
- Chỉnh ảnh theo vùng, quản lý layer và so sánh các biến thể kết quả.
- Lưu/mở dự án `.360project` và xuất ảnh.
- Viết prompt tiếng Việt; hỗ trợ dịch qua DeepSeek hoặc OpenCode.

**Công nghệ:** React, TypeScript, Photo Sphere Viewer, Fabric.js, Express và Sharp/libvips.

## Chạy từ mã nguồn

Cài Node.js 22.12+ và npm. Sao chép `.env.example` thành `.env`, điền `FAL_AI_KEY` và cấu hình đăng nhập riêng. Các khóa dịch prompt là tùy chọn; dịch vụ AI có điều khoản và chi phí riêng.

```sh
npm ci
npm start
```

Mở **http://localhost:3001**. Khi phát triển, chạy `npm run server` và `npm run dev` ở hai terminal; giao diện phát triển ở **http://localhost:5173**.

## Bản đóng gói

Tải bộ cài tại [**Releases**](https://github.com/Trimaxos/360-image-studio/releases), rồi làm theo [hướng dẫn cài đặt](release/HUONG-DAN-CAI-DAT.md). Docker image và bộ cài ZIP/TAR được phân phối qua release assets, không lưu trong cây mã nguồn. Trước khi phân phối lại bản đóng gói, đọc [các yêu cầu giấy phép](THIRD_PARTY_NOTICES.md#6-phân-phối-bản-đóng-gói).

## Giấy phép

Mã nguồn và tài liệu do dự án sở hữu được phát hành theo **[MIT](LICENSE)**, cho phép sử dụng, sửa đổi và phân phối, kể cả thương mại, với điều kiện giữ thông báo bản quyền và giấy phép.

Các thư viện, thành phần Docker, dịch vụ AI và nội dung của bên thứ ba giữ nguyên điều khoản riêng. Xem [mô tả giấy phép và kết quả rà soát](THIRD_PARTY_NOTICES.md) cùng [danh mục và nguyên văn thông báo bản quyền](licenses/README.md).
