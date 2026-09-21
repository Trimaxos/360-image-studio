# Mask System Redesign + Save Project + Export Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/superpowers/specs/2026-07-31-mask-system-save-export-design.md`

**Goal:** Fix export (broken `res.download`), redesign mask system (canvas-edit-only panel, 2 toggles, eraser tool, 2 apply buttons, maskDirty), and implement portable ZIP project save.

**Architecture:** Three independent parts. Part C reverts export to working `POST /image/export` + adds directory browser. Part A moves mask management into canvas-edit workflow with `maskForAi`/`maskEnabled` toggles, eraser tool (vector subtraction via `action: 'subtract'` on MaskShape), separate Apply AI/Apply Mask buttons, and `maskDirty` state tracking. Part B bundles project as ZIP (`.360project` = project.json + original image + cache files) with backward compat for v2 JSON files.

**Adversarial Review:** Plan independently verified against all 16 source files. 7 critical issues found and fixed (see inline annotations). Moderate issues addressed.

**Tech Stack:** React + TypeScript + Zustand + Fabric.js + Express 5 + Sharp + Node.js archiver + adm-zip

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `shared/types.ts` | All shared TypeScript types | Modify |
| `client/stores/project.ts` | Zustand store — layers, tools, workflow state | Modify |
| `client/stores/workflow.ts` | Workflow state machine + permissions | Modify |
| `client/components/CanvasEditor.tsx` | Fabric.js canvas — brush/lasso/eraser tools, mask rendering | Modify |
| `client/components/LayerPanel.tsx` | Right sidebar — layer list + mask panel | Modify |
| `client/components/PromptBar.tsx` | Bottom bar — Generate / Apply AI / Apply Mask buttons | Modify |
| `client/components/Toolbar.tsx` | Left sidebar — tool buttons | Modify |
| `client/components/ExportDialog.tsx` | Export modal — directory browser + filename + reset | Rewrite |
| `client/lib/api.ts` | Client HTTP helpers | Modify |
| `client/lib/mask-utils.ts` | Mask conversion utilities | Modify |
| `client/App.tsx` | Root — save/load project wiring | Modify |
| `client/styles/theme.css` | All styles | Modify |
| `server/routes/image.ts` | Image endpoints — remove /export-download | Modify |
| `server/routes/filesystem.ts` | NEW — directory browser endpoint | Create |
| `server/routes/project.ts` | Project endpoints — add /download, /upload-zip (with v2 fallback) | Modify |
| `server/index.ts` | Express app — mount filesystem router | Modify |
| `server/services/mask-generator.ts` | createMaskFromShapes — add subtraction support | Modify |

---

## Part C: Export Fix (do first — unblocks user)

### Task C1: Rewrite ExportDialog + remove /export-download (single commit — prevents uncompilable intermediate state)

**Files:**
- Modify: `server/routes/image.ts` (remove lines ~198-214, the `/export-download` route)
- Modify: `client/lib/api.ts` (remove `exportDownload` function at lines ~61-62, add `api.filesystem.browse`)
- Modify: `client/components/ExportDialog.tsx` (full rewrite)
- Create: `server/routes/filesystem.ts`
- Modify: `server/index.ts` (mount filesystemRouter)

#### Step 1: Create filesystem browse endpoint

Create [server/routes/filesystem.ts](server/routes/filesystem.ts):

```typescript
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

export const filesystemRouter = Router();

filesystemRouter.get('/browse', async (req, res) => {
  try {
    const targetPath = String(req.query.path || process.env.HOME || '/');
    const resolved = path.resolve(targetPath);

    // Security: prevent traversal outside allowed roots
    const allowedRoots = [process.env.HOME || '/home', '/tmp', '/mnt', '/media', '/Volumes'];
    const isAllowed = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    }

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolved);

    res.json({
      path: resolved,
      parent: parent !== resolved ? parent : null,
      directories,
    });
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return res.status(404).json({ error: `Directory not found: ${err.path || ''}` });
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: err.message });
  }
});
```

> **Fix M6:** Path traversal check uses `resolved === root || resolved.startsWith(root + path.sep)` to prevent `/homeevil` bypass. `EACCES` returns 403 instead of 500.

#### Step 2: Mount filesystem router

In [server/index.ts](server/index.ts):

Add import after line 9:
```typescript
import { filesystemRouter } from './routes/filesystem';
```

Add route after `app.use('/api/project', projectRouter);`:
```typescript
app.use('/api/filesystem', filesystemRouter);
```

#### Step 3: Add client API

In [client/lib/api.ts](client/lib/api.ts):

Remove the broken `exportDownload` function (lines ~61-62):
```typescript
// DELETE:
exportDownload: (body: import('../../shared/types').ExportRequest) =>
  request<Blob>('POST', '/image/export-download', body),
```

Add `filesystem` block after the existing `project` block:
```typescript
  filesystem: {
    browse: (dirPath?: string) =>
      request<{ path: string; parent: string | null; directories: { name: string; path: string }[] }>(
        'GET', `/filesystem/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`,
      ),
  },
```

> **Note:** We do NOT add the `download` / `uploadZip` functions here — that's done in Part B (Task B3).

#### Step 4: Remove /export-download server route

Delete the `/export-download` block from [server/routes/image.ts](server/routes/image.ts) (lines ~198-214):

```typescript
// DELETE this entire block:
imageRouter.post('/export-download', async (req, res) => { ... });
```

#### Step 5: Rewrite ExportDialog with directory browser + reset on close

Replace entire [client/components/ExportDialog.tsx](client/components/ExportDialog.tsx):

```typescript
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;

export default function ExportDialog({ open, onClose }: Props) {
  const imagePath = useProjectStore((s) => s.imagePath);
  const layers = useProjectStore((s) => s.layers);
  const horizon = useProjectStore((s) => s.horizon);

  const [format, setFormat] = useState<typeof FORMATS[number]>('jpeg');
  const [quality, setQuality] = useState(95);
  const [outputDir, setOutputDir] = useState('');
  const [filename, setFilename] = useState('');
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState('');

  // Initialize homeDir from server on first mount
  useEffect(() => {
    api.filesystem.browse().then(r => setHomeDir(r.path)).catch(() => setHomeDir('/tmp'));
  }, []);

  // Reset all state when dialog opens
  useEffect(() => {
    if (!open) return;
    const base = (imagePath?.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'panorama');
    setOutputDir('');
    setFilename(`${base}-edited`);
    setFormat('jpeg');
    setQuality(95);
    setExporting(false);
    setDone(false);
    setError('');
    setBrowseOpen(false);
  }, [open, imagePath]);

  if (!open) return null;

  const defaultName = () => {
    const base = (imagePath?.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'panorama');
    return `${base}-edited`;
  };

  const close = () => {
    setDone(false);
    setError('');
    setExporting(false);
    setBrowseOpen(false);
    onClose();
  };

  const openBrowse = async (initialPath?: string) => {
    setBrowseOpen(true);
    try {
      const result = await api.filesystem.browse(initialPath);
      setBrowsePath(result.path);
      setBrowseDirs(result.directories);
      setBrowseParent(result.parent);
    } catch (err: any) {
      setError(err.message);
      setBrowseOpen(false);
    }
  };

  const navigateTo = async (dirPath: string) => {
    try {
      const result = await api.filesystem.browse(dirPath);
      setBrowsePath(result.path);
      setBrowseDirs(result.directories);
      setBrowseParent(result.parent);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const selectDir = () => {
    setOutputDir(browsePath);
    setBrowseOpen(false);
  };

  const fullPath = () => {
    const name = filename.trim() || defaultName();
    const dir = outputDir || homeDir || '/tmp';
    return `${dir}/${name}.${format}`;
  };

  const handleExport = async () => {
    if (!imagePath) return;
    setExporting(true);
    setError('');
    const outputPath = fullPath();
    try {
      await api.image.export({
        path: imagePath,
        outputPath,
        format,
        quality,
        layers,
        horizon,
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-box" style={{ width: 440 }}>
          <h2>Export Image</h2>

          <div className="modal-row">
            <label>Format:</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="modal-row">
            <label>Quality: {quality}%</label>
            <input type="range" min={1} max={100} value={quality}
              onChange={(e) => setQuality(Number(e.target.value))} />
          </div>

          <div className="modal-row">
            <label>Save to:</label>
            <input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder={homeDir || '/tmp'}
              readOnly
              style={{ cursor: 'pointer' }}
              onClick={() => openBrowse(outputDir || undefined)}
            />
            <button className="modal-btn modal-btn-secondary" onClick={() => openBrowse(outputDir || undefined)}>
              📂
            </button>
          </div>

          <div className="modal-row">
            <label>File name:</label>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={defaultName()}
            />
            <span style={{ color: '#888', fontSize: 12, whiteSpace: 'nowrap' }}>.{format}</span>
          </div>

          {outputDir && filename.trim() && (
            <p style={{ fontSize: 11, color: '#888', marginTop: -4, marginBottom: 8 }}>
              → {fullPath()}
            </p>
          )}

          {done ? (
            <div style={{ marginTop: 16 }}>
              <p style={{ color: '#4caf50', fontSize: 13, marginBottom: 12 }}>
                ✅ Exported to {fullPath()}
              </p>
              <div className="modal-actions">
                <button className="modal-btn modal-btn-primary" onClick={close}>Close</button>
              </div>
            </div>
          ) : (
            <div className="modal-actions">
              <button className="modal-btn modal-btn-secondary" onClick={close}>Cancel</button>
              <button
                className="modal-btn modal-btn-primary"
                disabled={exporting || !outputDir.trim()}
                onClick={() => void handleExport()}
              >
                {exporting ? '⏳ Exporting...' : 'Export'}
              </button>
            </div>
          )}

          {error && <p style={{ color: '#ef5350', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>

      {/* Directory browser modal */}
      {browseOpen && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-box" style={{ width: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <h2>Select Directory</h2>
            <div style={{ marginBottom: 12 }}>
              <button
                className="modal-btn modal-btn-secondary"
                disabled={!browseParent}
                onClick={() => browseParent && navigateTo(browseParent)}
                style={{ marginRight: 8 }}
              >
                ⬆ Up
              </button>
              <span style={{ fontSize: 12, color: '#ccc', wordBreak: 'break-all' }}>{browsePath}</span>
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 12 }}>
              {browseDirs.map((dir) => (
                <div
                  key={dir.path}
                  onClick={() => navigateTo(dir.path)}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 13,
                    color: '#ccc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#0f3460'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  📁 {dir.name}
                </div>
              ))}
              {browseDirs.length === 0 && (
                <p style={{ color: '#888', fontSize: 12, fontStyle: 'italic', padding: 8 }}>No subdirectories</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-secondary" onClick={() => setBrowseOpen(false)}>Cancel</button>
              <button className="modal-btn modal-btn-primary" onClick={selectDir}>Select "{browsePath.split('/').pop()}"</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

> **Fix C6:** `process.env.HOME` removed from browser code. `homeDir` initialized from server's first browse response (server-side `process.env.HOME` provides the value). Fallback to `'/tmp'` if the API call fails.

#### Step 6: Add CSS for readonly input

In [client/styles/theme.css](client/styles/theme.css), add:
```css
.modal-row input[readonly] {
  cursor: pointer;
}
```

#### Step 7: Commit

```bash
git add server/routes/image.ts server/routes/filesystem.ts server/index.ts client/lib/api.ts client/components/ExportDialog.tsx client/styles/theme.css
git commit -m "fix: rewrite ExportDialog with directory browser, remove broken /export-download

- Delete /export-download endpoint (res.download + fetch hangs in Express 5)
- Revert to working POST /api/image/export mechanism
- Add GET /api/filesystem/browse endpoint for directory picker
- Directory browser modal with navigation
- homeDir initialized from server (no process.env in browser)
- All state reset when dialog opens (done, error, exporting, paths)
- Path traversal protection: resolved === root || startsWith(root + sep)
- EACCES handled as 403, not 500

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Part A: Mask System Redesign

### Task A1: Add `maskForAi` to Layer type + `action` to MaskShape type

**Files:**
- Modify: `shared/types.ts`

#### Step 1: Add `maskForAi` to Layer

After `maskEnabled?: boolean;` (line 80), add:
```typescript
  maskForAi?: boolean;   // true = send mask to AI to limit generation scope; default true
```

#### Step 2: Add `action` to MaskShape (for eraser support)

Change `MaskShape` interface (lines 152-160). Add `action` field:

```typescript
export interface MaskShape {
  type: 'brush' | 'rect' | 'lasso';
  id?: string;
  enabled?: boolean;
  action?: 'add' | 'subtract';  // 'add' = include in mask (brush/lasso), 'subtract' = remove from mask (eraser); default 'add'
  points?: { x: number; y: number }[];
  x?: number; y?: number; w?: number; h?: number;
}
```

> **Fix C5:** The `action` field enables vector-based eraser. Eraser strokes produce shapes with `action: 'subtract'`. The mask generator renders add shapes as white, then subtract shapes as black via `dest-out` blend.

#### Step 3: Commit

```bash
git add shared/types.ts
git commit -m "feat: add maskForAi to Layer, action field to MaskShape for eraser support

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A2: Update project store — add maskDirty, widen setLayerMask type, fix leaveCanvas

**Files:**
- Modify: `client/stores/project.ts`

#### Step 1: Add `'eraser'` to ActiveTool type

Line 23, change:
```typescript
export type ActiveTool = 'brush' | 'rect' | 'lasso' | null;
```
to:
```typescript
export type ActiveTool = 'brush' | 'rect' | 'lasso' | 'eraser' | null;
```

#### Step 2: Widen `setLayerMask` patch type to include `maskForAi`

Line 70, change:
```typescript
setLayerMask(id: string, patch: Partial<Pick<Layer, 'maskEnabled' | 'maskData'>>): Promise<void>;
```
to:
```typescript
setLayerMask(id: string, patch: Partial<Pick<Layer, 'maskEnabled' | 'maskData' | 'maskForAi'>>): Promise<void>;
```

> **Fix C4:** Now `setLayerMask(id, { maskForAi: true/false })` type-checks.

#### Step 3: Add `maskDirty` to ProjectState interface and initial value

In the interface (after `getMaskShapes`):
```typescript
  maskDirty: boolean;
```

In initial state (after `getMaskShapes: null,`):
```typescript
  maskDirty: false,
```

#### Step 4: Set `maskForAi: true` in `createPerspectiveLayer`

In `createPerspectiveLayer`, add `maskForAi: true`:
```typescript
      maskEnabled: false,
      maskForAi: true,
```

#### Step 5: Update `setLayerMask` — no auto-reproject, set maskDirty

Replace the `setLayerMask` function body (lines 186-205):
```typescript
  setLayerMask: async (id, patch) => {
    const { layers } = get();
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const next = { ...layer, ...patch };
    set({ layers: layers.map((l) => l.id === id ? next : l), dirty: true, maskDirty: true });
    // Reprojection no longer happens here. User must click "Apply Mask" or "Apply AI".
  },
```

> **Fix M5 partial:** `setLayerMask` now sets `maskDirty: true`. The reproject is removed — user must explicitly apply.

#### Step 6: Initialize `maskDirty: false` in `openLayerEditor`

In `openLayerEditor`, add `maskDirty: false` to the returned object:
```typescript
      dirty: false,
      maskDirty: false,
      generatedVariants: [],
```

#### Step 7: Save mask shapes + maskForAi + reset maskDirty on `leaveCanvas('save')`

Replace the save branch in `leaveCanvas`:
```typescript
        const shapes = get().getMaskShapes?.() ?? [];
        layers = layers.map((layer): Layer => layer.id === state.activeLayerId
          ? {
            ...layer,
            prompt: draft.prompt,
            selection: draft,
            maskData: shapes,
            maskForAi: layer.maskForAi ?? true,
            status: 'committed' as const,
          }
          : layer);
```

And in the return object, add `maskDirty: false`:
```typescript
    return {
      layers,
      selectionDraft,
      workflow: 'viewing',
      activeTool: null,
      activeLayerId: null,
      viewLock: null,
      editSnapshot: null,
      dirty: false,
      maskDirty: false,
      generatedVariants: [],
      selectedVariantId: null,
      previewImage: null,
    };
```

> **Fix M5:** `maskDirty` reset to false on leaveCanvas save AND discard.

#### Step 8: Add `maskDirty: false` to `reset()`

In the `reset` function return object, add:
```typescript
    maskDirty: false,
```

#### Step 9: Commit

```bash
git add client/stores/project.ts
git commit -m "feat: add maskDirty tracking, widen setLayerMask type, eraser tool type

- ActiveTool now includes 'eraser'
- setLayerMask patch type widened to include maskForAi (Fix C4)
- maskDirty flag tracks whether mask shapes changed since last apply
- setLayerMask no longer auto-reprojects — user clicks Apply Mask/Apply AI
- openLayerEditor initializes maskDirty: false
- leaveCanvas(save) saves maskForAi + resets maskDirty
- createPerspectiveLayer sets maskForAi: true by default

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A3: Add eraser to workflow permissions

**Files:**
- Modify: `client/stores/workflow.ts`

#### Step 1: Add `eraser` to WorkflowPermissions

After `lasso: boolean;`, add:
```typescript
  eraser: boolean;
```

#### Step 2: Enable eraser in canvas-edit and ai-review

Change the permission returns:
```typescript
    brush: state === 'canvas-edit' || state === 'ai-review',
    lasso: state === 'canvas-edit' || state === 'ai-review',
    eraser: state === 'canvas-edit' || state === 'ai-review',
    undo: state === 'canvas-edit' || state === 'ai-review',
```

#### Step 3: Commit

```bash
git add client/stores/workflow.ts
git commit -m "feat: add eraser to workflow permissions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A4: Add eraser tool button to Toolbar

**Files:**
- Modify: `client/components/Toolbar.tsx`

#### Step 1: Add eraser to tools array

After the lasso tool entry, add:
```typescript
    { id: 'eraser' as const, icon: '⌫', label: 'Eraser', enabled: permission.eraser },
```

#### Step 2: Commit

```bash
git add client/components/Toolbar.tsx
git commit -m "feat: add eraser tool button to toolbar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A5: Update mask-utils.ts — preserve shape IDs, handle eraser action

**Files:**
- Modify: `client/lib/mask-utils.ts`

#### Step 1: Update `fabricToMaskData` to preserve stable IDs and eraser action

Replace the `fabricToMaskData` function body (lines 48-87):

```typescript
export function fabricToMaskData(
  fabricCanvas: any,
  transform?: (p: { x: number; y: number }) => { x: number; y: number },
): SharedMaskShape[] {
  const t = transform ?? ((p: { x: number; y: number }) => p);
  const shapes: SharedMaskShape[] = [];
  const objects = fabricCanvas.getObjects();

  for (const obj of objects) {
    if (obj.type === 'path') {
      shapes.push({
        type: 'brush',
        id: (obj as any)._shapeId || crypto.randomUUID(),
        enabled: true,
        action: (obj as any)._maskAction === 'subtract' ? 'subtract' : 'add',
        points: obj.path?.map((p: any) => t({ x: p[1], y: p[2] })) ?? [],
      });
    } else if (obj.type === 'polygon') {
      shapes.push({
        type: 'lasso',
        id: (obj as any)._shapeId || crypto.randomUUID(),
        enabled: true,
        action: (obj as any)._maskAction === 'subtract' ? 'subtract' : 'add',
        points: obj.points?.map((p: any) => t({ x: p.x, y: p.y })) ?? [],
      });
    } else if (obj.type === 'rect') {
      const tl = t({ x: obj.left, y: obj.top });
      shapes.push({
        type: 'rect',
        id: (obj as any)._shapeId || crypto.randomUUID(),
        enabled: true,
        x: tl.x, y: tl.y,
        w: obj.width! * obj.scaleX!,
        h: obj.height! * obj.scaleY!,
      });
    }
  }

  return shapes;
}
```

> **Fix C5:** Eraser paths tagged with `_maskAction: 'subtract'` produce `action: 'subtract'` in the MaskShape.
> **Fix M1:** Stable shape IDs preserved via `_shapeId` on fabric objects. When restoring shapes, the original `shape.id` is stored on the fabric object.

#### Step 2: Add `createWhiteMask` helper (for maskForAi off → full image generation)

Add after `fabricToMaskData`:
```typescript
/**
 * Generate a solid white mask at the given dimensions.
 * Used when maskForAi is OFF — white mask = AI regenerates entire tile.
 */
export function createWhiteMask(width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return Promise.resolve(canvas.toDataURL('image/png').split(',')[1]);
}
```

> **Fix C1:** This provides the "full image" mask when maskForAi is off, instead of sending an empty string.

#### Step 3: Commit

```bash
git add client/lib/mask-utils.ts
git commit -m "feat: preserve shape IDs, add eraser action, add createWhiteMask helper

- fabricToMaskData preserves _shapeId from fabric objects for stable identity
- Eraser strokes produce action:'subtract', brush/lasso produce action:'add'
- createWhiteMask generates full-white PNG for maskForAi=off generation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A6: Update CanvasEditor — eraser, restore shapes with stable IDs, maskDirty on changes

**Files:**
- Modify: `client/components/CanvasEditor.tsx`

#### Step 1: Add `Path` to Fabric dynamic import

Line 54, change:
```typescript
    import('fabric').then(async ({ Canvas, FabricImage, PencilBrush, Polygon, Polyline }) => {
```
to:
```typescript
    import('fabric').then(async ({ Canvas, FabricImage, Path, PencilBrush, Polygon, Polyline }) => {
```

#### Step 2: Restore saved mask shapes from layer.maskData (with stable IDs)

After `setSourceStatus('ready')` (after line 79), add shape restoration:

```typescript
      // Restore saved mask shapes from layer data
      const savedShapes = activeLayer?.maskData ?? [];
      if (savedShapes.length > 0) {
        const fromNative = (p: { x: number; y: number }) => ({
          x: p.x * scale + image.left!,
          y: p.y * scale + image.top!,
        });
        for (const shape of savedShapes) {
          if (shape.enabled === false) continue;
          if (shape.type === 'brush' && shape.points && shape.points.length > 0) {
            const canvasPoints = shape.points.map(fromNative);
            if (canvasPoints.length >= 2) {
              const d = canvasPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const pathObj = new Path(d, {
                stroke: 'rgba(233,69,96,.55)',
                strokeWidth: 24,
                fill: 'transparent',
                selectable: false,
                evented: false,
              }) as any;
              pathObj._shapeId = shape.id; // stable ID for merge
              canvas.add(pathObj);
            }
          } else if (shape.type === 'lasso' && shape.points && shape.points.length >= 3) {
            const canvasPoints = shape.points.map(fromNative);
            const polygon = new Polygon(canvasPoints, {
              fill: 'rgba(233,69,96,.38)',
              stroke: '#e94560',
              strokeWidth: 2,
              selectable: false,
              evented: false,
            }) as any;
            polygon._shapeId = shape.id; // stable ID for merge
            canvas.add(polygon);
          }
        }
        canvas.requestRenderAll();
      }
```

> **Fix M1:** Each restored fabric object gets `_shapeId = shape.id` for stable identity across save/load cycles.

#### Step 3: Add eraser to drawing mode + tag eraser paths + set maskDirty

Replace the `useEffect` for `activeTool` (lines 231-237):

```typescript
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
    if (canvas.freeDrawingBrush) {
      if (state.activeTool === 'eraser') {
        canvas.freeDrawingBrush.color = 'rgba(255,100,100,0.7)';
        canvas.freeDrawingBrush.width = 40;
      } else if (state.activeTool === 'lasso') {
        canvas.freeDrawingBrush.width = 3;
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
      } else {
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
        canvas.freeDrawingBrush.width = 24;
      }
    }
    // Tag eraser paths so fabricToMaskData can set action:'subtract'
    const isEraser = state.activeTool === 'eraser';
    const onPathCreated = (e: any) => {
      if (isEraser && e.path) {
        e.path._maskAction = 'subtract';
      }
    };
    canvas.on('path:created', onPathCreated);
    return () => {
      canvas.off('path:created', onPathCreated);
    };
  }, [state.activeTool]);
```

> **Fix C5:** Eraser strokes tagged with `_maskAction: 'subtract'` instead of using `destination-out` on contextTop (which never worked for vector masks). The visual appearance during drawing uses a reddish tint (`rgba(255,100,100,0.7)`) to distinguish eraser from brush.

#### Step 4: Update `path:created` handler to check for eraser + set maskDirty

Update the existing `path:created` handler (around line 130):
```typescript
      canvas.on('path:created', (e: any) => {
        const current = useProjectStore.getState();
        if (current.selectionDraft) {
          current.setSelectionDraft({
            ...current.selectionDraft,
            maskBase64: exportMask(),
          });
        }
        current.markDirty();
        useProjectStore.setState({ maskDirty: true });
      });
```

#### Step 5: Set maskDirty on lasso mouse:up

In the lasso `mouse:up` handler (around line 173), after the polygon add:
```typescript
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
```

#### Step 6: Set maskDirty on undo

In the `undo` function (around line 185), after removing the object:
```typescript
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
```

#### Step 7: Commit

```bash
git add client/components/CanvasEditor.tsx
git commit -m "feat: eraser tool with vector subtraction, restore mask shapes with stable IDs

- Eraser uses _maskAction:'subtract' tagging (NOT destination-out)
- Restore saved mask shapes as Fabric objects with _shapeId for stable identity
- Set maskDirty:true on brush stroke, lasso close, and undo
- Eraser brush color visually distinct (reddish) from regular brush
- Path imported from Fabric for shape restoration

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A7: Update mask-generator — support subtraction shapes

**Files:**
- Modify: `server/services/mask-generator.ts`

#### Step 1: Add subtraction support to `createMaskFromShapes`

Replace `createMaskFromShapes` body:

```typescript
export async function createMaskFromShapes(
  shapes: MaskShape[],
  width: number,
  height: number
): Promise<Buffer> {
  const active = shapes.filter((s) => s.enabled !== false);
  const addShapes = active.filter((s) => s.action !== 'subtract');
  const subShapes = active.filter((s) => s.action === 'subtract');

  // 1. Render additive shapes as white on transparent
  const addSvgParts: string[] = [];
  for (const shape of addShapes) {
    if (shape.type === 'brush' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      addSvgParts.push(
        `<polyline points="${pts}" fill="none" stroke="white" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`
      );
    } else if (shape.type === 'rect') {
      addSvgParts.push(
        `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="white" opacity="1"/>`
      );
    } else if (shape.type === 'lasso' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      addSvgParts.push(
        `<polygon points="${pts}" fill="white" opacity="1"/>`
      );
    }
  }

  // 2. Render subtractive shapes as white on transparent (will be used with dest-out)
  const subSvgParts: string[] = [];
  for (const shape of subShapes) {
    if (shape.type === 'brush' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      subSvgParts.push(
        `<polyline points="${pts}" fill="none" stroke="white" stroke-width="25" stroke-linecap="round" stroke-linejoin="round" opacity="1"/>`
      );
    } else if (shape.type === 'lasso' && shape.points) {
      const pts = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      subSvgParts.push(
        `<polygon points="${pts}" fill="white" opacity="1"/>`
      );
    }
  }

  const svgW = Math.round(width);
  const svgH = Math.round(height);

  // Render additive mask
  const addSvg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${addSvgParts.join('')}</svg>`;
  let maskBuffer = await sharp({
    create: {
      width: svgW,
      height: svgH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: Buffer.from(addSvg), blend: 'over' }])
    .png()
    .toBuffer();

  // Apply subtractive shapes via dest-out
  if (subSvgParts.length > 0) {
    const subSvg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">${subSvgParts.join('')}</svg>`;
    const subBuffer = await sharp({
      create: {
        width: svgW,
        height: svgH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: Buffer.from(subSvg), blend: 'over' }])
      .png()
      .toBuffer();

    maskBuffer = await sharp(maskBuffer)
      .composite([{ input: subBuffer, blend: 'dest-out' }])
      .png()
      .toBuffer();
  }

  return maskBuffer;
}
```

> **Fix C5:** Subtraction shapes rendered as white on transparent, then applied via `dest-out` blend to remove those areas from the additive mask. This gives us proper eraser functionality with vector masks.

#### Step 2: Commit

```bash
git add server/services/mask-generator.ts
git commit -m "feat: add eraser subtraction support to createMaskFromShapes

- Additive shapes (brush/lasso) rendered as white on transparent
- Subtractive shapes (eraser) applied via dest-out blend
- Active shapes filtered: enabled !== false

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A8: Update LayerPanel — mask panel only in canvas-edit, add maskForAi toggle

**Files:**
- Modify: `client/components/LayerPanel.tsx`

#### Step 1: Gate mask panel on canvas-edit workflow

Line 53, change:
```typescript
      {activeLayer && (
```
to:
```typescript
      {activeLayer && state.workflow === 'canvas-edit' && (
```

#### Step 2: Add `maskForAi` toggle above existing `maskEnabled` toggle

After `<div className="mask-panel">`, add before the existing `maskEnabled` toggle:

```typescript
          <label className="mask-toggle-row" title="When ON, mask shapes are sent to AI to limit generation scope. When OFF, AI generates on the full tile.">
            <input
              type="checkbox"
              checked={activeLayer.maskForAi !== false}
              onChange={(e) => { void state.setLayerMask(activeLayer.id, { maskForAi: e.target.checked }); }}
            />
            Use mask for AI
          </label>
```

#### Step 3: Commit

```bash
git add client/components/LayerPanel.tsx
git commit -m "feat: gate mask panel on canvas-edit, add maskForAi toggle

Mask panel only visible in canvas-edit workflow.
New 'Use mask for AI' toggle controls whether mask is sent to AI generation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A9: Update PromptBar — Apply Mask button, maskForAi in generate, fix C1 + C3

**Files:**
- Modify: `client/components/PromptBar.tsx`

#### Step 1: Declare `activeLayer` at component scope

After `const selectedVariant = ...`, add:
```typescript
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
```

> **Fix C3:** `activeLayer` is now declared at component scope, available in JSX.

#### Step 2: Update `generate()` to respect `maskForAi`, fix empty mask issue

Replace the `generate` function (lines 21-66):

```typescript
  const generate = async () => {
    const selection = state.selectionDraft;
    const model = state.selectedModel;
    const mask = state.getMaskBase64?.();
    if (!selection || !state.imagePath || !model || !prompt.trim()) return;

    const useMaskForAi = activeLayer?.maskForAi !== false; // default true

    // When maskForAi is on, mask is required. When off, we generate a full-white mask.
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

      // When maskForAi is off, create a full-white mask (AI regenerates entire tile)
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

Add import for `createWhiteMask` at top:
```typescript
import { blobToBase64, createWhiteMask } from '../lib/mask-utils';
```

> **Fix C1:** When `maskForAi` is off, `generate()` creates a full-white mask via `createWhiteMask()` instead of sending an empty string. Server always receives a valid non-empty mask. Guard clause `if (useMaskForAi && !mask) return` only requires mask when maskForAi is ON.

#### Step 3: Update `applySelected` to save `maskForAi` and reset `maskDirty`

In the `applySelected` function, add `maskForAi` to the layer object (around line 100):
```typescript
        maskData: shapes,
        maskEnabled,
        maskForAi: existing?.maskForAi ?? true,
```

And in the `useProjectStore.setState` after apply (line 110-116), add `maskDirty: false`:
```typescript
      useProjectStore.setState({
        activeLayerId: layer.id,
        workflow: 'canvas-edit',
        dirty: false,
        maskDirty: false,
        generatedVariants: [],
        selectedVariantId: null,
      });
```

> **Fix M5:** maskDirty reset after successful apply.

#### Step 4: Add `applyMaskOnly` function

After `applySelected`, add:

```typescript
  const applyMaskOnly = async () => {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    const selection = state.selectionDraft;
    if (!layer?.resultImageId || !state.imagePath || !selection) return;
    if (!state.maskDirty) return;
    setError('');
    state.setWorkflow('generating');
    try {
      // Merge canvas shapes with stored enable/disable state
      const canvasShapes = state.getMaskShapes?.() ?? [];
      const storedShapes = layer.maskData ?? [];
      const storedMap = new Map(storedShapes.map((s) => [s.id, s]));

      // Canvas shapes get their geometry, but inherit enabled state from stored
      const merged = canvasShapes.map((cs) => ({
        ...cs,
        enabled: storedMap.get(cs.id)?.enabled ?? cs.enabled ?? true,
      }));

      // Also preserve stored shapes that are disabled (not rendered on canvas)
      for (const ss of storedShapes) {
        if (ss.enabled === false && !merged.find((m) => m.id === ss.id)) {
          merged.push(ss);
        }
      }

      const maskEnabled = layer.maskEnabled ?? false;
      if (selection.sourceView === '360') {
        const reprojResult = await api.image.reproject({
          resultImageId: layer.resultImageId,
          selection,
          imagePath: state.imagePath,
          maskEnabled,
          maskData: merged.filter((s) => s.enabled !== false),
        });
        state.updateLayer(layer.id, {
          equirectImageId: reprojResult.equirectImageId,
          maskData: merged,
          maskEnabled,
        });
      } else {
        state.updateLayer(layer.id, { maskData: merged, maskEnabled });
      }
      useProjectStore.setState({ maskDirty: false, workflow: 'canvas-edit' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply mask thất bại');
      state.setWorkflow('canvas-edit');
    }
  };
```

> **Fix M1:** Merges canvas shapes (geometry) with stored shapes (enabled state + ID). Disabled shapes that aren't on canvas are preserved. Stable IDs via `_shapeId` ensure correct matching.

#### Step 5: Add "Apply Mask" button in JSX

After the "Apply Selected" button, add:

```typescript
      {permission.ai && (
        <button
          className="prompt-btn prompt-btn-apply"
          disabled={!activeLayer?.resultImageId || !state.maskDirty}
          onClick={() => void applyMaskOnly()}
          style={{ background: state.maskDirty ? '#0d7377' : undefined }}
        >
          Apply Mask
        </button>
      )}
```

> **Fix C3:** Uses `activeLayer` from component scope (declared in Step 1).

#### Step 6: Commit

```bash
git add client/components/PromptBar.tsx
git commit -m "feat: add Apply Mask button, respect maskForAi in generate, fix empty mask

- New 'Apply Mask' button re-reprojects with current mask (no AI needed)
- Enabled when activeLayer has resultImageId AND maskDirty is true
- maskForAi toggle respected: OFF → createWhiteMask() for full image gen (Fix C1)
- applySelected saves maskForAi + resets maskDirty (Fix M5)
- applyMaskOnly merges canvas geometry with stored enable/disable state (Fix M1)
- activeLayer declared at component scope (Fix C3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Part B: Save Project — ZIP Bundle

### Task B1: Bump ProjectFile version to 3

**Files:**
- Modify: `shared/types.ts` (line ~191)

#### Step 1: Change version

```typescript
  version: 3;
```

#### Step 2: Commit

```bash
git add shared/types.ts
git commit -m "feat: bump ProjectFile version to 3 for ZIP bundle format

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B2: Add ZIP download + upload (with v2 fallback) endpoints

**Files:**
- Modify: `server/routes/project.ts`

#### Step 1: Install dependencies

```bash
npm install archiver adm-zip
npm install -D @types/archiver @types/adm-zip
```

#### Step 2: Add imports

In [server/routes/project.ts](server/routes/project.ts), add at the top:
```typescript
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'crypto';
```

#### Step 3: Add `POST /project/download` endpoint

After the `/save` handler:

```typescript
// Download project as ZIP bundle (.360project)
projectRouter.post('/download', async (req, res) => {
  try {
    const { project } = req.body as { project: ProjectFile };
    if (!project?.imagePath) return res.status(400).json({ error: 'project with imagePath is required' });

    await fs.access(project.imagePath);

    const tmpDir = path.join(CACHE_DIR, `project-zip-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Copy original image
    const origExt = path.extname(project.imagePath);
    const origCopy = path.join(tmpDir, `original${origExt}`);
    await fs.copyFile(project.imagePath, origCopy);

    // Collect referenced cache files
    const cacheDir = path.join(tmpDir, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const seen = new Set<string>();
    for (const layer of project.layers) {
      for (const id of [layer.resultImageId, layer.equirectImageId]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const src = path.join(CACHE_DIR, `${id}.png`);
        try {
          await fs.access(src);
          await fs.copyFile(src, path.join(cacheDir, `${id}.png`));
        } catch { /* skip missing cache files */ }
      }
    }

    // Write project.json with relative paths
    const projectJson: ProjectFile = {
      ...project,
      version: 3,
      imagePath: `original${origExt}`,
    };
    await fs.writeFile(
      path.join(tmpDir, 'project.json'),
      JSON.stringify(projectJson, null, 2),
      'utf-8',
    );

    // Stream ZIP to client
    const baseName = path.basename(project.imagePath, origExt);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.360project"`);

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
    archive.pipe(res);
    archive.directory(tmpDir, false);
    await archive.finalize();

    // Cleanup temp dir
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});
```

> **Fix M2:** Archive error handled with `res.headersSent` check — no `throw` in event handler.

#### Step 4: Add `POST /project/upload-zip` with v2 JSON fallback

Add a new multer instance for ZIP/project uploads (after the existing `projectUpload`):

```typescript
const zipUpload = multer({
  storage: multer.diskStorage({
    destination: CACHE_DIR,
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `project-zip-${timestamp}-${safeName}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});
```

Then add the endpoint:

```typescript
// Upload .360project (ZIP v3 or JSON v2) — extract, map paths, return project
projectRouter.post('/upload-zip', zipUpload.single('project'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No project file provided' });

    // Detect format: ZIP files start with "PK" magic bytes
    const header = await fs.readFile(req.file.path, { length: 2 });
    const isZip = header[0] === 0x50 && header[1] === 0x4b;

    if (!isZip) {
      // v2 JSON fallback — read as plain JSON
      const data = await fs.readFile(req.file.path, 'utf-8');
      const project = JSON.parse(data) as ProjectFile;
      if (project.version !== 2) {
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
      }
      try {
        await fs.access(project.imagePath);
      } catch {
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({
          error: `Project references image that doesn't exist: ${project.imagePath}`,
        });
      }
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.json({ project });
    }

    // v3 ZIP extraction
    const extractDir = path.join(CACHE_DIR, `project-extract-${randomUUID()}`);
    await fs.mkdir(extractDir, { recursive: true });

    // Extract ZIP using adm-zip (no shell, cross-platform)
    const zip = new AdmZip(req.file.path);

    // Zip-slip protection: validate all entry paths
    const entries = zip.getEntries();
    for (const entry of entries) {
      const resolved = path.resolve(extractDir, entry.entryName);
      if (!resolved.startsWith(extractDir + path.sep) && resolved !== extractDir) {
        await fs.rm(extractDir, { recursive: true, force: true });
        await fs.unlink(req.file.path).catch(() => undefined);
        return res.status(400).json({ error: `Invalid zip entry path: ${entry.entryName}` });
      }
    }

    zip.extractAllTo(extractDir, true);

    // Read project.json
    const projectData = await fs.readFile(path.join(extractDir, 'project.json'), 'utf-8');
    const project = JSON.parse(projectData) as ProjectFile;

    if (project.version < 2 || project.version > 3) {
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }

    // Copy original image to CACHE_DIR
    const origPath = path.resolve(extractDir, project.imagePath);
    // Validate no traversal
    if (!origPath.startsWith(extractDir + path.sep) && origPath !== extractDir) {
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: 'Invalid imagePath in project.json' });
    }
    const origExt = path.extname(project.imagePath);
    const newOrigPath = path.join(CACHE_DIR, `original-${randomUUID()}${origExt}`);
    await fs.copyFile(origPath, newOrigPath);

    // Copy cache files to CACHE_DIR and build path map
    const cacheMap = new Map<string, string>();
    const extractCache = path.join(extractDir, 'cache');
    try {
      const cacheFiles = await fs.readdir(extractCache);
      for (const file of cacheFiles) {
        if (!file.endsWith('.png')) continue;
        const oldId = path.basename(file, '.png');
        const buffer = await fs.readFile(path.join(extractCache, file));
        const newId = createHash('sha256').update(buffer).digest('hex');
        await fs.writeFile(path.join(CACHE_DIR, `${newId}.png`), buffer);
        cacheMap.set(oldId, newId);
      }
    } catch { /* no cache dir — fine */ }

    // Remap layer cache IDs
    const layers = project.layers.map((layer) => ({
      ...layer,
      resultImageId: cacheMap.get(layer.resultImageId) || layer.resultImageId,
      equirectImageId: layer.equirectImageId
        ? (cacheMap.get(layer.equirectImageId) || layer.equirectImageId)
        : undefined,
    }));

    // Cleanup
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.unlink(req.file.path).catch(() => undefined);

    res.json({
      project: { ...project, imagePath: newOrigPath, layers },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

> **Fix C2:** Cache IDs remapped using `createHash('sha256').update(buffer).digest('hex')` → 64-char hex, matches cache route regex `/^[a-f0-9]{64}$/`.
> **Fix M3:** `adm-zip` replaces `execSync('unzip')` — no shell, cross-platform, with zip-slip protection.
> **Fix M4:** Magic byte detection (`PK`) for ZIP vs plain JSON fallback — v2 projects still load.

#### Step 5: Commit

```bash
git add server/routes/project.ts package.json package-lock.json
git commit -m "feat: add /project/download and /upload-zip with v2 fallback

- POST /project/download: bundles project.json + original + cache/ as ZIP
- POST /project/upload-zip: extracts ZIP, copies files, remaps cache IDs
- Cache ID remapping uses SHA256 hash (64-char hex, matches cache regex) (Fix C2)
- adm-zip replaces execSync('unzip') with zip-slip protection (Fix M3)
- Magic byte detection for v2 JSON fallback (Fix M4)
- Archive error handling without throw (Fix M2)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B3: Add download/uploadZip client API functions

**Files:**
- Modify: `client/lib/api.ts`

#### Step 1: Replace existing `project` block

Replace the current `project` block (lines ~83-99):

```typescript
  project: {
    // Download project as ZIP bundle (.360project)
    download: async (projectState: any): Promise<Blob> => {
      const res = await fetch(`${BASE}/project/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectState }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.blob();
    },
    // Upload .360project (ZIP v3 or JSON v2) — auto-detected by server
    uploadZip: async (file: File): Promise<{ project: any }> => {
      const formData = new FormData();
      formData.append('project', file);
      const res = await fetch(`${BASE}/project/upload-zip`, { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
  },
```

> **Note:** The old `/project/upload`, `/project/load`, `/project/save` endpoints and their client functions are removed. All project I/O goes through `/download` and `/upload-zip` only. Backward compat handled server-side via magic byte detection.

#### Step 2: Commit

```bash
git add client/lib/api.ts
git commit -m "feat: add api.project.download() and uploadZip() client functions

Replace old save/load/upload with ZIP-based download/uploadZip.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B4: Rewire App.tsx save/load to use ZIP endpoints

**Files:**
- Modify: `client/App.tsx`

#### Step 1: Update `saveProject` to use ZIP download

Replace `saveProject` (lines ~37-51):
```typescript
  const saveProject = useCallback(async () => {
    const current = useProjectStore.getState();
    if (!current.imagePath) return;
    const project = {
      version: 3,
      imagePath: current.imagePath,
      layers: current.layers,
      horizon: current.horizon,
    };
    try {
      const zipBlob = await api.project.download(project);
      const base = current.imagePath.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'project';
      downloadBlob(zipBlob, `${base}.360project`);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    }
  }, []);
```

#### Step 2: Update `loadProject` to use ZIP upload

Replace `loadProject` (lines ~66-71):
```typescript
  const loadProject = useCallback(async (file: File) => {
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      useProjectStore.getState().openImage(project.imagePath, meta.width, meta.height);
      useProjectStore.setState({
        layers: project.layers ?? [],
        horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 },
      });
      setFileSize(meta.sizeBytes);
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    }
  }, []);
```

#### Step 3: Remove `saveProjectServer` and its button

Delete `saveProjectServer` function (lines ~53-64).

In the File menu, remove:
```typescript
            <button disabled={!state.imagePath} onClick={() => void saveProjectServer()}>💿 Save to Server</button>
```

#### Step 4: Commit

```bash
git add client/App.tsx
git commit -m "feat: switch save/load to ZIP bundle with download/upload-zip

- Save: downloads .360project ZIP containing project.json + original + cache
- Load: uploads ZIP (or v2 JSON), server auto-detects format
- Remove 'Save to Server' button
- Bump ProjectFile version to 3

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Checklist

### Part C — Export
1. Open Export dialog → sees directory input + Browse button + filename input
2. Click Browse → directory picker modal shows home dir, can navigate
3. Select directory + enter filename → Export button enabled
4. Click Export → exports to server path, shows "✅ Exported to ..." message
5. Click Close → dialog closes
6. Re-open Export dialog → clean state, can export again
7. Directory browser rejects paths outside allowed roots (e.g., `/etc`)

### Part A — Mask System
1. Enter canvas edit mode → LayerPanel shows mask panel with "Use mask for AI" + "Apply mask to layer" toggles
2. Switch to View mode → mask panel hidden
3. Draw brush strokes → maskDirty=true (Apply Mask button highlights)
4. Click "Apply Mask" (no AI result) → reprojects, maskDirty=false
5. Uncheck "Use mask for AI" → Generate → AI gets full-white mask (full image generation, no 400 error)
6. Switch to Eraser tool → draw → eraser strokes tagged as subtract → applied correctly in mask
7. Draw lasso → undo → maskDirty stays true
8. Back to View → re-enter edit → previous mask shapes restored on canvas with stable IDs
9. Toggle shape off in mask panel → Apply Mask → toggle state preserved (not reset)
10. Deleted shapes in panel stay gone after apply

### Part B — Save/Load
1. Download Project → browser downloads `.360project` ZIP file
2. Open downloaded `.360project` on same machine → project loads with all layers and cache
3. v2 `.360project` JSON files still load via magic byte fallback
4. Cache IDs remapped to valid 64-char hex format → no 400 errors
5. All layer resultImageId/equirectImageId URLs work after load
