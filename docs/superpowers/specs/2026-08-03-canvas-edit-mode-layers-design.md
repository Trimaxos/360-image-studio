# Canvas Edit Mode — Layer Variants & Visibility Mask

**Date:** 2026-08-03
**Status:** Draft → Chờ PM duyệt

## Overview

Cải thiện canvas edit mode để hỗ trợ nhiều kết quả AI/import trong mỗi layer, cơ chế apply riêng biệt, visibility mask, và hỗ trợ transparency. Đồng thời fix bug render final chỉ áp dụng layer cuối cùng.

## Problem Statement

### Bug
Khi tạo >1 canvas editor (nhiều layer), export final chỉ composite 1 layer cuối cùng. Các layer cũ không được áp dụng.

### Hạn chế hiện tại
1. Mỗi layer chỉ có 1 `resultImageId` — không hỗ trợ nhiều variants
2. Kết quả AI **ghi đè trực tiếp** lên canvas gốc → mất canvas gốc
3. Khi nhiều layer chồng lấn, vùng tiếp xúc lộ lỗi không mong muốn
4. Không hỗ trợ transparency cho layer AI/import
5. Không có cơ chế apply/deapply và xóa variant riêng biệt
6. Không có visibility mask để chọn vùng hiển thị cho kết quả

## Goals

1. **Fix bug**: Render final composite tất cả layer committed + visible, không chỉ layer cuối
2. **Canvas gốc immutable**: Không bao giờ bị ghi đè bởi kết quả AI/import
3. **Variants**: Mỗi layer có danh sách variants (AI gen + import), chọn 1 variant để apply
4. **Visibility mask**: Công cụ brush riêng để chọn vùng hiển thị cho variant đã apply
5. **Transparency**: Hỗ trợ ảnh PNG RGBA (import) và mask-based transparency (AI gen)
6. **Đơn giản hóa mask AI**: Bỏ "Apply mask (limit display)", chỉ giữ "Use mask for AI"

---

## Design

### 1. Data Model

#### LayerVariant (mới)
```typescript
interface LayerVariant {
  id: string;                    // UUID
  resultImageId: string;         // filename in cache dir (không có .png extension)
  source: 'ai-generated' | 'imported';
  modelId?: string;              // model AI đã dùng (nếu ai-generated)
  applied: boolean;              // true = variant này đang được apply
                                 // Chỉ 1 variant/layer có applied=true
  visibilityMask?: {
    base64Mask: string;          // base64 PNG mask (white=visible, black=hidden)
    brushSize: number;           // px
    brushSoftness: number;       // 0-100%
  };
  /** Kích thước thực tế của ảnh kết quả (pixel) */
  width: number;
  height: number;
  createdAt: number;             // Date.now()
}
```

#### Layer (mở rộng)
```typescript
interface Layer {
  // --- Existing fields (giữ nguyên) ---
  id: string;
  order: number;
  type: 'flat' | 'perspective';
  visible: boolean;
  yaw: number; pitch: number; roll: number; fov: number;
  tileCoords: { x: number; y: number; w: number; h: number };
  maskData: MaskShape[];
  maskEnabled?: boolean;         // → SẼ BỎ
  maskForAi?: boolean;           // → GIỮ, mặc định true
  prompt: string;
  resultImageId: string;         // DEPRECATED — giữ để backward compat
  equirectImageId?: string;
  status?: 'draft' | 'committed';
  name?: string;
  selection?: SelectionDraft;

  // --- New fields ---
  variants: LayerVariant[];      // Danh sách kết quả AI/import
}
```

#### Deprecation path
- `resultImageId` ở root Layer được giữ lại để backward compat khi load project cũ
- Khi mở project cũ: nếu `variants` rỗng nhưng `resultImageId` có giá trị → tự động tạo 1 variant mặc định
- `maskEnabled` bị bỏ — logic hiển thị giờ phụ thuộc vào `visibilityMask` của variant
- `maskForAi` giữ nguyên

### 2. Store Changes

#### State additions
```typescript
interface ProjectState {
  // ... existing state
  variants: LayerVariant[];       // không cần — variants nằm trong Layer[]
  activeVariantId: string | null; // variant đang được chọn trong canvas editor
}
```

#### New/Modified actions

| Action | Mô tả |
|--------|-------|
| `addVariant(layerId, variant)` | Thêm variant mới vào layer |
| `toggleVariant(layerId, variantId)` | Toggle select/deselect variant. Nếu select → applied=true, các variant khác trong cùng layer → applied=false. Nếu deselect → applied=false |
| `removeVariant(layerId, variantId)` | Xóa variant khỏi layer. Nếu variant đang applied → layer trở về trạng thái không có variant applied |
| `updateVariantMask(layerId, variantId, mask)` | Cập nhật visibility mask cho variant |
| `setMaskForAi(layerId, value)` | Giữ nguyên, chỉ đổi tên nếu cần |

### 3. UI Changes

#### 3a. Canvas Editor — Variant Gallery

Mỗi variant hiển thị dạng card:

```
┌───────────────────────────────────┐
│ ┌───────────────────────────────┐ │
│ │ ✓ ĐÃ CHỌN                      │ │  ← badge xanh, chỉ hiện khi applied=true
│ │                               │ │
│ │    [Thumbnail kết quả]        │ │
│ │                               │ │
│ └───────────────────────────────┘ │
│ AI: FLUX Fill · 1024×1024        │  ← source + kích thước
│ [🖌 Edit Mask]     [🗑 Delete]    │  ← Edit Mask chỉ hiện khi applied=true
└───────────────────────────────────┘
```

**Tương tác:**
- **Click thumbnail** → toggle select/deselect
- **Click variant khác** → deselect variant cũ, select variant mới
- **Chỉ 1 variant được selected / layer**
- Nút Edit Mask → mở visibility mask mode
- Nút Delete → confirm → xóa variant. Nếu variant đang selected → layer trở về trạng thái không có variant selected

#### 3b. Visibility Mask Mode

Khi user nhấn [🖌 Edit Mask] trên variant đang selected:

- Canvas editor hiển thị overlay của variant lên tile gốc (có transparency)
- Toolbar mask mới xuất hiện:

```
┌─────────────────────────────────────────────────────┐
│ Mode: [Add Region] [Remove Region]                  │
│ Size: [  24  ] [-] [+]   Softness: [======----] 70% │
│ [Done]                                              │
└─────────────────────────────────────────────────────┘
```

**Mode Add Region:**
- Mặc định: variant **ẩn hoàn toàn** (mask đen)
- Brush tô đến đâu → vùng đó **hiện ra** (mask trắng)

**Mode Remove Region:**
- Mặc định: variant **hiện hoàn toàn** (mask trắng)
- Brush tô đến đâu → vùng đó **ẩn đi** (mask đen)

**Controls:**
- Size: input number cho phép nhập trực tiếp + 2 nút tăng/giảm (±), range 1–500px
- Softness: slider 0–100%, kiểm soát feather radius của brush
- Done: lưu mask vào `variant.visibilityMask`, quay lại variant gallery

**Mask persistence:**
- Mask được lưu vào `variant.visibilityMask.base64Mask`
- Không mất khi chuyển variant hoặc leave canvas
- Có thể edit lại bất cứ lúc nào — mask cũ được load lại làm base

#### 3c. Đơn giản hóa Mask AI Panel

Trong panel mask hiện tại (dưới LayerPanel khi `canvas-edit`):

- **BỎ**: toggle "Apply mask (limit display)" (`maskEnabled`)
- **GIỮ**: toggle "Use mask for AI" (`maskForAi`)
- Các tool brush/lasso/eraser giữ nguyên, chỉ phục vụ mask AI

### 4. Bug Fix: Render Final

#### Vấn đề
`exportableLayers()` filter `status === 'committed' && visible !== false`, nhưng export chỉ áp dụng layer cuối.

#### Root cause (dự kiến)
Có thể do một trong các nguyên nhân:
- Các layer cũ bị mất `status: 'committed'` khi tạo layer mới
- `order` bị trùng hoặc sai
- Cache file bị xóa hoặc không tìm thấy

#### Fix
- Debug và log các layer gửi lên server khi export
- Đảm bảo `leaveCanvas('save')` set `status: 'committed'` và không ảnh hưởng đến các layer khác
- Đảm bảo cache file không bị xóa cho đến khi project/reset

### 5. Composite Logic

#### Preview (Viewer360 / FlatView)

Base = ảnh gốc panorama (không bao giờ ghi đè).

Với mỗi layer có `status: 'committed'` và `visible !== false`, theo `order` tăng dần:

1. Tìm variant có `applied: true`
2. Nếu **không có** → skip layer này (không composite gì)
3. Nếu **có**:
   a. Load ảnh từ cache: `{variant.resultImageId}.png`
   b. Nếu `variant.visibilityMask` có → áp dụng mask + feather (xem §6)
   c. Nếu ảnh có sẵn alpha channel (PNG import) → giữ alpha, combine với visibility mask nếu có
   d. Composite lên pipeline tại vị trí `tileCoords.{x,y}`, `blend: 'over'`

#### Render Final (exportImage)

Logic y hệt preview nhưng ở full resolution, dùng `sharp`.

### 6. Mask Feather Implementation

Dùng `sharp.blur()` trên mask để tạo feather:

```
visibilityMask.base64Mask (RGBA PNG)
  → sharp.blur(sigma)              // sigma tính từ brushSoftness
  → extract channel (alpha/luma)   // tạo grayscale mask
  → dest-in với ảnh kết quả        // crop vùng visible
  → composite 'over' lên pipeline
```

**Công thức sigma từ softness:**
```
sigma = (softness / 100) * maxSize
```
Trong đó `maxSize = max(width, height)` của variant, softness trong [0, 100].

**Tối ưu:** Feather mask được tính 1 lần khi user nhấn "Done" trong visibility mask mode, lưu kết quả vào cache riêng. Khi export chỉ cần đọc cache, không tính lại.

### 7. Project Save/Load

#### ProjectFile (version bump: 3 → 4)
```typescript
export interface ProjectFile {
  version: 4;
  imagePath: string;
  layers: Layer[];     // Layer đã có variants[]
  horizon: Horizon;
}
```

#### Migration logic (khi load version 3)
```typescript
function migrateV3ToV4(project: ProjectFileV3): ProjectFile {
  return {
    ...project,
    version: 4,
    layers: project.layers.map(layer => ({
      ...layer,
      variants: layer.resultImageId ? [{
        id: crypto.randomUUID(),
        resultImageId: layer.resultImageId,
        source: 'ai-generated' as const,
        applied: layer.status === 'committed',
        width: layer.tileCoords.w,
        height: layer.tileCoords.h,
        createdAt: Date.now(),
      }] : [],
    })),
  };
}
```

### 8. API Changes

#### Backward compat với tile cache
Server không cần thay đổi nhiều — các variant vẫn dùng chung cache dir. `resultImageId` đã là filename trong cache nên endpoint `api.image.cacheUrl(id)` vẫn hoạt động.

#### New endpoint: `POST /api/cache/variant-mask`
- Save visibility mask vào cache (để tránh tính lại feather khi export)
- Input: `{ variantId: string, base64Mask: string, softness: number, width: number, height: number }`
- Output: `{ featheredMaskId: string }`

---

## Out of Scope

- Multi-variant apply (luôn chỉ 1 variant applied/layer)
- Brush size presets
- Undo/redo trong visibility mask mode (undo từng stroke)
- Animation/transition khi switch variant
- Layer opacity/blend mode (ngoài transparency từ ảnh)

---

## Phân rã công việc (dự kiến)

| # | Task | Ước lượng |
|---|------|-----------|
| 1 | Debug & fix bug render final chỉ áp dụng layer cuối | 30 min |
| 2 | Cập nhật `Layer` type, thêm `LayerVariant`, bump project version | 30 min |
| 3 | Cập nhật `ProjectState` store — thêm actions cho variant | 1 hr |
| 4 | Variant Gallery UI trong CanvasEditor | 2 hr |
| 5 | Visibility Mask Mode (toolbar + brush + mask rendering) | 3 hr |
| 6 | Mask feather implementation (blur trên mask) | 1.5 hr |
| 7 | Đơn giản hóa mask AI panel (bỏ maskEnabled) | 30 min |
| 8 | Cập nhật composite logic trong preview | 1 hr |
| 9 | Cập nhật exportImage logic (render final) | 1 hr |
| 10 | Project save/load + migration v3→v4 | 1 hr |
| 11 | Backward compat & edge cases (project cũ, cache missing) | 1 hr |
| 12 | Integration test | 1 hr |

**Tổng ước lượng:** ~13.5 hr
