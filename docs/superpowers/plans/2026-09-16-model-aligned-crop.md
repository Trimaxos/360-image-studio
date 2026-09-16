# Căn crop theo model — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, triển khai tuần tự trong phiên hiện tại.

**Goal:** Khung thực tế được xem trước và căn hợp lệ trước khi tạo layer GPT Image 2.5, giữ tâm và không bóp hình.

**Architecture:** Helper thuần dùng chung quyết định crop và kích thước xử lý. Flat giữ tọa độ crop native để composite chính xác; crop nhỏ/lớn được resize đồng đều tại Generate. 360 render trực tiếp ra kích thước hợp lệ và lưu đúng rect đã căn để reproject. Server tiếp tục bảo vệ các layer cũ hoặc khi đổi model.

**Tech Stack:** TypeScript, React, Sharp, node:test.

## Constraints

- Chỉ bật tự căn với model có supportsCustomImageSize; cho phép tắt trên UI.
- Hai khung: kéo chọn nét đứt, crop thực tế nét liền; hiển thị kích thước crop và AI.
- Giữ tâm; crop nằm trong vùng kéo. Chỉ canvas AI bắt buộc bội 16; crop native dùng số pixel nguyên và cùng tỉ lệ chính xác với canvas. Aspect tối đa 3:1; canvas AI có 655360–8294400 pixel, cạnh tối đa 3840.
- Flat lưu kích thước native; nếu phải đổi độ phân giải, ảnh gửi và mask dùng cùng phép resize. Không đổi vị trí đặt layer theo kích thước AI.
- Full Frame có preview trước khi áp dụng; không tự bỏ qua khung đã căn.
- Vùng native dưới 16px một cạnh: báo chọn rộng hơn hoặc tắt tự căn.
- Không đổi quy ước mask, không call AI trả phí, không tự commit. Tiếp tục trên nhánh feat/edit-flat-image với phần resize chưa commit của user.

## Task 1 — Quy tắc dùng chung

- [x] Viết test `server/model-crop.test.ts`: 1000×700 → 992×688; crop nhỏ; quá dài/hẹp; quá lớn; idempotent; center/bounds; invalid.
- [x] Chạy `node_modules/.bin/tsx.cmd --test server/model-crop.test.ts`, xác nhận fail vì thiếu helper.
- [x] Tạo `shared/model-crop.ts`: `planModelCrop(width,height)` trả `{ crop: {x,y,width,height}, output: {width,height} }`; `isValidModelSize`; `exactModelSize` chọn tỉ lệ chính xác trên lưới 16. Crop lớn căn theo bước 16×hệ số giảm độ phân giải.
- [x] Chuyển `calcPerspectiveResolution` sang shared, re-export tại server; thêm `planPerspectiveCrop` dùng cùng phép tính cho preview và render.
- [x] Chạy lại test helper và perspective.

## Task 2 — Preview và áp dụng

- [x] Tích hợp helper vào `client/components/RectSelectionOverlay.tsx`. Quy đổi khung thực tế từ native về viewport; Apply dùng đúng rect/tile của preview.
- [x] Full Frame chỉ chọn khung toàn ảnh để preview, Apply Rect xác nhận. Checkbox bật mặc định cho model phù hợp; model khác giữ crop tự do.
- [x] Thêm CSS cho hai khung và thông tin kích thước, bắt resize viewport để không lệch preview.
- [x] Mở rộng `PerspectiveRenderRequest` với `alignToModel`; response có rect đã render. Server quyết định output và rect bằng helper, client lưu response rect cho reproject.
- [x] Test phối cảnh: render có kích thước hợp lệ, tâm vùng chiếu giữ nguyên; đường cũ không đổi.

## Task 3 — Server bảo vệ và xác minh

- [x] Provider ưu tiên size cùng tỉ lệ chính xác cho crop đã căn, giữ fallback cũ cho layer legacy. Validate size trước gửi, kiểm tra kích thước output trước normalize.
- [x] Resize mask kiểm tra kích thước độc lập; giữ PNG mask. Test request qua mock fetch: source/mask/output khớp và không đổi tọa độ layer.
- [x] Chạy `npm.cmd test`, `node_modules/.bin/tsc.cmd --noEmit`, `npm.cmd run build`.
- [x] Review diff, cập nhật trạng thái plan và báo các giới hạn kiểm chứng thực tế.

## Kết quả kiểm chứng

- Hoàn tất trên nhánh feat/edit-flat-image; chưa commit.
- npm.cmd test: 107 test + 6 regression pass; tsc --noEmit và build pass.
- Review độc lập phát hiện model bị khóa trước crop; đã mở chọn model ở viewing/rect-select và thêm regression test.
- Kiểm tra UI bằng React/jsdom, render ảnh perspective bằng Sharp và request AI bằng mock fetch. Phiên không có browser/app kết nối để kiểm tra giao diện trực quan; chưa gọi fal tính phí, chưa xác nhận hết drift nội tại của model.
- Crop native của flat và kích thước AI có thể khác khi phải phóng/thu; phép resize giữ đúng tỉ lệ. Layer cũ hoặc tự căn tắt vẫn dùng fallback server.

## Điều chỉnh: chọn đồng thời crop và canvas

User xác nhận không giới hạn phần trăm mất diện tích, không hỏi xác nhận thêm. Giữ hai khung cập nhật trực tiếp khi kéo để user tự mở rộng vùng nếu cần.

- [x] Giữ nguyên crop đã đạt hợp đồng size sau khi căn mép lưới.
- [x] Với crop nhỏ/lớn/quá dài: xét các tỉ lệ canvas hợp lệ, tìm crop pixel nguyên lớn nhất cùng tỉ lệ trong vùng kéo. Chọn theo tổng sai số log của diện tích giữ lại và độ phân giải so với mục tiêu; nếu bằng nhau ưu tiên ít pixel AI hơn. Không dùng ngưỡng mất diện tích.
- [x] Native crop không bắt buộc bội 16. Server dùng cùng hàm suy ra canvas chính xác từ tỉ lệ native, tránh tự chọn canvas khác preview.
- [x] Regression 976×544 → crop 952×532 ở offset (12,6), canvas 1088×608. Kiểm tra live pointermove và vị trí native.
- [x] Layer cũ không tự recrop. Khi tìm được size cùng tỉ lệ chính xác, provider ưu tiên nó (ví dụ 1000×700 → 1120×784).