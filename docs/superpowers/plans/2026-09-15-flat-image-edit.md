# Flat Image Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép mở và chỉnh sửa ảnh thông thường (không phải ảnh 360) bằng nguyên workflow tile-based hiện có, tự động phát hiện chế độ theo tỉ lệ ảnh và cho phép ghi đè thủ công.

**Architecture:** Thêm `imageMode: '360' | 'flat'` vào Zustand store (auto-detect khi mở ảnh), gate toàn bộ UI/logic 360 theo mode, lưu mode vào `ProjectFile` v5 với migration v4→v5 ở server. Nhánh xử lý `sourceView: 'flat'` đã có sẵn trong Rect Select/CanvasEditor nên không cần đụng vào pipeline edit.

**Tech Stack:** React + TypeScript + Vite, Zustand, Express, Sharp, `tsx --test` (node:test)

## Global Constraints

- `ProjectFile` version = **5**; project cũ v2–v4 load lên mặc định `mode: '360'`.
- Detection: tỉ lệ `width/height` trong khoảng **1.9–2.1** (bao gồm biên) → `'360'`, còn lại → `'flat'`; width/height không hợp lệ → `'flat'`.
- Mode switch chip bị `disabled` khi `workflow !== 'viewing'`; nếu `layers.length > 0` phải `confirm()` trước khi đổi.
- UI copy tiếng Việt (theo app hiện tại); code + comment tiếng Anh.
- Không thêm dependency mới.
- Không thay đổi hành vi chế độ 360 hiện tại.
- Mỗi task kết thúc với `npx tsc --noEmit` sạch và `npm test` pass.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `shared/types.ts` | Modify | Thêm `ImageMode`, `ProjectFile` v5 + `mode` |
| `client/lib/image-mode.ts` | Create | `detectImageMode(width, height)` |
| `client/lib/image-mode.test.ts` | Create | Unit tests detection |
| `client/stores/project.ts` | Modify | State `imageMode`, action `setImageMode`, `openImage`, `reset` |
| `client/stores/project.test.ts` | Modify | Store tests cho mode |
| `server/routes/project.ts` | Modify | `migrateProjectToV5`, chấp nhận version ≤ 5, ghi project v5 |
| `server/routes/project.test.ts` | Create | Migration tests |
| `client/App.tsx` | Modify | Save/load v5 + top-bar mode chip + ẩn tab 360 + workspace gating |
| `client/components/Toolbar.tsx` | Modify | Ẩn View Controls khi flat mode |

---

### Task 1: `ImageMode` type + `detectImageMode` helper

**Files:**
- Modify: `shared/types.ts`
- Create: `client/lib/image-mode.ts`
- Test: `client/lib/image-mode.test.ts`

**Interfaces:**
- Produces: `ImageMode = '360' | 'flat'` (shared/types.ts) và `detectImageMode(width: number, height: number): ImageMode` (client/lib/image-mode.ts)

- [ ] **Step 1: Thêm `ImageMode` vào `shared/types.ts`**

Thêm ngay trước section `// ===== Layer =====`:

```typescript
// ===== Image Mode =====

/** 360 = equirectangular panorama; flat = regular photo. */
export type ImageMode = '360' | 'flat';
```

- [ ] **Step 2: Viết failing test**

Tạo `client/lib/image-mode.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageMode } from './image-mode';

test('2:1 images are treated as 360 panoramas', () => {
  assert.equal(detectImageMode(4000, 2000), '360');
  assert.equal(detectImageMode(8192, 4096), '360');
});

test('mode detection tolerates 5% around the 2:1 ratio', () => {
  assert.equal(detectImageMode(1900, 1000), '360');
  assert.equal(detectImageMode(2100, 1000), '360');
  assert.equal(detectImageMode(1899, 1000), 'flat');
  assert.equal(detectImageMode(2101, 1000), 'flat');
});

test('non-panorama aspect ratios are treated as flat images', () => {
  assert.equal(detectImageMode(1920, 1080), 'flat');
  assert.equal(detectImageMode(1000, 1000), 'flat');
  assert.equal(detectImageMode(1080, 1920), 'flat');
});

test('missing dimensions default to flat instead of mounting the 360 viewer', () => {
  assert.equal(detectImageMode(0, 0), 'flat');
});
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `npx tsx --test client/lib/image-mode.test.ts`
Expected: FAIL — `Cannot find module './image-mode'`

- [ ] **Step 4: Viết implementation tối thiểu**

Tạo `client/lib/image-mode.ts`:

```typescript
import type { ImageMode } from '../../shared/types';

/** 360 panoramas are equirectangular (2:1). Allow ±5% for slightly cropped exports. */
export function detectImageMode(width: number, height: number): ImageMode {
  if (!width || !height) return 'flat';
  const ratio = width / height;
  return ratio >= 1.9 && ratio <= 2.1 ? '360' : 'flat';
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npx tsx --test client/lib/image-mode.test.ts`
Expected: PASS — 4 tests, 0 failures

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts client/lib/image-mode.ts client/lib/image-mode.test.ts
git commit -m "feat: add ImageMode type and detection helper"
```

---

### Task 2: Store `imageMode` + `setImageMode`

**Files:**
- Modify: `client/stores/project.ts`
- Test: `client/stores/project.test.ts`

**Interfaces:**
- Consumes: `detectImageMode(width, height): ImageMode`, `ImageMode` (Task 1)
- Produces: state `imageMode: ImageMode` (default `'360'`); action `setImageMode(mode: ImageMode): void`; `openImage()` tự set mode theo detection; `reset()` trả về `'360'`

- [ ] **Step 1: Viết failing test**

Thêm vào cuối `client/stores/project.test.ts`:

```typescript
test('opening a 2:1 image selects 360 mode', () => {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/pano.jpg', 4000, 2000);
  assert.equal(useProjectStore.getState().imageMode, '360');
});

test('opening a regular photo selects flat mode', () => {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/photo.jpg', 1920, 1080);
  assert.equal(useProjectStore.getState().imageMode, 'flat');
});

test('setImageMode overrides the detected mode and marks unsaved changes', () => {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/photo.jpg', 1920, 1080);
  useProjectStore.getState().markProjectSaved();
  useProjectStore.getState().setImageMode('360');
  assert.equal(useProjectStore.getState().imageMode, '360');
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
});

test('reset returns to the default 360 mode', () => {
  useProjectStore.setState({ imageMode: 'flat' });
  useProjectStore.getState().reset();
  assert.equal(useProjectStore.getState().imageMode, '360');
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test client/stores/project.test.ts`
Expected: FAIL — `imageMode` là `undefined` / `setImageMode is not a function`

- [ ] **Step 3: Implement store changes**

Trong `client/stores/project.ts`:

1. Thêm `ImageMode` vào type import từ `../../shared/types` (giữ thứ tự alphabet): `AiModelOption, GeneratedVariant, Horizon, ImageMode, Layer, LayerVariant, SelectionDraft, ViewPose`.
2. Thêm import helper sau import `WorkflowState`:

```typescript
import { detectImageMode } from '../lib/image-mode';
```

3. Thêm field vào interface `ProjectState` ngay sau `imageHeight: number;`:

```typescript
  imageMode: ImageMode;
```

4. Thêm action vào interface ngay sau `setViewMode(mode: ViewMode): void;`:

```typescript
  setImageMode(mode: ImageMode): void;
```

5. Thêm default state ngay sau `imageHeight: 0,` trong khởi tạo store:

```typescript
  imageMode: '360',
```

6. Trong `openImage`, thêm field ngay sau `imageHeight,`:

```typescript
    imageMode: detectImageMode(imageWidth, imageHeight),
```

7. Thêm action ngay sau dòng `setViewMode: (viewMode) => set({ viewMode }),`:

```typescript
  setImageMode: (imageMode) => set({ imageMode, hasUnsavedChanges: true }),
```

8. Trong `reset()`, thêm field ngay sau `imageHeight: 0,`:

```typescript
    imageMode: '360',
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npx tsx --test client/stores/project.test.ts`
Expected: PASS — toàn bộ file, gồm 4 test mới

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add client/stores/project.ts client/stores/project.test.ts
git commit -m "feat: add imageMode state to project store"
```

---

### Task 3: Project v5 — `ProjectFile.mode`, save/load client, migration server

**Files:**
- Modify: `shared/types.ts`
- Modify: `client/App.tsx:64-69,90-94`
- Modify: `server/routes/project.ts`
- Test: `server/routes/project.test.ts` (create)

**Interfaces:**
- Consumes: `ImageMode`, store `imageMode` (Task 2)
- Produces: `ProjectFile { version: 5; mode: ImageMode; imagePath; layers; horizon }`; `migrateProjectToV5(project: { version: number; mode?: ImageMode; layers: any[] }): void` export từ `server/routes/project.ts`

- [ ] **Step 1: Viết failing test**

Tạo `server/routes/project.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProjectToV4, migrateProjectToV5 } from './project';

test('migrating a v4 project to v5 records 360 mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
});

test('migrating preserves an explicit flat mode', () => {
  const project: { version: number; mode?: '360' | 'flat'; layers: any[] } = {
    version: 4,
    mode: 'flat',
    layers: [],
  };
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, 'flat');
});

test('a v2 project migrates to v5 through v4 with variants and 360 mode', () => {
  const project: any = {
    version: 2,
    layers: [{
      id: 'layer-1',
      resultImageId: 'legacy-result',
      status: 'committed',
      tileCoords: { x: 0, y: 0, w: 100, h: 100 },
    }],
  };
  migrateProjectToV4(project);
  migrateProjectToV5(project);
  assert.equal(project.version, 5);
  assert.equal(project.mode, '360');
  assert.equal(project.layers[0].variants.length, 1);
  assert.equal(project.layers[0].variants[0].resultImageId, 'legacy-result');
  assert.equal(project.layers[0].variants[0].applied, true);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx tsx --test server/routes/project.test.ts`
Expected: FAIL — `migrateProjectToV5 is not a function`

- [ ] **Step 3: Bump `ProjectFile` lên v5**

Trong `shared/types.ts`, sửa `ProjectFile`:

```typescript
export interface ProjectFile {
  version: 5;
  mode: ImageMode;
  imagePath: string;
  layers: Layer[];
  horizon: Horizon;
}
```

- [ ] **Step 4: Thêm migration server**

Trong `server/routes/project.ts`:

1. Sửa import type:

```typescript
import type { ImageMode, ProjectFile } from '../../shared/types';
```

2. Thêm function ngay sau `migrateProjectToV4`:

```typescript
/**
 * Migrate a legacy project (v4) to v5: projects now record their image mode.
 * Anything saved before v5 is a 360 panorama project.
 */
export function migrateProjectToV5(project: { version: number; mode?: ImageMode; layers: any[] }): void {
  project.version = 5;
  if (!project.mode) project.mode = '360';
}
```

3. Trong nhánh v2 JSON fallback, thêm `migrateProjectToV5(project);` ngay sau `migrateProjectToV4(project);`.

4. Trong `download`, sửa `version: 4` thành `version: 5` trong object `projectJson`.

5. Trong nhánh ZIP, sửa điều kiện version:

```typescript
    if (project.version < 2 || project.version > 5) {
```

6. Trong nhánh ZIP, thêm migration v5 ngay sau block `if (project.version < 4) { migrateProjectToV4(project); }`:

```typescript
    // Migrate v4 → v5: legacy projects have no mode and are 360 panoramas.
    if (project.version < 5) {
      migrateProjectToV5(project);
    }
```

- [ ] **Step 5: Chạy test server để xác nhận pass**

Run: `npx tsx --test server/routes/project.test.ts`
Expected: PASS — 3 tests, 0 failures

- [ ] **Step 6: Cập nhật App save/load**

Trong `client/App.tsx`, sửa `saveProject`:

```typescript
    const project: ProjectFile = {
      version: 5,
      mode: current.imageMode,
      imagePath: current.imagePath,
      layers: current.layers,
      horizon: current.horizon,
    };
```

Sửa `loadProject` (mode lưu trong project thắng auto-detect của `openImage`):

```typescript
      useProjectStore.setState({
        imageMode: project.mode ?? useProjectStore.getState().imageMode,
        layers: project.layers ?? [],
        horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 },
        hasUnsavedChanges: false,
      });
```

- [ ] **Step 7: Typecheck + full test**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm test`
Expected: toàn bộ test pass

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts server/routes/project.ts server/routes/project.test.ts client/App.tsx
git commit -m "feat: persist image mode in project file v5"
```

---

### Task 4: Top-bar mode UI + workspace gating

**Files:**
- Modify: `client/App.tsx`

**Interfaces:**
- Consumes: store `imageMode`, `setImageMode`, `workflow`, `layers` (Task 2)
- Produces: UI — chip `⇄ Chế độ: …`, ẩn tab 360 khi flat, workspace render `FlatView` khi flat, status bar hiển thị mode

- [ ] **Step 1: Thêm derived flag + handler**

Trong `client/App.tsx`, ngay sau dòng `const canvasWorkflow = ['canvas-edit', 'generating', 'ai-review'].includes(state.workflow);`:

```tsx
  const isFlatImage = state.imageMode === 'flat';
  const switchImageMode = () => {
    const current = useProjectStore.getState();
    const next = current.imageMode === '360' ? 'flat' : '360';
    const label = next === 'flat' ? 'Ảnh thường' : '360°';
    if (current.layers.length > 0 && !confirm(`Đổi sang chế độ ${label}? Các layer hiện có có thể hiển thị sai.`)) return;
    current.setImageMode(next);
  };
```

- [ ] **Step 2: Thay block tab trong top bar**

Thay toàn bộ `<nav className="top-bar-tabs">…</nav>` hiện tại bằng:

```tsx
        <nav className="top-bar-tabs">
          {isFlatImage ? (
            <button className="top-bar-tab active" disabled>🖼 Ảnh thường</button>
          ) : (
            <>
              <button className={`top-bar-tab ${activeTab === '360' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('360')}>🌐 360 View</button>
              <button className={`top-bar-tab ${activeTab === 'flat' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('flat')}>📐 Flat View</button>
            </>
          )}
          <button
            className="top-bar-tab"
            disabled={state.workflow !== 'viewing'}
            title="Chuyển đổi chế độ ảnh 360 / ảnh thường"
            onClick={switchImageMode}
          >
            ⇄ Chế độ: {isFlatImage ? 'Ảnh thường' : '360°'}
          </button>
        </nav>
```

- [ ] **Step 3: Gate workspace render**

Thay block trong `<section className="editor-area">` bằng:

```tsx
            {state.workflow === 'empty'
              ? <ImageDropZone onOpenFile={openFile} />
              : canvasWorkflow
                ? <CanvasEditor />
                : isFlatImage ? <FlatView /> : activeTab === '360' ? <Viewer360 /> : <FlatView />}
```

- [ ] **Step 4: Hiển thị mode ở status bar**

Sửa `<span>{state.workflow}</span>` trong footer thành:

```tsx
        <span>{isFlatImage ? '🖼 Ảnh thường' : '🌐 360°'} · {state.workflow}</span>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm test`
Expected: toàn bộ test pass

- [ ] **Step 6: Commit**

```bash
git add client/App.tsx
git commit -m "feat: add flat image mode UI to top bar"
```

---

### Task 5: Ẩn View Controls khi flat mode

**Files:**
- Modify: `client/components/Toolbar.tsx:41-75`

**Interfaces:**
- Consumes: store `imageMode` (Task 2)
- Produces: section View Controls chỉ render khi `imageMode === '360'`

- [ ] **Step 1: Wrap View Controls section**

Trong `client/components/Toolbar.tsx`, bọc toàn bộ `<section className="sidebar-section">` chứa View Controls:

```tsx
      {state.imageMode === '360' && (
        <section className="sidebar-section">
          <div className="sidebar-section-title">View Controls</div>
          {controls.map((control) => (
            <label className="sidebar-view-row" key={control.key}>
              <span>{control.label}</span>
              <input
                className="sidebar-view-number"
                aria-label={`${control.label} value`}
                type="number"
                min={control.min}
                max={control.max}
                step={0.1}
                value={state.viewPose[control.key].toFixed(1)}
                disabled={!permission.viewControls}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  state.updateViewPose({
                    [control.key]: Math.min(control.max, Math.max(control.min, value)),
                  });
                }}
              />
              <input
                aria-label={`${control.label} slider`}
                type="range"
                min={control.min}
                max={control.max}
                step={0.1}
                value={state.viewPose[control.key]}
                disabled={!permission.viewControls}
                onChange={(event) => state.updateViewPose({ [control.key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </section>
      )}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm test`
Expected: toàn bộ test pass

- [ ] **Step 3: Commit**

```bash
git add client/components/Toolbar.tsx
git commit -m "feat: hide view controls for flat image editing"
```

---

### Task 6: Regression + manual verification

**Files:** không sửa code (chỉ sửa nếu phát hiện bug)

- [ ] **Step 1: Chạy full test suite**

Run: `npm test`
Expected: toàn bộ test pass, bao gồm `Viewer360.regression.test.mjs`

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npm run build`
Expected: Vite build thành công

- [ ] **Step 3: Manual — ảnh thường**

Chạy `npm run server` (terminal 1) và `npm run dev` (terminal 2), mở `http://localhost:5173`:

1. Open Image → chọn ảnh 1920×1080.
2. Kiểm tra: không còn tab `🌐 360 View` / `📐 Flat View`; chip hiển thị `⇄ Chế độ: Ảnh thường`; Toolbar không có View Controls; status bar ghi `🖼 Ảnh thường`.
3. 🔒 Edit Here → kéo rect → Apply → Canvas Editor mở đúng vùng.
4. Generate với 1 model → variant xuất hiện trong gallery → Apply → Back (Save).
5. Layer xuất hiện trong LayerPanel với thumbnail `2D`.
6. Export Final → file tải về/xuất đúng, không lỗi.
7. Save Project → New → Load Project → chip vẫn `Ảnh thường`, layer còn nguyên.

- [ ] **Step 4: Manual — ảnh 360 (regression)**

1. Open Image → chọn ảnh 4000×2000.
2. Kiểm tra: tabs `🌐 360 View` / `📐 Flat View` hiển thị như cũ; View Controls hiển thị; chip `⇄ Chế độ: 360°`.
3. Xoay PSV, Edit Here → rect select → Canvas Edit → Generate → Apply → Back → Export như cũ.

- [ ] **Step 5: Manual — ghi đè mode**

1. Với ảnh thường đang mở, có ít nhất 1 layer: bấm chip → confirm cảnh báo → mode chuyển sang `360°`, tab 360 xuất hiện.
2. Bấm chip lần nữa → quay lại `Ảnh thường`.
3. Không có layer: bấm chip → đổi ngay, không có confirm.

- [ ] **Step 6: Nếu phát hiện bug**

Fix và commit:

```bash
git add <files>
git commit -m "fix: <mô tả ngắn>"
```
