# Spec: Mask System Redesign + Save Project + Export Fix

**Date**: 2026-07-31
**Branch**: `fix/review-and-render-final`
**Status**: Approved

---

## Part A: Mask System in Canvas Edit Mode

### A.1 Current Problems

1. After `leaveCanvas`, `activeLayerId = null` → mask panel disappears
2. When re-entering canvas edit (`openLayerEditor`), saved mask shapes from `layer.maskData` are NOT rendered back onto the Fabric.js canvas — user loses visual reference of their previous strokes
3. "Apply Selected" button only enabled when `selectedVariant` exists (AI result). Pure mask changes don't enable it
4. No eraser tool to remove portions of existing mask shapes
5. `setLayerMask()` auto-triggers re-reproject — should wait for explicit apply

### A.2 Design

#### A.2.1 Mask Panel Location

Mask panel ONLY visible when workflow is `canvas-edit`. Located below layer list in `LayerPanel`. When workflow is `viewing`, mask panel is hidden.

#### A.2.2 Toggles (2 independent toggles)

| Toggle | State Variable | Purpose |
|--------|---------------|---------|
| **Use mask for AI** | `layer.maskForAi` (new, default: true) | When ON → send `base64Mask` to AI (`AiEditRequest.base64Mask`). When OFF → AI generates on full tile (no mask sent) |
| **Apply mask to layer** | `layer.maskEnabled` (existing) | When ON → layer display/render limited to mask region. When OFF → full layer shown |

#### A.2.3 Tools: Brush, Lasso, Eraser (3 tools)

| Tool | Behavior |
|------|----------|
| **Brush** | Draw freehand mask strokes (existing). Red semi-transparent overlay on canvas |
| **Lasso** | Polygon selection (existing). Red semi-transparent fill |
| **Eraser** (NEW) | Brush strokes that erase existing mask areas. Uses Fabric.js `globalCompositeOperation: 'destination-out'` on the mask layer. Works on both brush strokes and lasso polygons (pixel-level erasure) |

#### A.2.4 Mask Shape Management

When entering canvas edit mode, restore shapes from `layer.maskData`:
- For each `MaskShape` with `type: 'brush'`: render Fabric.js path objects
- For each `MaskShape` with `type: 'lasso'`: render Fabric.js Polygon objects
- All shape objects rendered with red semi-transparent fill/stroke (matching current style)

Mask panel shows list of shapes with:
- Label (`Brush 1`, `Lasso 1`, etc.)
- Enable/disable toggle (👁/🚫) — updates `shape.enabled`
- Delete button (🗑) — removes shape from `maskData`

#### A.2.5 Two Apply Buttons in PromptBar

| Button | When Enabled | What It Does |
|--------|-------------|--------------|
| **Generate** | (unchanged) Has prompt + AI model | Calls AI edit, creates variant |
| **Apply AI** | `selectedVariant` exists | Reprojects AI result image + current mask state + equirect buffer → updates layer. Resets variants/selection |
| **Apply Mask** (NEW) | Active layer has `resultImageId` AND there are unapplied mask changes (`maskDirty: true`) | Re-reprojects existing `resultImageId` with current mask state (no AI needed) → updates `equirectImageId` → overlay reflects mask changes. After successful apply → set `maskDirty: false` |

`setLayerMask()` behavior change: only updates store + sets `maskDirty: true`. Does NOT auto-reproject. Must click "Apply Mask" to commit.
`exportMaskShapes()` → on each path:created / mouse:up (lasso) / eraser stroke → sets `maskDirty: true`.
`openLayerEditor()` → initializes `maskDirty: false`.

New store field: `maskDirty: boolean` — tracks whether mask shapes have changed since last apply.

#### A.2.6 Data Flow

```
Canvas Edit Mode UI
├── Toolbar: [Brush] [Lasso] [Eraser] [Undo]
├── Fabric Canvas (image + mask shapes overlaid)
├── LayerPanel (right side)
│   └── Mask Panel (below layers)
│       ├── [✓] Use mask for AI
│       ├── [✓] Apply mask to layer
│       └── Shape list with enable/delete actions
└── PromptBar
    ├── [Generate] (→ AI)
    ├── [Apply AI] (→ reproject with new result)
    └── [Apply Mask] (→ reproject with existing result)
```

#### A.2.7 Types Changes

```typescript
// Layer — add
maskForAi?: boolean;  // default true — controls whether mask is sent to AI

// Types already exist and stay:
// maskEnabled?: boolean — controls display scope
// maskData: MaskShape[] — vector shapes
```

### A.3 Files Modified

| # | File | Changes |
|---|------|---------|
| A1 | `shared/types.ts` | Add `maskForAi?: boolean` to `Layer` |
| A2 | `client/stores/project.ts` | `createPerspectiveLayer`: set `maskForAi: true`. `setLayerMask`: remove auto-reproject. `openLayerEditor`: pass maskData for restore |
| A3 | `client/components/CanvasEditor.tsx` | Add eraser tool. Restore maskData shapes as fabric objects on enter. Expose `exportMaskShapes` as before |
| A4 | `client/components/LayerPanel.tsx` | Mask panel only in `canvas-edit` workflow. Add `maskForAi` toggle. Shape management as existing |
| A5 | `client/components/PromptBar.tsx` | Add "Apply Mask" button. Send `maskForAi` to AI edit request |
| A6 | `client/components/Toolbar.tsx` | Add eraser tool button |
| A7 | `client/stores/workflow.ts` | Add eraser to `ActiveTool` type |
| A8 | `server/routes/image.ts` | Pass `maskForAi` through `/reproject` |

---

## Part B: Save Project — ZIP Bundle

### B.1 Current State

`saveProject()` in `App.tsx` only serializes JSON with `imagePath` (absolute server path). Cannot transfer to another machine.

### B.2 Design

**`.360project` = ZIP archive** containing:

```
project.360project (ZIP)
├── project.json          # metadata with relative paths
├── original.ext           # copy of original image
└── cache/
    ├── <resultImageId>.png
    └── <equirectImageId>.png
```

**project.json** uses relative paths:
```json
{
  "version": 3,
  "imagePath": "original.jpg",
  "layers": [...],
  "horizon": {...}
}
```

### B.3 Save Flow

1. Client calls `POST /api/project/download` with project state (existing layers metadata)
2. Server:
   a. Copy original image into temp dir
   b. Collect all referenced cache files (`resultImageId`, `equirectImageId`)
   c. Create ZIP archive: `project.json` + original + cache files (relative paths)
   d. Stream ZIP to browser (Content-Type: application/zip)
3. Browser downloads ZIP as `.360project`

### B.4 Load Flow

1. User selects `.360project` file via browser
2. Client calls `POST /api/project/upload-zip` (multipart upload)
3. Server:
   a. Extract ZIP to temp dir
   b. Copy original image to CACHE_DIR
   c. Copy cache files to CACHE_DIR
   d. Read `project.json`, map relative paths to new absolute paths
   e. Return project data with resolved paths
4. Client opens project normally with returned data

### B.5 API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/project/download` | POST | Receive project state → create ZIP → stream download |
| `/api/project/upload-zip` | POST | Receive ZIP file → extract → map paths → return project JSON |

### B.6 Client Changes

- `App.tsx`: Update "Download Project" → call `/api/project/download`. Update "Load Project" → call `/api/project/upload-zip`.
- Remove "Save to Server" button (no longer needed with portable format)
- `shared/types.ts`: Bump `ProjectFile.version` to 3

### B.7 Files Modified

| # | File | Changes |
|---|------|---------|
| B1 | `shared/types.ts` | ProjectFile version = 3 |
| B2 | `server/routes/project.ts` | Add `/download` and `/upload-zip` endpoints |
| B3 | `client/lib/api.ts` | Add `api.project.download()` and `api.project.uploadZip()` |
| B4 | `client/App.tsx` | Rewire save/load to new endpoints, remove server-side save |

---

## Part C: Export Final — Fix

### C.1 Root Cause

`POST /api/image/export-download` uses `res.download()` which sets `Content-Disposition: attachment`. When called via `fetch()` (XHR), the browser does NOT auto-download — the `fetch` Promise never resolves properly, causing the request to hang with 0 bytes response.

### C.2 Fix: Revert to Old Mechanism + UI Improvements

**Keep the old mechanism** (`POST /api/image/export` → write server-side file → return JSON `{success, outputPath}`) which works correctly.

**Remove** the broken `POST /api/image/export-download` endpoint and `api.image.exportDownload()` client function.

### C.3 ExportDialog UI

```
┌─────────────────────────────────────┐
│ Export Image                        │
│                                      │
│ Format: [JPEG ▾]                    │
│ Quality: =========● 95%             │
│                                      │
│ Save to:                             │
│ ┌────────────────────────────┐ [📂] │  ← Browse = directory picker
│ │ /home/matrix/Pictures      │      │
│ └────────────────────────────┘      │
│                                      │
│ File name:                           │
│ ┌────────────────────────────┐      │
│ │ panorama_edited            │ .jpg │  ← auto-append extension
│ └────────────────────────────┘      │
│                                      │
│     [Close]  [Export]              │
└─────────────────────────────────────┘

After success: ✅ "Exported to /home/matrix/Pictures/panorama_edited.jpg"
                 [Close]
```

### C.4 Directory Browser

**New endpoint**: `GET /api/filesystem/browse?path=/home/user`

Returns:
```json
{
  "path": "/home/user",
  "parent": "/home",
  "directories": [
    { "name": "Pictures", "path": "/home/user/Pictures" },
    { "name": "Documents", "path": "/home/user/Documents" }
  ]
}
```

Browse button opens a simple modal: current path + list of directories + "Select" button.

### C.5 State Reset

When the ExportDialog closes:
- Reset `done`, `error`, `exporting` state
- Re-initialize `outputDir` and `filename` with defaults
- On next open → clean slate → can export again

### C.6 Files Modified

| # | File | Changes |
|---|------|---------|
| C1 | `server/routes/image.ts` | Remove `/export-download` endpoint |
| C2 | `server/routes/filesystem.ts` (NEW) | Add `GET /browse?path=` endpoint |
| C3 | `server/index.ts` | Mount filesystemRouter at `/api/filesystem` |
| C4 | `client/lib/api.ts` | Remove `exportDownload()`. Add `api.filesystem.browse()` |
| C5 | `client/components/ExportDialog.tsx` | Rewrite UI: directory browser + filename input + reset on close |
| C6 | `client/styles/theme.css` | Directory browser styles |

---

## Implementation Order

1. **Part C first** (Export Fix) — quickest, unblocks user
2. **Part A** (Mask System) — core functionality
3. **Part B** (Save ZIP) — infrastructure change

Each part is independent and can be verified separately.
