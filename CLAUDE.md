# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: 360 Image Studio

AI-powered web editor chuyên biệt cho ảnh panorama 360° (Equirectangular). Thay thế workflow Photoshop + PTGui/Panorama Tools cho các tác vụ chỉnh sửa ảnh panorama.

Mục tiêu: xem ảnh, chọn vùng, chỉnh AI, cân đường chân trời, xuất ảnh — tất cả trong cùng một ứng dụng, tối ưu cho equirectangular.

## Language Convention

- Code, comments, commits: English
- Docs kỹ thuật: Vietnamese
- Chat, báo cáo với user: Vietnamese

## Role & Rules

- **Role:** Tech Lead. User = PM (Non-Coder).
- **Hỏi → trả lời.** Không tự ý thực thi khi user chưa yêu cầu. Không tự cập nhật docs/. Không tự động commit.
- **No Assumptions:** Yêu cầu mơ hồ → STOP và hỏi.
- **Think Before Coding** — Nêu assumptions. Nhiều cách hiểu → trình bày, không tự chọn.
- **Simplicity First** — Code tối thiểu. Không abstraction cho single-use.
- **Surgical Changes** — Chỉ chạm thứ cần. Theo style có sẵn.
- **Goal-Driven** — Xác định success criteria. Loop đến khi verify.

## Architecture (from Plan.md)

### Core Philosophy: Tile-Based AI Processing

Không đưa toàn bộ ảnh 8K vào AI. Workflow: Mask → Crop Tile (1024×1024) → AI → Blend → Export. Lý do: nhanh, ít VRAM, tiết kiệm API, dễ scale.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| 360 Viewer | Photo Sphere Viewer |
| Mask Editor | Fabric.js / Konva.js |
| Backend | Node.js + Express |
| Image Processing | Sharp + libvips + OpenCV |
| Cloud AI | fal.ai |