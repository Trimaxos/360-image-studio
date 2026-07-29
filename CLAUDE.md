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
| Local AI | FLUX.1-Fill-dev GGUF (Q4_K_M) |
| Cloud AI | fal.ai |

### Key Workflows

1. **AI Remove Object / General Edit:** Mask → Crop Tile → Translate Prompt (VN→EN) → Image Edit → Blend → Preview → Apply → History
2. **Horizon Level:** Roll/Pitch/Yaw adjustment, preview realtime, render full resolution on export
3. **Smart Seam:** Tự wrap ảnh khi tile chạm mép panorama để không xuất hiện đường nối
4. **Projection Correction:** Equirectangular → Perspective Projection khi vùng edit gần cực panorama → AI → Project Back → Blend

### AI Provider Architecture

Tất cả provider implement cùng interface (`generate()`, `edit()`, `inpaint()`):
- **Local:** FLUX.1-Fill-dev GGUF (Q4_K_M) — preview, offline, GPU 8GB
- **API:** fal.ai — export HQ, nhiều model (FLUX Kontext, HiDream, FLUX Fill, Qwen Image)
- **Future:** Any provider — không lock-in

### MVP Phases

- **Phase 1:** Viewer, Flat View, Brush/Rectangle Mask, Prompt, Remove Object, General Edit, Export
- **Phase 2:** Horizon Level, Projection Correction, Smart Seam, History (Undo/Redo bằng Operations)
- **Phase 3:** Batch Edit, Preset Prompt, Multi Tile Render, Queue

### Out of Scope

Auto Detect Object, GroundingDINO, SAM, Face Detection, Auto Selection, Layer (Photoshop-style), Text Generation, Vector Editing. Mọi thao tác chọn vùng đều do người dùng thực hiện.

## Key Constraints

- Ảnh đầu vào/và ra: 8K–16K Equirectangular
- Preview: 1024px → AI → hài lòng → Render Full Resolution
- Export: JPG/PNG/WEBP/AVIF, render trực tiếp từ ảnh gốc (không qua Canvas)
- Undo/Redo: lưu Operations, không lưu ảnh → Undo vô hạn
- Prompt hỗ trợ tiếng Việt và tiếng Anh (translator: Qwen3 4B Local hoặc API LLM giá rẻ)
