# Flat Image Edit — Chế độ chỉnh sửa ảnh thường

**Date:** 2026-09-15
**Status:** Approved → Chờ PM review spec

## Overview

Thêm chế độ chỉnh sửa cho **ảnh thông thường** (không phải ảnh 360 equirectangular). Người dùng mở ảnh bất kỳ (tỉ lệ tự do) và dùng nguyên workflow tile-based hiện có: Rect Select → Canvas Edit (AI generate, variants, visibility mask, import, transform) → Export.

Đây là **tùy chọn edit ảnh flat riêng biệt**, KHÁC với "Flat View" hiện tại — Flat View chỉ là cách hiển thị ảnh 360 equirect dạng phẳng (vẫn là ảnh 360, chỉ đơn giản là không dùng PSV). Chế độ ảnh thường không có bất kỳ xử lý 360 nào: không PSV, không perspective render, không reproject, không horizon.

## Problem Statement

- App hiện giả định mọi ảnh mở vào là panorama 2:1: hiển thị qua Photo Sphere Viewer, dùng perspective render + reproject, horizon correction.
- Ảnh thường (ảnh chụp, ảnh thiết kế, ảnh tỉ lệ bất kỳ) không dùng được các tính năng 360. Nếu đưa vào app, viewer 360 sẽ bóp méo và các bước projection không có ý nghĩa.
- Nền tảng đã có sẵn: nhánh `sourceView: 'flat'` trong Rect Select tạo layer `type: 'flat'`, crop tile trực tiếp từ ảnh gốc và composite tại `tileCoords` — không cần projection. Phần thiếu là phân biệt chế độ ảnh và khóa các tính năng 360.

## Goals

1. Mở ảnh thường → tự động nhận chế độ `flat` theo tỉ lệ ảnh.
2. Cho phép ghi đè chế độ thủ công (auto-detect có thể sai), có cảnh báo khi đã có layer.
3. Giữ full parity workflow edit: Rect Select → Canvas Edit → Generate → Variants → Visibility Mask → Import → Export.
4. Ẩn/khóa mọi tính năng 360 trong chế độ flat: tab 360 View, View Controls (yaw/pitch/roll/fov), horizon, perspective/reproject.
5. Project file lưu chế độ (bump v4 → v5), tương thích ngược project v2–v4 (mặc định 360).
6. Không thay đổi hành vi chế độ 360 hiện tại.

## Out of Scope

- Auto-detect bằng XMP GPano metadata (chỉ dùng tỉ lệ ảnh + ghi đè thủ công).
- Batch edit nhiều ảnh / multi-image project.
- Thay đổi "Flat View" của ảnh 360 (giữ nguyên).
- Workflow/store riêng cho ảnh thường (dùng chung, gate bằng mode).

---

## Design

### 1. Data Model

#### `shared/types.ts`

```typescript
export type ImageMode = '360' | 'flat';

export interface ProjectFile {
  version: 5;
  mode: ImageMode;
  imagePath: string;
  layers: Layer[];
  horizon: Horizon;
}
```

`ExportRequest` và `Layer` không đổi. Layer tạo trong chế độ flat luôn `type: 'flat'` (đúng như nhánh flat hiện có).

#### Detection (pure helper, export để test)

```typescript
export function detectImageMode(width: number, height: number): ImageMode {
  if (!width || !height) return 'flat';
  const ratio = width / height;
  return ratio >= 1.9 && ratio <= 2.1 ? '360' : 'flat';
}
```

Dung sai ±5% quanh tỉ lệ 2:1. Ảnh 2:1 không phải panorama sẽ bị nhận nhầm → user ghi đè bằng tay.

### 2. Store Changes (`client/stores/project.ts`)

#### State

```typescript
imageMode: ImageMode;   // default '360'
```

#### Actions

| Action | Mô tả |
|--------|-------|
| `openImage(path, width, height)` | Set `imageMode = detectImageMode(width, height)` (giữ nguyên các reset hiện có) |
| `setImageMode(mode)` | Ghi đè thủ công. UI chịu trách nhiệm confirm khi đã có layer |
| `reset()` | Trả `imageMode` về `'360'` |

#### Gating

- `createPerspectiveLayer` không đổi: trong flat mode đường vào duy nhất là `enterRectSelect('flat')` nên layer luôn `type: 'flat'`.
- `updateViewPose`/`horizon` không đổi; flat mode không có UI nào gọi chúng (View Controls bị ẩn), horizon giữ 0.

### 3. UI Changes

#### 3a. Top bar (`client/App.tsx`)

- **Flat mode:** ẩn 2 tab `🌐 360 View` / `📐 Flat View`; hiển thị nhãn `🖼 Ảnh thường`. Workspace luôn render `FlatView` (trừ khi `workflow === 'empty'` → DropZone, hoặc workflow canvas → `CanvasEditor`).
- **360 mode:** giữ nguyên tabs + hành vi hiện tại.
- **Mode switch chip:** hiển thị chế độ hiện tại (`360°` hoặc `Ảnh thường`), click để đổi:
  - Không có layer → đổi ngay.
  - Có layer → `confirm()` cảnh báo "Đổi chế độ có thể làm các layer hiện tại hiển thị sai. Tiếp tục?" (đồng bộ với cách app đang dùng `confirm()` cho xóa layer/variant).
- **Status bar:** hiển thị thêm mode hiện tại.

#### 3b. Toolbar (`client/components/Toolbar.tsx`)

- Ẩn section `View Controls` (Yaw/Pitch/Roll/FOV) khi `imageMode === 'flat'`.
- Tools (Rect Select) và Project section giữ nguyên.

#### 3c. FlatView (`client/views/FlatView.tsx`)

- Không đổi code — đã hỗ trợ zoom/pan → 🔒 Edit Here → `enterRectSelect('flat')`.
- Đây là view chính của ảnh thường; nhãn tab/view hiển thị "Ảnh thường" ở top bar để phân biệt với Flat View của 360.

#### 3d. Các component giữ nguyên

CanvasEditor, VariantGallery, Visibility mask, LayerPanel, PromptBar, ModelSelector, ExportDialog, Import/Transform — hoạt động như hiện tại trên layer `type: 'flat'`.

### 4. Export

- Không cần thay đổi server: `exportImage()` hiện đã bỏ qua horizon (tham số `_horizon` deprecated, không dùng). Ở flat mode horizon luôn = 0 vì View Controls bị ẩn, nên composite layers như hiện tại là đủ.
- `ExportDialog` giữ nguyên.

### 5. Project Save/Load — v5

#### Client

- `App.saveProject()`: ghi `version: 5`, `mode: state.imageMode`.
- `App.loadProject()`: sau `uploadZip`, gọi `openImage(...)` (auto-detect) rồi set `imageMode: project.mode ?? detected` — **mode lưu trong project thắng** auto-detect. Sau đó set layers/horizon như hiện tại.

#### Server (`server/routes/project.ts`)

- Thêm `migrateProjectToV5(project)`: set `version = 5`; nếu `!project.mode` → `'360'`.
- `migrateProjectToV4` giữ nguyên; sau khi migrate v4 thì gọi tiếp v5.
- `download`: ghi `project.json` với `version: 5` (mode lấy từ client).
- `upload-zip`: chấp nhận `version` 2..5; `version < 5` → migrate lên v5.
- v2 JSON fallback: migrate v2 → v4 → v5.

### 6. Edge Cases

| Case | Hành vi |
|------|---------|
| Ảnh 2:1 không phải pano | Auto nhận 360; user đổi sang flat bằng chip. Nếu đã edit layer ở chế độ 360 rồi đổi flat → cảnh báo |
| Ảnh pano crop (VD 1.8:1) | Auto nhận flat; user đổi sang 360 bằng chip. PSV vẫn hiển thị được, có thể méo — chấp nhận vì là ghi đè thủ công |
| Project v4 cũ | Load → migrate v5, mode = '360', hành vi cũ nguyên vẹn |
| Project v5 flat + horizon khác 0 (dữ liệu lạ) | Export flat bỏ qua horizon |
| Ảnh không có width/height | `detectImageMode` → 'flat' (an toàn, không mount PSV) |
| Đổi mode khi đang edit (canvas-edit) | Không cho đổi — chip disabled khi `workflow !== 'viewing'` |

### 7. Testing

- **Unit tests:**
  - `detectImageMode`: 2.0 → 360; 1.5 → flat; biên 1.9 / 2.1; 0 hoặc thiếu dimension → flat.
  - Store: `openImage` set mode đúng; `setImageMode` override; `reset` về '360'.
  - Server: migrate v4 → v5 → mode '360'; migrate v2 → v5.
- **Regression:** `npm test` toàn bộ pass; kiểm tra flow 360 không đổi.
- **Manual:** mở ảnh thường → edit 1 vùng AI → tạo variant → export → save/load project → mode được giữ.

---

## Phân rã công việc (dự kiến)

| # | Task | Ước lượng |
|---|------|-----------|
| 1 | Types: `ImageMode` + `detectImageMode` helper + unit tests | 45 min |
| 2 | Store `imageMode`/`setImageMode`, `openImage`, `reset` + unit tests | 45 min |
| 3 | Project v5: `ProjectFile` type, App save/load mode, server migration + tests | 1.5 hr |
| 4 | Top-bar: mode chip + ẩn tab 360 + workspace gating + cảnh báo đổi mode | 1 hr |
| 5 | Ẩn View Controls khi flat mode | 15 min |
| 6 | Regression `npm test` + manual verification | 45 min |

**Tổng ước lượng:** ~5 hr
