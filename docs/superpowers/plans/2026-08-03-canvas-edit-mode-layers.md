# Canvas Edit Mode — Layer Variants & Visibility Mask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign canvas edit mode so each layer can hold multiple AI/import variants with click-to-toggle selection, per-variant visibility masks with brush tools, and fix the export final bug where only the last layer is composited.

**Architecture:** Add `LayerVariant[]` to the `Layer` interface, migrate `ProjectFile` from v3→v4, replace the old `generatedVariants`/`selectedVariantId` system with per-layer variant management in the Zustand store, rewrite `exportImage()` to composite applied variants instead of reading `layer.resultImageId` directly, and build a new VariantGallery UI with visibility mask brush tools.

**Tech Stack:** React + TypeScript + Vite, Fabric.js, Sharp + libvips, Zustand

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `shared/types.ts` | Modify | Add `LayerVariant`, extend `Layer` with `variants[]`, bump `ProjectFile` to v4 |
| `client/stores/project.ts` | Modify | Add variant actions, update `leaveCanvas`, `createPerspectiveLayer`, `openLayerEditor` |
| `server/services/image-processor.ts` | Modify | Rewrite `exportImage` to use variants, update `exportableLayers`, add `applyVisibilityMask` |
| `client/components/CanvasEditor.tsx` | Modify | New VariantGallery, visibility mask mode, importResult → variant system |
| `client/components/LayerPanel.tsx` | Modify | Remove `maskEnabled` toggle, keep `maskForAi` |
| `client/components/VariantGallery.tsx` | Rewrite | Full variant card UI with ✓ ĐÃ CHỌN badge, click-to-toggle, delete |
| `client/components/VisibilityMaskToolbar.tsx` | Create | Add/Remove region mode, brush size, softness slider, Done button |
| `server/routes/project.ts` | Modify | Support v4 in save/load, include variant cache files |
| `client/App.tsx` | Modify | Bump `ProjectFile` version to 4 in `saveProject()` |
| `client/components/PromptBar.tsx` | Modify | Rewrite `generate()` and `applySelected()` to use variant system with cache-first persistence |

---

### Task 1: Update Data Model — `LayerVariant`, `Layer` extension, `ProjectFile` v4

**Files:**
- Modify: `shared/types.ts:56-89, 198-203`

- [ ] **Step 1: Add `LayerVariant` interface and extend `Layer`**

Add after the `Layer` interface (after line 89):

```typescript
// ===== Layer Variant =====

export interface LayerVariant {
  id: string;                    // UUID
  resultImageId: string;         // filename in cache dir (without .png extension)
  source: 'ai-generated' | 'imported';
  modelId?: string;              // model AI đã dùng (nếu ai-generated)
  applied: boolean;              // true = variant này đang được apply (chỉ 1 variant/layer)
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

- [ ] **Step 2: Add `variants` field to `Layer`**

In the `Layer` interface, after `selection?: SelectionDraft;` (line 88), add:

```typescript
  // --- New fields (v4) ---
  variants?: LayerVariant[];     // Danh sách kết quả AI/import
```

Also mark `maskEnabled` as deprecated with a comment:

```typescript
  maskEnabled?: boolean;  // DEPRECATED — use variant.visibilityMask instead
```

- [ ] **Step 3: Bump `ProjectFile` version to 4**

Change line 199 from `version: 3` to `version: 4`:

```typescript
export interface ProjectFile {
  version: 4;
  imagePath: string;
  layers: Layer[];
  horizon: Horizon;
}
```

- [ ] **Step 4: Add `VariantMaskCacheRequest` / `VariantMaskCacheResponse` types**

Add after the `ReprojectResponse` interface (after line 127):

```typescript
export interface VariantMaskCacheRequest {
  variantId: string;
  base64Mask: string;
  softness: number;    // 0-100
  width: number;
  height: number;
}

export interface VariantMaskCacheResponse {
  featheredMaskId: string;
}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new type errors from `shared/types.ts`

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add LayerVariant interface, extend Layer, bump ProjectFile to v4"
```

---

### Task 2: Update ProjectState Store — Variant Actions

**Files:**
- Modify: `client/stores/project.ts:1-303`

- [ ] **Step 1: Add variant actions to `ProjectState` interface**

After `clearVariants(): void;` (line 206), add:

```typescript
  // Variant management (v4)
  addVariantToLayer(layerId: string, variant: LayerVariant): void;
  toggleVariant(layerId: string, variantId: string): void;
  removeVariantFromLayer(layerId: string, variantId: string): void;
  updateVariantMask(layerId: string, variantId: string, mask: LayerVariant['visibilityMask']): void;
```

Also add the import for `LayerVariant` at the top. Update line 10:

```typescript
import type { Horizon, Layer, LayerVariant, SelectionDraft, ViewPose } from '../../shared/types';
```

- [ ] **Step 2: Implement `addVariantToLayer`**

Add inside the store creator, after `clearVariants` (after line 206):

```typescript
  addVariantToLayer: (layerId, variant) => set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, variants: [...(layer.variants ?? []), variant] }
        : layer
    ),
  })),
```

- [ ] **Step 3: Implement `toggleVariant`**

```typescript
  toggleVariant: (layerId, variantId) => set((state) => ({
    layers: state.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const variants = (layer.variants ?? []).map((v) => ({
        ...v,
        applied: v.id === variantId ? !v.applied : false,
      }));
      return { ...layer, variants };
    }),
  })),
```

- [ ] **Step 4: Implement `removeVariantFromLayer`**

```typescript
  removeVariantFromLayer: (layerId, variantId) => set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, variants: (layer.variants ?? []).filter((v) => v.id !== variantId) }
        : layer
    ),
  })),
```

- [ ] **Step 5: Implement `updateVariantMask`**

```typescript
  updateVariantMask: (layerId, variantId, mask) => set((state) => ({
    layers: state.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const variants = (layer.variants ?? []).map((v) =>
        v.id === variantId ? { ...v, visibilityMask: mask } : v
      );
      return { ...layer, variants };
    }),
  })),
```

- [ ] **Step 6: Update `createPerspectiveLayer` — add empty `variants` array and remove `maskEnabled`**

In `createPerspectiveLayer` (line 137), update the layer object to include `variants: []`:

```typescript
  createPerspectiveLayer: (selection, resultImageId, perspWidth, perspHeight) => set((state) => {
    const layerId = crypto.randomUUID();
    const layer: Layer = {
      id: layerId,
      order: state.layers.length + 1,
      type: selection.sourceView === '360' ? 'perspective' : 'flat',
      visible: true,
      ...selection.viewPose,
      tileCoords: { x: 0, y: 0, w: perspWidth, h: perspHeight },
      maskData: [],
      maskForAi: true,
      prompt: selection.prompt,
      resultImageId,
      status: 'draft',
      selection,
      variants: [],
    };
    return {
      layers: [...state.layers, layer],
      activeLayerId: layerId,
      workflow: 'canvas-edit',
      selectionDraft: selection,
      activeTool: 'brush',
      editSnapshot: { layer: null, selection },
      dirty: false,
    };
  }),
```

- [ ] **Step 7: Update `openLayerEditor` — reset variant state**

Modify the return in `openLayerEditor` (line 167) to also clear old `generatedVariants`:

(No change needed — `generatedVariants: []` is already there. The old system remains for AI review flow, but variants in `layer.variants` are now the source of truth.)

- [ ] **Step 8: `leaveCanvas('save')` — no migration needed**

`leaveCanvas('save')` DOES NOT migrate `generatedVariants` to `layer.variants`. Migration at this point is too late — `GeneratedVariant.base64Result` is in memory and has not been persisted to server cache. Using `gv.id` as `resultImageId` would create variants pointing to non-existent cache files, breaking export.

Instead, variant creation with proper cache persistence happens at:
- **AI generation time** (see Task 9): `api.image.saveResultCache(base64Result)` → `addVariantToLayer(layerId, variant)`
- **Import time** (see Task 9): `api.image.saveResultCache(base64Result)` → `addVariantToLayer(layerId, variant)`

The existing `leaveCanvas('save')` already handles committing the layer (`status: 'committed'`) and clearing `generatedVariants`. No additional migration code is needed.

- [ ] **Step 9: Verify store compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from `client/stores/project.ts`

- [ ] **Step 10: Commit**

```bash
git add client/stores/project.ts
git commit -m "feat: add variant actions to ProjectState store"
```

---

### Task 3: Debug & Fix Export Final Bug

**Files:**
- Modify: `server/services/image-processor.ts:80-201`

- [ ] **Step 1: Add debug logging to `exportImage`**

At the top of `exportImage()`, after `const sortedLayers = exportableLayers(layers);` (line 99), add:

```typescript
  console.log(`[export] total layers: ${layers.length}, exportable: ${sortedLayers.length}`);
  for (const layer of sortedLayers) {
    const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
    console.log(`[export] layer ${layer.id} order=${layer.order} type=${layer.type} resultImageId=${layer.resultImageId} hasAppliedVariant=${!!appliedVariant} variantResultId=${appliedVariant?.resultImageId}`);
  }
```

- [ ] **Step 2: Rewrite composite loop to use variants**

Replace the entire `for (const layer of sortedLayers)` loop body (lines 102-182) with variant-aware logic. The key change: read `resultImageId` from applied variant instead of layer root:

```typescript
    for (const layer of sortedLayers) {
      // Find applied variant — if none, skip this layer entirely
      const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
      if (!appliedVariant) {
        console.log(`[export] layer ${layer.id}: no applied variant, skipping`);
        continue;
      }

      const variantFile = path.join(CACHE_DIR, `${appliedVariant.resultImageId}.png`);
      try {
        await fs.access(variantFile);

        if (layer.type === 'perspective') {
          // Prefer pre-rendered equirectangular buffer
          if (layer.equirectImageId) {
            const eqFile = path.join(CACHE_DIR, `${layer.equirectImageId}.png`);
            try {
              await fs.access(eqFile);
              pipeline = pipeline.composite([{ input: eqFile, top: 0, left: 0, blend: 'over' }]);
              continue;
            } catch { /* fall through */ }
          }
          const { reprojectToEquirectangular } = await import('./perspective-projector');
          const reprojected = await reprojectToEquirectangular(variantFile, layer, panoramaSize);
          pipeline = pipeline.composite([{ input: reprojected, top: 0, left: 0, blend: 'over' }]);
          continue;
        }

        // Flat layer: apply visibility mask if present
        if (appliedVariant.visibilityMask?.base64Mask) {
          const maskedResult = await applyVisibilityMask(
            variantFile,
            appliedVariant.visibilityMask.base64Mask,
            appliedVariant.visibilityMask.brushSoftness,
            appliedVariant.width,
            appliedVariant.height,
          );
          pipeline = pipeline.composite([{
            input: maskedResult,
            top: Math.round(layer.tileCoords.y),
            left: Math.round(layer.tileCoords.x),
            blend: 'over',
          }]);
        } else {
          // No visibility mask — blend full variant tile with its natural alpha
          pipeline = pipeline.composite([{
            input: variantFile,
            top: Math.round(layer.tileCoords.y),
            left: Math.round(layer.tileCoords.x),
            blend: 'over',
          }]);
        }
      } catch {
        console.log(`[export] variant cache file missing: ${appliedVariant.resultImageId}, skipping layer`);
      }
    }
```

- [ ] **Step 3: Add `applyVisibilityMask` function**

Add after `applyBase64Mask` (after line 221):

```typescript
export async function applyVisibilityMask(
  resultPath: string,
  base64Mask: string,
  softness: number,
  width: number,
  height: number,
): Promise<Buffer> {
  // Decode mask
  const maskBuf = await sharp(Buffer.from(base64Mask, 'base64'))
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Apply feather (blur) if softness > 0
  let featheredMask = maskBuf;
  if (softness > 0) {
    const maxSize = Math.max(width, height);
    const sigma = (softness / 100) * (maxSize / 100); // scale sigma to reasonable range
    featheredMask = await sharp(maskBuf)
      .blur(sigma)
      .png()
      .toBuffer();
  }

  // Extract alpha from feathered mask, apply to result
  const maskAlpha = await sharp(featheredMask)
    .extractChannel(3) // alpha channel
    .raw()
    .toBuffer();

  const resultRgb = await sharp(resultPath)
    .removeAlpha()
    .raw()
    .toBuffer();

  const resultAlpha = await sharp(resultPath)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

  // Combine: result RGB + max(maskAlpha, resultAlpha) as final alpha
  const pixelCount = width * height;
  const rgba = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4]     = resultRgb[i * 3];
    rgba[i * 4 + 1] = resultRgb[i * 3 + 1];
    rgba[i * 4 + 2] = resultRgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.max(maskAlpha[i], resultAlpha[i]);
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
```

- [ ] **Step 4: Verify server compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from `server/services/image-processor.ts`

- [ ] **Step 5: Mark `applyBase64Mask` as deprecated**

After adding `applyVisibilityMask`, add a deprecation comment to the existing `applyBase64Mask` function (line 203). It's still used by the old `maskEnabled` code path in `exportImage`, but that code path is being replaced by the variant-aware composite loop. After the new loop is active, `applyBase64Mask` becomes dead code:

```typescript
/** @deprecated Use applyVisibilityMask instead — supports feather + alpha combine */
export async function applyBase64Mask(resultPath: string, base64Mask: string): Promise<Buffer> {
```

The old function is kept for reference but is no longer called from the new composite loop. Remove it entirely in a future cleanup pass if no other callers exist.

- [ ] **Step 6: Commit**

```bash
git add server/services/image-processor.ts
git commit -m "fix: exportImage now composites applied variants, skips layers without variant"
```

---

### Task 4: Redesign VariantGallery UI

**Files:**
- Rewrite: `client/components/VariantGallery.tsx`

- [ ] **Step 1: Rewrite VariantGallery with variant cards**

Replace the entire content of `VariantGallery.tsx`:

```tsx
import React, { useCallback } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import type { LayerVariant } from '../../shared/types';

interface Props {
  onEditMask?: (variant: LayerVariant) => void;
}

export default function VariantGallery({ onEditMask }: Props) {
  const layers = useProjectStore((s) => s.layers);
  const activeLayerId = useProjectStore((s) => s.activeLayerId);
  const toggleVariant = useProjectStore((s) => s.toggleVariant);
  const removeVariantFromLayer = useProjectStore((s) => s.removeVariantFromLayer);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const variants = activeLayer?.variants ?? [];

  const handleToggle = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      toggleVariant(activeLayerId, variantId);
    },
    [activeLayerId, toggleVariant],
  );

  const handleDelete = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      if (!confirm('Xóa kết quả này?')) return;
      removeVariantFromLayer(activeLayerId, variantId);
    },
    [activeLayerId, removeVariantFromLayer],
  );

  if (!variants.length) return null;

  return (
    <div className="variant-gallery">
      <div className="variant-gallery-title">
        Results ({variants.length})
      </div>
      <div className="variant-gallery-list">
        {variants.map((variant) => {
          const isApplied = variant.applied;
          const cacheUrl = api.image.cacheUrl(variant.resultImageId);
          return (
            <div
              key={variant.id}
              className={`variant-card ${isApplied ? 'applied' : ''}`}
            >
              <div className="variant-thumb-wrapper" onClick={() => handleToggle(variant.id)}>
                {isApplied && <span className="variant-badge">✓ ĐÃ CHỌN</span>}
                <img
                  className="variant-thumb"
                  src={cacheUrl}
                  alt={variant.source}
                />
              </div>
              <div className="variant-meta">
                <span className="variant-source">
                  {variant.source === 'ai-generated'
                    ? `AI: ${variant.modelId ?? 'unknown'}`
                    : 'Imported'}
                </span>
                <span className="variant-size">
                  {variant.width}×{variant.height}
                </span>
              </div>
              <div className="variant-actions">
                {isApplied && onEditMask && (
                  <button
                    className="variant-action-btn"
                    onClick={() => onEditMask(variant)}
                    title="Edit visibility mask"
                  >
                    🖌 Edit Mask
                  </button>
                )}
                <button
                  className="variant-action-btn variant-delete"
                  onClick={() => handleDelete(variant.id)}
                  title="Delete result"
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/components/VariantGallery.tsx
git commit -m "feat: redesign VariantGallery with variant cards and toggle/delete"
```

---

### Task 5: Create Visibility Mask Toolbar Component

**Files:**
- Create: `client/components/VisibilityMaskToolbar.tsx`

- [ ] **Step 1: Create `VisibilityMaskToolbar.tsx`**

```tsx
import React, { useState } from 'react';

interface Props {
  mode: 'add' | 'remove';
  brushSize: number;
  brushSoftness: number;
  onModeChange: (mode: 'add' | 'remove') => void;
  onBrushSizeChange: (size: number) => void;
  onBrushSoftnessChange: (softness: number) => void;
  onDone: () => void;
}

export default function VisibilityMaskToolbar({
  mode,
  brushSize,
  brushSoftness,
  onModeChange,
  onBrushSizeChange,
  onBrushSoftnessChange,
  onDone,
}: Props) {
  const [sizeInput, setSizeInput] = useState(String(brushSize));

  const applySize = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1 && n <= 500) {
      setSizeInput(String(n));
      onBrushSizeChange(n);
    }
  };

  return (
    <div className="visibility-mask-toolbar">
      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Mode:</span>
        <button
          className={`mask-mode-btn ${mode === 'add' ? 'active' : ''}`}
          onClick={() => onModeChange('add')}
        >
          Add Region
        </button>
        <button
          className={`mask-mode-btn ${mode === 'remove' ? 'active' : ''}`}
          onClick={() => onModeChange('remove')}
        >
          Remove Region
        </button>
      </div>

      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Size:</span>
        <button
          className="mask-size-btn"
          onClick={() => applySize(String(Math.max(1, brushSize - 4)))}
        >
          −
        </button>
        <input
          className="mask-size-input"
          type="number"
          min={1}
          max={500}
          value={sizeInput}
          onChange={(e) => setSizeInput(e.target.value)}
          onBlur={() => applySize(sizeInput)}
          onKeyDown={(e) => { if (e.key === 'Enter') applySize(sizeInput); }}
        />
        <button
          className="mask-size-btn"
          onClick={() => applySize(String(Math.min(500, brushSize + 4)))}
        >
          +
        </button>
      </div>

      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Softness: {brushSoftness}%</span>
        <input
          className="mask-softness-slider"
          type="range"
          min={0}
          max={100}
          value={brushSoftness}
          onChange={(e) => onBrushSoftnessChange(Number(e.target.value))}
        />
      </div>

      <div className="mask-toolbar-row">
        <button className="mask-done-btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/components/VisibilityMaskToolbar.tsx
git commit -m "feat: add VisibilityMaskToolbar component"
```

---

### Task 6: Integrate Visibility Mask Mode into CanvasEditor

**Files:**
- Modify: `client/components/CanvasEditor.tsx:1-444`

- [ ] **Step 1: Update `sourceUrl` to prioritize applied variant**

In `CanvasEditor.tsx`, replace the `sourceUrl` computation (lines 28-47) to check for an applied variant first. The active layer's `resultImageId` is only a fallback:

```typescript
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const appliedVariant = activeLayer?.variants?.find((v) => v.applied);
  const tile = activeLayer?.tileCoords ?? state.selectionDraft?.tileCoords;
  const sourceUrl = useMemo(() => {
    // Applied variant takes priority — its cache file is the source of truth
    if (appliedVariant?.resultImageId) {
      return api.image.cacheUrl(appliedVariant.resultImageId);
    }
    // Perspective layers: load from server cache via resultImageId
    if (activeLayer?.type === 'perspective' && activeLayer?.resultImageId) {
      return api.image.cacheUrl(activeLayer.resultImageId);
    }
    // Flat view: load tile from original image
    if (!state.imagePath || !tile) return '';
    return state.selectionDraft?.sourceView === 'flat'
      ? api.image.tileUrl(state.imagePath, tile.x, tile.y, tile.w, tile.h)
      : api.image.serveUrl(state.imagePath, 4096);
  }, [
    appliedVariant?.resultImageId,
    activeLayer?.resultImageId,
    activeLayer?.type,
    state.imagePath,
    state.selectionDraft?.sourceView,
    tile?.x,
    tile?.y,
    tile?.w,
    tile?.h,
  ]);
```

Note: `activeLayer` and `appliedVariant` are now computed above `sourceUrl` (move line 26 up before `sourceUrl`).

- [ ] **Step 2: Add imports for new components and types**

Add at the top of CanvasEditor.tsx (after existing imports):

```tsx
import VisibilityMaskToolbar from './VisibilityMaskToolbar';
import type { LayerVariant } from '../../shared/types';
```

- [ ] **Step 3: Add visibility mask state**

Add state variables inside the `CanvasEditor` function, after existing `useState` declarations (after line 18):

```typescript
  const [maskMode, setMaskMode] = useState<'idle' | 'editing'>('idle');
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [maskRegion, setMaskRegion] = useState<'add' | 'remove'>('add');
  const [maskBrushSize, setMaskBrushSize] = useState(24);
  const [maskBrushSoftness, setMaskBrushSoftness] = useState(50);
  const [visibilityOverlay, setVisibilityOverlay] = useState<string | null>(null);
```

- [ ] **Step 4: Create visibility mask canvas for overlay**

When entering mask mode, we need TWO things on the Fabric canvas:
1. **Variant image as base layer** (replaces the normal source image) — loaded from the variant's cache URL
2. **Mask overlay** — a semi-transparent overlay showing the current visibility mask state

Add the mask mode functions after existing `useState` declarations:

```typescript
  const enterMaskMode = async (variant: LayerVariant) => {
    if (!fabricRef.current || !activeLayer) return;
    const canvas = fabricRef.current;
    setMaskMode('editing');
    setEditingVariantId(variant.id);

    // Load variant image as the new base layer (replaces source image)
    const { FabricImage } = await import('fabric');
    const variantUrl = api.image.cacheUrl(variant.resultImageId);
    const variantImg = await FabricImage.fromURL(variantUrl);
    
    // Remove old source image, add variant image at same position/scale
    const oldImage = canvas.getObjects().find((o: any) => o._isSourceImage);
    const pos = oldImage ? { left: oldImage.left!, top: oldImage.top!, scaleX: oldImage.scaleX!, scaleY: oldImage.scaleY! } 
                          : { left: 0, top: 0, scaleX: 1, scaleY: 1 };
    if (oldImage) canvas.remove(oldImage);
    
    variantImg.set({ ...pos, selectable: false, evented: false });
    variantImg._isSourceImage = true;
    canvas.add(variantImg);
    canvas.sendToBack(variantImg);

    // If existing mask, load it as a semi-transparent overlay
    if (variant.visibilityMask?.base64Mask) {
      const maskImg = await FabricImage.fromURL(`data:image/png;base64,${variant.visibilityMask.base64Mask}`);
      maskImg.set({ ...pos, opacity: 0.4, selectable: false, evented: false });
      maskImg._isMaskOverlay = true;
      canvas.add(maskImg);
    }

    setMaskRegion(variant.visibilityMask ? 'remove' : 'add');
    if (variant.visibilityMask) {
      setMaskBrushSize(variant.visibilityMask.brushSize);
      setMaskBrushSoftness(variant.visibilityMask.brushSoftness);
    }
    canvas.requestRenderAll();
  };

  const exitMaskMode = () => {
    if (!fabricRef.current || !activeLayer) return;
    const canvas = fabricRef.current;
    // Remove mask overlay
    const maskOverlay = canvas.getObjects().find((o: any) => o._isMaskOverlay);
    if (maskOverlay) canvas.remove(maskOverlay);
    
    // Restore original source image
    const variantImg = canvas.getObjects().find((o: any) => o._isSourceImage);
    if (variantImg) canvas.remove(variantImg);
    
    // Trigger a full Fabric re-init by remounting (relies on the sourceUrl useEffect)
    setMaskMode('idle');
    setEditingVariantId(null);
    setVisibilityOverlay(null);
  };

  const saveMask = () => {
    if (!editingVariantId || !activeLayerId) return;
    const fabricCanvas = fabricRef.current;
    if (!fabricCanvas) return;

    // Export mask: hide source image, render only brush strokes on black bg
    const image = fabricCanvas.getObjects().find((o: any) => o._isSourceImage);
    const maskOverlay = fabricCanvas.getObjects().find((o: any) => o._isMaskOverlay);
    if (!image) return;
    
    image.set({ visible: false });
    if (maskOverlay) maskOverlay.set({ visible: false });
    const prevBg = fabricCanvas.backgroundColor;
    fabricCanvas.backgroundColor = '#000000';
    
    // Make all mask strokes white for export
    const maskStrokes = fabricCanvas.getObjects().filter((o: any) => o !== image && o !== maskOverlay);
    const savedColors = maskStrokes.map((o: any) => ({ obj: o, color: o.stroke }));
    maskStrokes.forEach((o: any) => { o.set({ stroke: '#ffffff', fill: '#ffffff' }); });
    
    fabricCanvas.requestRenderAll();
    const displayedW = image.width! * image.scaleX!;
    const displayedH = image.height! * image.scaleY!;

    const base64Mask = fabricCanvas.toDataURL({
      format: 'png',
      left: image.left!,
      top: image.top!,
      width: displayedW,
      height: displayedH,
      multiplier: tile?.w ? activeLayer!.tileCoords.w / displayedW : 1,
    }).split(',')[1];

    // Restore
    image.set({ visible: true });
    if (maskOverlay) maskOverlay.set({ visible: true });
    maskStrokes.forEach((s: any) => { s.obj.set({ stroke: s.color, fill: s.color }); });
    fabricCanvas.backgroundColor = prevBg;
    fabricCanvas.requestRenderAll();

    state.updateVariantMask(activeLayerId, editingVariantId, {
      base64Mask,
      brushSize: maskBrushSize,
      brushSoftness: maskBrushSoftness,
    });

    exitMaskMode();
  };
```

- [ ] **Step 5: Update brush behavior for visibility mask mode**

Modify the brush drawing behavior when `maskMode === 'editing'`. Replace the brush color/width logic in the tool switcher useEffect. Add a condition for mask mode:

```typescript
  // Inside the useEffect for activeTool changes (around line 279-306):
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    if (maskMode === 'editing') {
      canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
      if (canvas.freeDrawingBrush) {
        const color = maskRegion === 'add' ? 'rgba(255,255,255,1.0)' : 'rgba(0,0,0,1.0)';
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = maskBrushSize;
      }
      return;
    }

    canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
    // ... rest of existing logic
  }, [state.activeTool, maskMode, maskRegion, maskBrushSize]);
```

- [ ] **Step 6: Render mask mode toolbar and overlay in JSX**

After the canvas stage div (after line 441), add:

```tsx
      {maskMode === 'editing' && (
        <VisibilityMaskToolbar
          mode={maskRegion}
          brushSize={maskBrushSize}
          brushSoftness={maskBrushSoftness}
          onModeChange={setMaskRegion}
          onBrushSizeChange={setMaskBrushSize}
          onBrushSoftnessChange={setMaskBrushSoftness}
          onDone={saveMask}
        />
      )}
```

- [ ] **Step 7: Replace old VariantGallery with new one**

Replace `<VariantGallery />` (line 434) with:

```tsx
      <VariantGallery onEditMask={enterMaskMode} />
```

- [ ] **Step 8: Commit**

```bash
git add client/components/CanvasEditor.tsx
git commit -m "feat: integrate visibility mask mode into CanvasEditor"
```

---

### Task 7: Simplify AI Mask Panel — Remove `maskEnabled`

**Files:**
- Modify: `client/components/LayerPanel.tsx:53-91`

- [ ] **Step 1: Remove "Apply mask (limit display)" toggle**

Delete lines 63-69 (the `maskEnabled` checkbox):

```tsx
          {/* Remove this block:
          <label className="mask-toggle-row" title="When enabled, mask shapes limit the display scope. When disabled, the full layer is shown.">
            <input ... />
            Apply mask (limit display)
          </label>
          */}
```

- [ ] **Step 2: Update `setLayerMask` type to exclude `maskEnabled`**

In `client/stores/project.ts`, update the `setLayerMask` signature (line 70):

```typescript
  setLayerMask(id: string, patch: Partial<Pick<Layer, 'maskData' | 'maskForAi'>>): Promise<void>;
```

- [ ] **Step 3: Commit**

```bash
git add client/components/LayerPanel.tsx client/stores/project.ts
git commit -m "refactor: remove maskEnabled toggle, keep only maskForAi"
```

---

### Task 8: Project Save/Load — Version 4 + Migration

**Files:**
- Modify: `server/routes/project.ts:1-201`
- Modify: `client/App.tsx:37-53`

- [ ] **Step 1: Update download endpoint to collect variant cache files**

In `projectRouter.post('/download', ...)`, modify the cache collection loop (lines 45-55) to also collect variant `resultImageId`:

```typescript
    const seen = new Set<string>();
    for (const layer of project.layers) {
      // Legacy resultImageId (backward compat)
      for (const id of [layer.resultImageId, layer.equirectImageId]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const src = path.join(CACHE_DIR, `${id}.png`);
        try {
          await fs.access(src);
          await fs.copyFile(src, path.join(cacheDir, `${id}.png`));
        } catch { /* skip missing */ }
      }
      // Variant cache files (v4)
      for (const variant of (layer.variants ?? [])) {
        const id = variant.resultImageId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const src = path.join(CACHE_DIR, `${id}.png`);
        try {
          await fs.access(src);
          await fs.copyFile(src, path.join(cacheDir, `${id}.png`));
        } catch { /* skip missing */ }
      }
    }
```

- [ ] **Step 2: Update project.json version in download**

Change `version: 3` to `version: 4` in line 60:

```typescript
    const projectJson: ProjectFile = {
      ...project,
      version: 4,
      imagePath: `original${origExt}`,
    };
```

- [ ] **Step 3: Add migration logic for v3→v4 in upload-zip**

In `projectRouter.post('/upload-zip', ...)`, after the version check (line 149), add migration before the cache remap. Update the version range check from `project.version < 2 || project.version > 3` to `project.version < 2 || project.version > 4`:

```typescript
    if (project.version < 2 || project.version > 4) {
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }
```

Then, after reading project.json and before cache remap, add migration:

```typescript
    // Migrate v3 → v4: auto-create variants from legacy resultImageId
    if (project.version === 3) {
      project.version = 4;
      project.layers = project.layers.map((layer: any) => {
        if (!layer.variants && layer.resultImageId) {
          return {
            ...layer,
            variants: [{
              id: crypto.randomUUID(),
              resultImageId: layer.resultImageId,
              source: 'ai-generated' as const,
              applied: layer.status === 'committed',
              width: layer.tileCoords?.w ?? 1024,
              height: layer.tileCoords?.h ?? 1024,
              createdAt: Date.now(),
            }],
          };
        }
        return { ...layer, variants: layer.variants ?? [] };
      });
    }
```

Then update the existing cache remap (lines 182-189) to also remap variant cache IDs:

```typescript
    // Remap layer cache IDs (including variant resultImageIds)
    const layers = project.layers.map((layer) => ({
      ...layer,
      resultImageId: cacheMap.get(layer.resultImageId) || layer.resultImageId,
      equirectImageId: layer.equirectImageId
        ? (cacheMap.get(layer.equirectImageId) || layer.equirectImageId)
        : undefined,
      variants: (layer.variants ?? []).map((v) => ({
        ...v,
        resultImageId: cacheMap.get(v.resultImageId) || v.resultImageId,
      })),
    }));
```

- [ ] **Step 4: Update client `saveProject` to use version 4**

In `client/App.tsx:41`, change `version: 3` to `version: 4`:

```typescript
    const project: ProjectFile = {
      version: 4,
      imagePath: current.imagePath,
      layers: current.layers,
      horizon: current.horizon,
    };
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/project.ts client/App.tsx
git commit -m "feat: project save/load v4 with variant cache files and v3→v4 migration"
```

---

### Task 9: Update AI Generation & Import Flow to Use Variant System

**Files:**
- Modify: `client/components/CanvasEditor.tsx` (importResult function)
- Modify: `client/components/PromptBar.tsx` (generate + applySelected functions)

**CRITICAL:** Variants MUST be persisted to server cache BEFORE being added to `layer.variants[]`. `resultImageId` must point to a real file in `CACHE_DIR`. Using an unpersisted ID (e.g., `gv.id`) will cause export to fail silently (cache file missing → skip layer).

- [ ] **Step 1: Update `importResult` to use new variant system**

In `CanvasEditor.tsx`, replace the `importResult` function (lines 356-401). The function already uses `api.image.saveResultCache()` to persist before creating the variant. The key change from the old code: use `state.addVariantToLayer()` + `state.toggleVariant()` instead of `state.addGeneratedVariant()`:

```typescript
  const importResult = async (file?: File) => {
    if (!file || !activeLayer) return;
    setExchangeMessage('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('File kết quả phải là ảnh.');

      const bitmap = await createImageBitmap(file);
      const importedW = bitmap.width;
      const importedH = bitmap.height;
      bitmap.close();

      const expectedW = activeLayer.tileCoords.w;
      const expectedH = activeLayer.tileCoords.h;
      const expectedRatio = expectedW / expectedH;
      const importedRatio = importedW / importedH;
      const ratioDelta = Math.abs(expectedRatio - importedRatio) / expectedRatio;
      if (ratioDelta > 0.01) {
        throw new Error(
          `Tỉ lệ ảnh không khớp. Ảnh nhập: ${importedW}×${importedH} (tỉ lệ ${importedRatio.toFixed(3)}). ` +
          `Yêu cầu: ${expectedW}×${expectedH} (tỉ lệ ${expectedRatio.toFixed(3)}).`,
        );
      }

      const base64Result = await blobToPngBase64(file, { width: expectedW, height: expectedH });

      // Persist to server cache FIRST — resultImageId must point to a real file
      const { resultImageId } = await api.image.saveResultCache(base64Result);

      const variant: LayerVariant = {
        id: crypto.randomUUID(),
        resultImageId,
        source: 'imported',
        applied: false,
        width: expectedW,
        height: expectedH,
        createdAt: Date.now(),
      };

      // Add variant to layer and select it (deselects others automatically)
      state.addVariantToLayer(activeLayer.id, variant);
      state.toggleVariant(activeLayer.id, variant.id);

      const action = importedW > expectedW ? 'downscale' : 'upscale';
      setExchangeMessage(`Đã nạp kết quả và ${action} về ${expectedW} × ${expectedH}px.`);
    } catch (reason) {
      setExchangeMessage(reason instanceof Error ? reason.message : 'Không thể nạp ảnh kết quả.');
    }
  };
```

Note: The existing `api.image.saveResultCache(base64Image)` at [client/lib/api.ts:32-33](client/lib/api.ts#L32-L33) already handles base64→cache persistence and returns `{ resultImageId, sizeBytes }`. No new endpoint needed.

- [ ] **Step 2: Update `generate()` in PromptBar — persist to cache + create variant immediately**

In `client/components/PromptBar.tsx`, modify the `generate()` function (line 22-77). After `state.addGeneratedVariant(...)`, also persist the result to server cache and add it as a LayerVariant to the active layer. This ensures variants always reference real cache files:

```typescript
  const generate = async () => {
    const selection = state.selectionDraft;
    const model = state.selectedModel;
    const mask = state.getMaskBase64?.();
    const layerId = state.activeLayerId;
    if (!selection || !state.imagePath || !model || !prompt.trim()) return;

    const useMaskForAi = activeLayer?.maskForAi !== false;
    if (useMaskForAi && !mask) return;

    setError('');
    state.setWorkflow('generating');
    try {
      const translated = (await api.ai.translate(prompt.trim())).translated;
      let base64Image: string | undefined;

      if (activeLayer?.resultImageId) {
        const cacheUrl = api.image.cacheUrl(activeLayer.resultImageId);
        const response = await fetch(cacheUrl);
        if (!response.ok) throw new Error('Không đọc được ảnh canvas từ cache.');
        base64Image = await blobToBase64(await response.blob());
      } else {
        const coords = selection.tileCoords;
        const imageResponse = await fetch(api.image.tileUrl(
          state.imagePath, coords.x, coords.y, coords.w, coords.h,
        ));
        if (!imageResponse.ok) throw new Error('Không đọc được vùng ảnh.');
        base64Image = await blobToBase64(await imageResponse.blob());
      }

      const effectiveMask = useMaskForAi ? mask! : await createWhiteMask(
        selection.tileCoords.w,
        selection.tileCoords.h,
      );

      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: effectiveMask,
        prompt: translated,
      });
      state.setSelectionDraft({ ...selection, prompt });

      // Persist to server cache — MUST happen before creating variant
      const { resultImageId } = await api.image.saveResultCache(result.base64Result);

      // Add as LayerVariant to active layer (NEW — variant system)
      if (layerId) {
        const variant: import('../../shared/types').LayerVariant = {
          id: crypto.randomUUID(),
          resultImageId,
          source: 'ai-generated',
          modelId: result.model,
          applied: false,
          width: activeLayer?.tileCoords.w ?? selection.tileCoords.w,
          height: activeLayer?.tileCoords.h ?? selection.tileCoords.h,
          createdAt: Date.now(),
        };
        state.addVariantToLayer(layerId, variant);
        // Auto-select the newly generated variant
        state.toggleVariant(layerId, variant.id);
      }

      // Also keep old system for ai-review preview overlay (backward compat)
      state.addGeneratedVariant({
        id: crypto.randomUUID(),
        base64Result: result.base64Result,
        modelId: result.model,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Generate thất bại');
      state.setWorkflow(state.generatedVariants.length ? 'ai-review' : 'canvas-edit');
    }
  };
```

- [ ] **Step 3: Rewrite `applySelected()` in PromptBar to use variant system**

The old `applySelected()` (line 80-134) directly creates/updates a Layer with `resultImageId` and `status: 'committed'`. With the variant system, this is replaced. The variant was already created and toggled in Step 2. The "Apply Selected" button now just commits the layer and triggers reprojection for perspective layers:

```typescript
  const applySelected = async () => {
    const selection = state.selectionDraft;
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer || !selection || !state.imagePath) return;
    
    // Find the applied variant for this layer
    const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
    if (!appliedVariant) {
      setError('Chưa chọn kết quả nào để apply.');
      return;
    }

    setError('');
    state.setWorkflow('generating');
    try {
      // For perspective layers, reproject the applied variant to equirectangular
      let equirectImageId: string | undefined;
      if (selection.sourceView === '360') {
        const shapes = layer.maskData ?? [];
        const reprojResult = await api.image.reproject({
          resultImageId: appliedVariant.resultImageId,
          selection,
          imagePath: state.imagePath,
          maskEnabled: false,           // visibility mask is handled separately
          maskData: shapes.filter((s) => s.enabled !== false),
        });
        equirectImageId = reprojResult.equirectImageId;
      }

      // Commit the layer with equirect buffer (variant already has applied=true)
      state.updateLayer(layer.id, {
        status: 'committed',
        equirectImageId: equirectImageId ?? layer.equirectImageId,
      });

      useProjectStore.setState({
        workflow: 'canvas-edit',
        dirty: false,
        maskDirty: false,
        generatedVariants: [],
        selectedVariantId: null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply thất bại');
      state.setWorkflow('canvas-edit');
    }
  };
```

- [ ] **Step 4: Update the "Apply Selected" button condition**

Change the disabled condition (line 213-214) — the button is enabled when there's an applied variant instead of checking `selectedVariantId`:

```typescript
        <button
          className="prompt-btn prompt-btn-apply"
          disabled={!activeLayer?.variants?.find(v => v.applied)}
          onClick={() => void applySelected()}
        >
          Apply Selected
        </button>
```

- [ ] **Step 5: Commit**

```bash
git add client/components/CanvasEditor.tsx client/components/PromptBar.tsx
git commit -m "feat: AI generation and import persist variants to server cache before adding to layer"
```

---

### Task 10: CSS Styles for New Components

**Files:**
- Modify: `client/styles/theme.css`

- [ ] **Step 1: Add styles for VariantGallery**

```css
/* Variant Gallery */
.variant-gallery {
  padding: 8px;
  border-top: 1px solid #1a1a2e;
  background: #0a0a1a;
}

.variant-gallery-title {
  font-size: 12px;
  color: #888;
  margin-bottom: 6px;
  font-weight: 600;
}

.variant-gallery-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.variant-card {
  flex-shrink: 0;
  width: 120px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  background: #12122a;
  transition: border-color 0.15s;
}

.variant-card.applied {
  border-color: #4caf50;
}

.variant-thumb-wrapper {
  position: relative;
  cursor: pointer;
  aspect-ratio: 1;
  overflow: hidden;
}

.variant-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.variant-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: #4caf50;
  color: #000;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  z-index: 2;
}

.variant-meta {
  padding: 4px 6px;
  font-size: 10px;
  color: #aaa;
  display: flex;
  flex-direction: column;
}

.variant-actions {
  display: flex;
  gap: 4px;
  padding: 0 6px 6px;
}

.variant-action-btn {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid #333;
  border-radius: 3px;
  background: #1a1a2e;
  color: #ccc;
  cursor: pointer;
}

.variant-action-btn:hover {
  background: #2a2a4e;
}

.variant-delete {
  color: #ef5350;
  border-color: #ef535066;
}
```

- [ ] **Step 2: Add styles for VisibilityMaskToolbar**

```css
/* Visibility Mask Toolbar */
.visibility-mask-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #0d0d20;
  border-top: 1px solid #1a1a2e;
  align-items: center;
}

.mask-toolbar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mask-toolbar-label {
  font-size: 11px;
  color: #888;
  min-width: 50px;
}

.mask-mode-btn {
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #1a1a2e;
  color: #aaa;
  cursor: pointer;
}

.mask-mode-btn.active {
  background: #0f3460;
  color: #e94560;
  border-color: #e94560;
}

.mask-size-input {
  width: 48px;
  padding: 3px 6px;
  font-size: 12px;
  background: #1a1a2e;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 3px;
  text-align: center;
}

.mask-size-btn {
  font-size: 14px;
  padding: 2px 8px;
  border: 1px solid #333;
  border-radius: 3px;
  background: #1a1a2e;
  color: #ccc;
  cursor: pointer;
}

.mask-softness-slider {
  width: 100px;
  accent-color: #e94560;
}

.mask-done-btn {
  font-size: 12px;
  padding: 4px 16px;
  border: none;
  border-radius: 4px;
  background: #4caf50;
  color: #000;
  font-weight: 600;
  cursor: pointer;
  margin-left: auto;
}

.mask-done-btn:hover {
  background: #66bb6a;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/styles/theme.css
git commit -m "style: add CSS for VariantGallery and VisibilityMaskToolbar"
```

---

### Task 11: Edge Cases & Backward Compatibility

**Files:**
- Modify: `server/services/image-processor.ts`
- Modify: `client/stores/project.ts`

- [ ] **Step 1: Handle layers with old data (no variants field)**

In `exportableLayers` and `exportImage`, ensure code handles `variants` being undefined. Add a guard in the composite loop:

```typescript
      const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
```

(This is already done in the Task 3 code above with `?? []`.)

- [ ] **Step 2: Handle cache file missing for variant**

In the export loop, wrap variant file access in try/catch and skip silently:

(This is already in the Task 3 code above.)

- [ ] **Step 3: Handle `reorderLayer` preserving variant references**

The `reorderLayer` function already copies all Layer fields with spread (`{ ...layer, order: newOrder }`), so variants are preserved. No change needed.

- [ ] **Step 4: Handle `removeLayer` cleanup of variant cache files** (optional, skip for MVP)

Add a comment noting that variant cache files are not deleted on layer removal to keep it simple:

```typescript
  // Note: variant cache files are NOT deleted on removeLayer to avoid
  // accidental data loss. Cache dir is cleaned on reset.
```

- [ ] **Step 5: Handle `reset()` — clear all variants**

The `reset` function already resets `layers: []`, which clears all variant data. No additional cache cleanup needed.

- [ ] **Step 6: Commit**

```bash
git add server/services/image-processor.ts
git commit -m "fix: edge cases — undefined variants, missing cache files, backward compat"
```

---

### Task 12: Integration Verification

- [ ] **Step 1: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Build the project**

```bash
npm run build
```

Expected: Successful build.

- [ ] **Step 3: Manual test — create multiple layers and export**

1. Open a panorama image
2. Create layer 1: draw rect → generate AI → select variant → save
3. Create layer 2: draw rect → generate AI → select variant → save
4. Export final → verify both layers are composited

- [ ] **Step 4: Manual test — toggle variant selection**

1. Open layer, generate 2 AI results
2. Click thumbnail 1 → verify ✓ ĐÃ CHỌN badge appears
3. Click thumbnail 2 → verify badge moves to variant 2
4. Click thumbnail 2 again → verify both deselected

- [ ] **Step 5: Manual test — visibility mask**

1. Select a variant → click Edit Mask
2. Test Add Region mode: variant hidden, brush reveals
3. Test Remove Region mode: variant visible, brush hides
4. Click Done → verify mask persists when re-entering

- [ ] **Step 6: Manual test — project save/load**

1. Create project with multiple layers + variants + masks
2. Save project (.360project)
3. Load project → verify all layers, variants, masks are restored

- [ ] **Step 7: Manual test — load v3 project (migration)**

1. If you have an old .360project (v3), load it
2. Verify layers get auto-migrated with a default variant

Expected: ✅ All layers visible, export works.

---

## Self-Review (Updated after Critical Review)

**1. Spec coverage:**
- ✅ Task 1: Data model (LayerVariant, Layer extension, v4)
- ✅ Task 2: Store actions — variants created at AI/import time (NOT in leaveCanvas)
- ✅ Task 3: Bug fix exportImage + new composite logic + applyBase64Mask deprecation
- ✅ Task 4: Variant Gallery UI with ✓ ĐÃ CHỌN badge
- ✅ Task 5: Visibility Mask Toolbar
- ✅ Task 6: Mask mode integration (sourceUrl priority, overlay rendering, mask init)
- ✅ Task 7: Simplify AI mask panel (remove maskEnabled)
- ✅ Task 8: Project save/load v4 + migration + variant cache remap
- ✅ Task 9: AI generation + import flow with cache-first persistence + applySelected rewrite
- ✅ Task 10: CSS styles
- ✅ Task 11: Edge cases & backward compat
- ✅ Task 12: Integration verification

**2. Placeholder scan:** No TBD, TODO, or placeholder patterns.

**3. Type consistency:**
- `LayerVariant` type name used consistently across all tasks
- `addVariantToLayer`, `toggleVariant`, `removeVariantFromLayer`, `updateVariantMask` signatures match between interface definition and implementation
- `variant.resultImageId` used consistently in export, UI, and cache remap
- `visibilityMask.base64Mask`, `.brushSize`, `.brushSoftness` used consistently
- `api.image.saveResultCache()` called BEFORE `addVariantToLayer()` — cache file exists before variant references it
- Preview endpoint reuses `exportImage()` directly → no separate update needed

**4. Critical fixes applied (post-review):**
- ❌→✅ #1: Cache persistence before variant creation (removed broken leaveCanvas migration)
- ❌→✅ #2: sourceUrl prioritizes applied variant's resultImageId
- ❌→✅ #3: Cache remap handles variant resultImageIds in upload-zip
- ❌→✅ #4: Mask mode overlay rendering + existing mask initialization
- ✅ #5: Preview endpoint — verified reuses exportImage, no change needed
- ❌→✅ #6: applySelected rewritten to use variant system instead of direct layer creation
- ❌→✅ #7: applyBase64Mask marked deprecated
