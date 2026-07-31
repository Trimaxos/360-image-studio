# Mask System Redesign + Save Project + Export Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/superpowers/specs/2026-07-31-mask-system-save-export-design.md`

**Goal:** Fix export (broken `res.download`), redesign mask system (canvas-edit-only panel, 2 toggles, eraser tool, 2 apply buttons, maskDirty), and implement portable ZIP project save.

**Architecture:** Three independent parts. Part C reverts export to working `POST /image/export` + adds directory browser. Part A moves mask management entirely into canvas-edit workflow with `maskForAi`/`maskEnabled` toggles, eraser tool, separate Apply AI/Apply Mask buttons, and `maskDirty` state tracking. Part B bundles project as ZIP (`.360project` = project.json + original image + cache files) for cross-machine portability.

**Tech Stack:** React + TypeScript + Zustand + Fabric.js + Express 5 + Sharp + Node.js archiver/adm-zip

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
| `client/lib/mask-utils.ts` | Mask conversion utilities (fabricToMaskData) | No change needed |
| `client/App.tsx` | Root — save/load project wiring | Modify |
| `client/styles/theme.css` | All styles | Modify |
| `server/routes/image.ts` | Image endpoints — remove /export-download | Modify |
| `server/routes/filesystem.ts` | NEW — directory browser endpoint | Create |
| `server/routes/project.ts` | Project endpoints — add /download, /upload-zip | Modify |
| `server/index.ts` | Express app — mount filesystem router | Modify |
| `server/services/image-processor.ts` | exportImage — no changes needed | No change |
| `server/services/perspective-projector.ts` | reprojectToEquirectangular — no changes needed | No change |

---

## Part C: Export Fix (do first — unblocks user)

### Task C1: Remove broken /export-download endpoint and client function

**Files:**
- Modify: `server/routes/image.ts:198-214`
- Modify: `client/lib/api.ts:61-62`

- [ ] **Step 1: Remove `/export-download` route from server**

Delete lines 198-214 in [server/routes/image.ts](server/routes/image.ts):

```typescript
// DELETE these lines:
// Export then stream to browser as download — no server-side path required
imageRouter.post('/export-download', async (req, res) => {
  try {
    const body = req.body as ExportRequest;
    if (!body.path) return res.status(400).json({ error: 'path is required' });
    const format = body.format || 'png';
    const outFile = path.join(CACHE_DIR, `export-${randomUUID()}.${format}`);
    await exportImage(body.path, outFile, format, body.quality ?? 95, body.layers, body.horizon);
    const fallback = `panorama_edited.${format}`;
    const filename = (body.outputPath && path.basename(body.outputPath)) || fallback;
    res.download(outFile, filename, () => {
      fs.unlink(outFile).catch(() => undefined);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Remove `exportDownload()` from client API**

Delete lines 61-62 in [client/lib/api.ts](client/lib/api.ts):

```typescript
// DELETE these lines:
exportDownload: (body: import('../../shared/types').ExportRequest) =>
  request<Blob>('POST', '/image/export-download', body),
```

- [ ] **Step 3: Verify old export still works**

Run: `curl -s -X POST http://localhost:3001/api/image/export -H "Content-Type: application/json" -d '{"path":"/tmp/test.jpg","outputPath":"/tmp/test-out.jpg","format":"jpeg","quality":90,"layers":[],"horizon":{"yaw":0,"pitch":0,"roll":0}}'`
Expected: `{"success":true,"outputPath":"/tmp/test-out.jpg"}`

- [ ] **Step 4: Commit**

```bash
git add server/routes/image.ts client/lib/api.ts
git commit -m "fix: remove broken /export-download endpoint and client function

The res.download() + fetch() combination hangs in Express 5 because
Content-Disposition: attachment causes the fetch Promise to never resolve.
Reverting to the working POST /image/export mechanism.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task C2: Create filesystem browse endpoint

**Files:**
- Create: `server/routes/filesystem.ts`

- [ ] **Step 1: Create the filesystem router**

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
    const isAllowed = allowedRoots.some((root) => resolved.startsWith(root));
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
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/filesystem.ts
git commit -m "feat: add GET /api/filesystem/browse endpoint for directory picker

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task C3: Mount filesystem router in Express app

**Files:**
- Modify: `server/index.ts:8-9,21-23`

- [ ] **Step 1: Import and mount filesystemRouter**

In [server/index.ts](server/index.ts):

Add import after line 9:
```typescript
import { filesystemRouter } from './routes/filesystem';
```

Add route after line 23 (`app.use('/api/project', projectRouter);`):
```typescript
app.use('/api/filesystem', filesystemRouter);
```

- [ ] **Step 2: Verify endpoint works**

Run server: `npm run server` (or restart if already running)
Run: `curl -s http://localhost:3001/api/filesystem/browse?path=/home | jq`
Expected: JSON with `{ path, parent, directories: [...] }`

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount filesystem router at /api/filesystem

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task C4: Add client API for filesystem browse

**Files:**
- Modify: `client/lib/api.ts:98-99`

- [ ] **Step 1: Add `api.filesystem.browse()`**

In [client/lib/api.ts](client/lib/api.ts), add after the `project` block (after line 98 `},`):

```typescript
  filesystem: {
    browse: (dirPath?: string) =>
      request<{ path: string; parent: string | null; directories: { name: string; path: string }[] }>(
        'GET', `/filesystem/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`,
      ),
  },
```

- [ ] **Step 2: Commit**

```bash
git add client/lib/api.ts
git commit -m "feat: add api.filesystem.browse() client function

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task C5: Rewrite ExportDialog with directory browser + reset on close

**Files:**
- Modify: `client/components/ExportDialog.tsx`

- [ ] **Step 1: Rewrite ExportDialog component**

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
    const dir = outputDir || process.env.HOME || '/tmp';
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
              placeholder={process.env.HOME || '/tmp'}
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

- [ ] **Step 2: Commit**

```bash
git add client/components/ExportDialog.tsx
git commit -m "fix: rewrite ExportDialog with directory browser and state reset on close

- Revert to working POST /api/image/export mechanism (server-side save)
- Add directory browser via GET /api/filesystem/browse
- Auto-reset all state when dialog opens (done, error, exporting, paths)
- Show full output path preview before export

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task C6: Add directory browser styles

**Files:**
- Modify: `client/styles/theme.css`

- [ ] **Step 1: Add .browse-dir-item hover style**

No new CSS classes needed — the ExportDialog uses inline styles. But ensure `.modal-row input[readonly]` has appropriate cursor. Add after line 611 in [client/styles/theme.css](client/styles/theme.css):

```css
.modal-row input[readonly] {
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/styles/theme.css
git commit -m "style: add readonly input cursor style for directory picker

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Part A: Mask System Redesign

### Task A1: Add `maskForAi` to types

**Files:**
- Modify: `shared/types.ts:81`

- [ ] **Step 1: Add `maskForAi` to Layer interface**

In [shared/types.ts](shared/types.ts), after line 81 (`maskEnabled?: boolean;`), add:

```typescript
  maskForAi?: boolean;   // true = send mask to AI to limit generation scope; default true
```

- [ ] **Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add maskForAi field to Layer type

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A2: Update project store — remove auto-reproject, add maskDirty, init maskForAi

**Files:**
- Modify: `client/stores/project.ts`

- [ ] **Step 1: Add `maskDirty` to ProjectState interface**

In [client/stores/project.ts](client/stores/project.ts), after line 53 (`getMaskShapes: (() => MaskShape[]) | null;`), add:

```typescript
  maskDirty: boolean;
```

- [ ] **Step 2: Add `maskDirty` initial value**

After line 111 (`getMaskShapes: null,`), add:

```typescript
  maskDirty: false,
```

- [ ] **Step 3: Set `maskForAi: true` in `createPerspectiveLayer`**

In line 147, change:
```typescript
      maskEnabled: false,
```
to:
```typescript
      maskEnabled: false,
      maskForAi: true,
```

- [ ] **Step 4: Remove auto-reproject from `setLayerMask`**

Replace lines 186-205 (the entire `setLayerMask` function body from its declaration through line 205):

```typescript
  setLayerMask: async (id, patch) => {
    const { layers } = get();
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const next = { ...layer, ...patch };
    set({ layers: layers.map((l) => l.id === id ? next : l), dirty: true, maskDirty: true });
    // Note: reproject no longer happens here. User must click "Apply Mask" to commit.
  },
```

- [ ] **Step 5: Initialize `maskDirty: false` in `openLayerEditor`**

In lines 162-175, change the returned object to include `maskDirty: false`:
```typescript
  openLayerEditor: (id) => set((state) => {
    const layer = state.layers.find((item) => item.id === id);
    if (!layer) return {};
    return {
      workflow: 'canvas-edit',
      activeLayerId: id,
      activeTool: 'brush',
      selectionDraft: layer.selection ?? null,
      editSnapshot: { layer: structuredClone(layer), selection: layer.selection ?? null },
      dirty: false,
      maskDirty: false,
      generatedVariants: [],
      selectedVariantId: null,
    };
  }),
```

- [ ] **Step 6: Save mask shapes + maskForAi + set maskDirty false on `leaveCanvas('save')`**

Replace lines 226-232 (inside `leaveCanvas`):
```typescript
        const shapes = get().getMaskShapes?.() ?? [];
        layers = layers.map((layer): Layer => layer.id === state.activeLayerId
          ? { ...layer, prompt: draft.prompt, selection: draft, maskData: shapes, status: 'committed' as const }
          : layer);
```

With:
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

- [ ] **Step 7: Reset `maskDirty: false` in reset()**

In lines 280-302 (reset function), add after line 301:
```typescript
    maskDirty: false,
```

- [ ] **Step 8: Commit**

```bash
git add client/stores/project.ts
git commit -m "feat: add maskDirty tracking, maskForAi init, remove auto-reproject

- setLayerMask no longer auto-reprojects — user clicks Apply Mask to commit
- maskDirty flag tracks whether mask shapes changed since last apply
- openLayerEditor initializes maskDirty: false
- createPerspectiveLayer sets maskForAi: true by default

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A3: Update CanvasEditor — eraser tool, restore shapes, maskDirty on changes

**Files:**
- Modify: `client/components/CanvasEditor.tsx`

- [ ] **Step 1: Add eraser to drawing mode check**

In [client/components/CanvasEditor.tsx](client/components/CanvasEditor.tsx), line 233, change the `useEffect` for `activeTool`:

```typescript
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
    if (canvas.freeDrawingBrush) {
      if (state.activeTool === 'eraser') {
        canvas.freeDrawingBrush.color = 'rgba(255,255,255,1)';
        canvas.freeDrawingBrush.width = 40;
      } else if (state.activeTool === 'lasso') {
        canvas.freeDrawingBrush.width = 3;
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
      } else {
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
        canvas.freeDrawingBrush.width = 24;
      }
    }
  }, [state.activeTool]);
```

- [ ] **Step 2: Set eraser mode using globalCompositeOperation on the upper canvas**

In the same `useEffect` (Step 1), after setting `canvas.isDrawingMode`, add eraser-specific setup. Since Fabric.js doesn't support `globalCompositeOperation` on freeDrawingBrush directly, we use a different approach — set it on the canvas context after drawing mode changes:

```typescript
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
    if (canvas.freeDrawingBrush) {
      if (state.activeTool === 'eraser') {
        canvas.freeDrawingBrush.color = 'rgba(255,255,255,1)';
        canvas.freeDrawingBrush.width = 40;
      } else if (state.activeTool === 'lasso') {
        canvas.freeDrawingBrush.width = 3;
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
      } else {
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
        canvas.freeDrawingBrush.width = 24;
      }
    }
    // Set eraser composite operation on the upper canvas context
    const ctx = (canvas as any).contextTop;
    if (ctx) {
      ctx.globalCompositeOperation = state.activeTool === 'eraser' ? 'destination-out' : 'source-over';
    }
  }, [state.activeTool]);
```

- [ ] **Step 3: Set maskDirty on path:created (brush + eraser)**

In line 130-138, update the `path:created` handler:

```typescript
      canvas.on('path:created', () => {
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

- [ ] **Step 4: Set maskDirty on lasso mouse:up**

In lines 161-178 (mouse:up handler), after adding the polygon, add maskDirty:

```typescript
      canvas.on('mouse:up', () => {
        if (!lassoPreview) return;
        canvas.remove(lassoPreview);
        lassoPreview = null;
        if (lassoPoints.length >= 3) {
          canvas.add(new Polygon(lassoPoints, {
            fill: 'rgba(233,69,96,.38)',
            stroke: '#e94560',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          }));
          const current = useProjectStore.getState();
          if (current.selectionDraft) {
            current.setSelectionDraft({ ...current.selectionDraft, maskBase64: exportMask() });
          }
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
        }
        lassoPoints = [];
      });
```

- [ ] **Step 5: Set maskDirty on undo**

In lines 180-191 (undo function), after removing the object:

```typescript
      const undo = () => {
        const masks = canvas.getObjects().filter((object: any) =>
          object.type === 'path' || object.type === 'polygon');
        const last = masks.at(-1);
        if (last) {
          canvas.remove(last);
          const current = useProjectStore.getState();
          if (current.selectionDraft) {
            current.setSelectionDraft({ ...current.selectionDraft, maskBase64: exportMask() });
          }
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
        }
      };
```

- [ ] **Step 6: Restore mask shapes from layer.maskData on canvas init**

After line 79 (`setSourceStatus('ready');`), add shape restoration. Insert after the `canvas.requestRenderAll()` on line 78 (before `setSourceStatus`):

```typescript
      // Restore saved mask shapes from layer data (after image is added)
      const savedShapes = activeLayer?.maskData ?? [];
      for (const shape of savedShapes) {
        if (!shape.enabled && shape.enabled !== undefined) continue;
        // Convert native coords back to canvas coords
        const fromNative = (p: { x: number; y: number }) => ({
          x: p.x * scale + image.left!,
          y: p.y * scale + image.top!,
        });
        if (shape.type === 'brush' && shape.points) {
          const canvasPoints = shape.points.map(fromNative);
          if (canvasPoints.length > 0) {
            const path = new (await import('fabric')).Path(
              canvasPoints.flatMap((p) => ['L', p.x, p.y]).slice(2),
              { stroke: '#e94560', strokeWidth: 24, fill: 'transparent', selectable: false, evented: false },
            ) as any;
            canvas.add(path);
          }
        } else if (shape.type === 'lasso' && shape.points) {
          const canvasPoints = shape.points.map(fromNative);
          if (canvasPoints.length >= 3) {
            const polygon = new Polygon(canvasPoints, {
              fill: 'rgba(233,69,96,.38)',
              stroke: '#e94560',
              strokeWidth: 2,
              selectable: false,
              evented: false,
            });
            canvas.add(polygon);
          }
        }
      }
      if (savedShapes.length > 0) {
        canvas.requestRenderAll();
      }
```

Wait — the Fabric import is already destructured at the top of the dynamic import. We need `Path` in the destructure. Let me adjust.

The Fabric dynamic import at line 54 is:
```typescript
import('fabric').then(async ({ Canvas, FabricImage, PencilBrush, Polygon, Polyline }) => {
```

We need to also import `Path`. Let me fix Step 6 to add `Path` to the import:

Actually, looking more carefully at the code, the Path import for restoring brush strokes uses Fabric's `Path` class. We need to add it to the destructured import. Let me redo this step.

- [ ] **Step 6 (revised): Add `Path` to Fabric import and restore shapes**

Change line 54:
```typescript
    import('fabric').then(async ({ Canvas, FabricImage, PencilBrush, Polygon, Polyline }) => {
```
to:
```typescript
    import('fabric').then(async ({ Canvas, FabricImage, Path, PencilBrush, Polygon, Polyline }) => {
```

Then after `setSourceStatus('ready')` (line 79), insert shape restoration:

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
              // Build SVG-style path string: M x0 y0 L x1 y1 L x2 y2 ...
              const d = canvasPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const pathObj = new Path(d, {
                stroke: 'rgba(233,69,96,.55)',
                strokeWidth: 24,
                fill: 'transparent',
                selectable: false,
                evented: false,
              });
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
            });
            canvas.add(polygon);
          }
        }
        canvas.requestRenderAll();
      }
```

- [ ] **Step 7: Commit**

```bash
git add client/components/CanvasEditor.tsx
git commit -m "feat: add eraser tool, restore mask shapes on canvas enter, maskDirty tracking

- Eraser uses globalCompositeOperation 'destination-out' on contextTop
- Restore saved mask shapes (brush/lasso) as Fabric objects when entering edit
- Set maskDirty: true on brush stroke, lasso close, and undo

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A4: Update LayerPanel — mask panel only in canvas-edit, add maskForAi toggle

**Files:**
- Modify: `client/components/LayerPanel.tsx`

- [ ] **Step 1: Gate mask panel on canvas-edit workflow**

In [client/components/LayerPanel.tsx](client/components/LayerPanel.tsx), line 53, change:
```typescript
      {activeLayer && (
```
to:
```typescript
      {activeLayer && state.workflow === 'canvas-edit' && (
```

- [ ] **Step 2: Add `maskForAi` toggle above existing `maskEnabled` toggle**

After the opening `<div className="mask-panel">` (line 54), insert before the `maskEnabled` toggle label:

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

- [ ] **Step 3: Commit**

```bash
git add client/components/LayerPanel.tsx
git commit -m "feat: gate mask panel on canvas-edit, add maskForAi toggle

Mask panel only visible in canvas-edit workflow.
New 'Use mask for AI' toggle controls whether mask is sent to AI generation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A5: Update PromptBar — Add Apply Mask button, send maskForAi to AI

**Files:**
- Modify: `client/components/PromptBar.tsx`

- [ ] **Step 1: Add `applyMaskOnly` function and "Apply Mask" button**

In [client/components/PromptBar.tsx](client/components/PromptBar.tsx), after the `applySelected` function (after line 120), add:

```typescript
  const applyMaskOnly = async () => {
    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    const selection = state.selectionDraft;
    if (!activeLayer?.resultImageId || !state.imagePath || !selection) return;
    if (!state.maskDirty) return;
    setError('');
    state.setWorkflow('generating');
    try {
      const shapes = state.getMaskShapes?.() ?? activeLayer.maskData ?? [];
      const maskEnabled = activeLayer.maskEnabled ?? false;
      if (selection.sourceView === '360') {
        const reprojResult = await api.image.reproject({
          resultImageId: activeLayer.resultImageId,
          selection,
          imagePath: state.imagePath,
          maskEnabled,
          maskData: shapes.filter((s) => s.enabled !== false),
        });
        state.updateLayer(activeLayer.id, {
          equirectImageId: reprojResult.equirectImageId,
          maskData: shapes,
          maskEnabled,
        });
      } else {
        // Flat layers just update mask data
        state.updateLayer(activeLayer.id, { maskData: shapes, maskEnabled });
      }
      useProjectStore.setState({ maskDirty: false, workflow: 'canvas-edit' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply mask thất bại');
      state.setWorkflow('canvas-edit');
    }
  };
```

- [ ] **Step 2: Add the "Apply Mask" button in JSX**

After the "Apply Selected" button (line 155), add:

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

- [ ] **Step 3: Send `maskForAi` on generate (conditionally skip mask to AI)**

In the `generate` function (line 21), change the AI edit call to respect `maskForAi`. After line 49 (`const result = await api.ai.edit({`):

Currently lines 49-54:
```typescript
      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: mask,
        prompt: translated,
      });
```

Change to:
```typescript
      const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
      const useMaskForAi = activeLayer?.maskForAi !== false; // default true
      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: useMaskForAi ? mask : '',  // empty mask = full image generation
        prompt: translated,
      });
```

Note: This also requires removing the `activeLayer` declaration on line 33 since we now use it earlier. Move it up:

Lines 32-47 currently:
```typescript
      // Try loading from active layer's cache first (perspective layers)
      const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
      if (activeLayer?.resultImageId) {
```

We need `activeLayer` for both the image source AND maskForAi. The current code already declares it on line 33. Just move the `maskForAi` check before the ai.edit call. Actually, looking more closely, `activeLayer` is already declared inside `generate()`. Let me just adjust:

After line 49 (inside generate), change:
```typescript
      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: mask,
        prompt: translated,
      });
```

To:
```typescript
      const useMaskForAi = activeLayer?.maskForAi !== false;
      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: useMaskForAi ? mask : '',
        prompt: translated,
      });
```

- [ ] **Step 4: Also save maskForAi in applySelected**

In `applySelected` (lines 68-120), add `maskForAi` to the layer object. After line 100, change:
```typescript
        maskData: shapes,
        maskEnabled,
```
to:
```typescript
        maskData: shapes,
        maskEnabled,
        maskForAi: existing?.maskForAi ?? true,
```

- [ ] **Step 5: Commit**

```bash
git add client/components/PromptBar.tsx
git commit -m "feat: add Apply Mask button, respect maskForAi in AI generate

- New 'Apply Mask' button re-reprojects with current mask (no AI)
- Enabled when activeLayer has resultImageId AND maskDirty is true
- maskForAi toggle controls whether mask is sent to AI edit
- applySelected saves maskForAi to layer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A6: Add eraser tool button to Toolbar

**Files:**
- Modify: `client/components/Toolbar.tsx:20-24`

- [ ] **Step 1: Add eraser to tools array**

In [client/components/Toolbar.tsx](client/components/Toolbar.tsx), after line 23 (the lasso tool entry), add:

```typescript
    { id: 'eraser' as const, icon: '⌫', label: 'Eraser', enabled: permission.eraser },
```

- [ ] **Step 2: Commit**

```bash
git add client/components/Toolbar.tsx
git commit -m "feat: add eraser tool button to toolbar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A7: Add eraser to ActiveTool type and workflow permissions

**Files:**
- Modify: `client/stores/project.ts:23`
- Modify: `client/stores/workflow.ts:20-25,45-49`

- [ ] **Step 1: Add `'eraser'` to ActiveTool**

In [client/stores/project.ts](client/stores/project.ts), line 23, change:
```typescript
export type ActiveTool = 'brush' | 'rect' | 'lasso' | null;
```
to:
```typescript
export type ActiveTool = 'brush' | 'rect' | 'lasso' | 'eraser' | null;
```

- [ ] **Step 2: Add `eraser` permission to WorkflowPermissions**

In [client/stores/workflow.ts](client/stores/workflow.ts), line 24, after `lasso: boolean;`, add:
```typescript
  eraser: boolean;
```

- [ ] **Step 3: Enable eraser in canvas-edit and ai-review workflows**

In lines 45-49, change the return object:
```typescript
    brush: state === 'canvas-edit' || state === 'ai-review',
    lasso: state === 'canvas-edit' || state === 'ai-review',
    undo: state === 'canvas-edit' || state === 'ai-review',
```
to:
```typescript
    brush: state === 'canvas-edit' || state === 'ai-review',
    lasso: state === 'canvas-edit' || state === 'ai-review',
    eraser: state === 'canvas-edit' || state === 'ai-review',
    undo: state === 'canvas-edit' || state === 'ai-review',
```

- [ ] **Step 4: Commit**

```bash
git add client/stores/project.ts client/stores/workflow.ts
git commit -m "feat: add eraser to ActiveTool type and workflow permissions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Part B: Save Project — ZIP Bundle

### Task B1: Bump ProjectFile version to 3

**Files:**
- Modify: `shared/types.ts:191`

- [ ] **Step 1: Change version in ProjectFile**

In [shared/types.ts](shared/types.ts), line 191, change:
```typescript
  version: 2;
```
to:
```typescript
  version: 3;
```

- [ ] **Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "feat: bump ProjectFile version to 3 for ZIP bundle format

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B2: Add /download and /upload-zip endpoints to project router

**Files:**
- Modify: `server/routes/project.ts`

- [ ] **Step 1: Add imports for archiver and multer for ZIP upload**

In [server/routes/project.ts](server/routes/project.ts), add at the top (after line 6):

```typescript
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { randomUUID } from 'crypto';
```

- [ ] **Step 2: Add `POST /project/download` endpoint**

After line 81 (end of `/save` handler), add:

```typescript
// Download project as ZIP bundle (.360project)
projectRouter.post('/download', async (req, res) => {
  try {
    const { project } = req.body as { project: ProjectFile };
    if (!project?.imagePath) return res.status(400).json({ error: 'project with imagePath is required' });

    // Verify original image exists
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
        } catch { /* cache file may not exist — skip */ }
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

    // Create ZIP archive and stream to client
    const baseName = path.basename(project.imagePath, origExt);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.360project"`);

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    archive.directory(tmpDir, false);
    await archive.finalize();

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});
```

Wait — Express 5 `res.download()` has the issue with fetch, but `archiver.pipe(res)` with `Content-Type: application/zip` is different — it streams raw bytes, not using `Content-Disposition: attachment` in the problematic way. Actually, the issue is specifically with `res.download()` setting `Content-Disposition: attachment` in Express 5. Let me use `application/octet-stream` content type to avoid the fetch attachment issue, and handle the download on the client side by reading the blob.

Actually, the simpler approach: the client will use `fetch()` which gets the blob. Since we set `Content-Type: application/zip`, the `request<T>()` function will see it's not `image/` so it'll call `res.json()` which will fail on binary data. We need a separate client function for this.

Let me adjust — the client side will use a custom fetch that returns a Blob.

Let me finalize Step 2 and make sure the client side handles this.

- [ ] **Step 2 (revised): Add `POST /project/download` endpoint**

After line 81 (end of `/save` handler), add:

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
    archive.on('error', (err) => { throw err; });
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

- [ ] **Step 3: Add multer for ZIP upload and `POST /project/upload-zip` endpoint**

Add a new multer instance for ZIP uploads (after the existing `projectUpload`):

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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for large projects
});
```

Then add the endpoint before the closing `export { projectRouter }`:

```typescript
// Upload .360project ZIP bundle — extract, map paths, return project
projectRouter.post('/upload-zip', zipUpload.single('project'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No project file provided' });

    const extractDir = path.join(CACHE_DIR, `project-extract-${randomUUID()}`);
    await fs.mkdir(extractDir, { recursive: true });

    // Extract ZIP
    const { execSync } = await import('child_process');
    execSync(`unzip -o "${req.file.path}" -d "${extractDir}"`, { stdio: 'pipe' });

    // Read project.json
    const projectData = await fs.readFile(path.join(extractDir, 'project.json'), 'utf-8');
    const project = JSON.parse(projectData) as ProjectFile;

    if (project.version < 2 || project.version > 3) {
      await fs.rm(extractDir, { recursive: true, force: true });
      return res.status(400).json({ error: `Unsupported project version: ${project.version}` });
    }

    // Copy original image to CACHE_DIR
    const origPath = path.join(extractDir, project.imagePath);
    const origExt = path.extname(project.imagePath);
    const newOrigPath = path.join(CACHE_DIR, `original-${randomUUID()}${origExt}`);
    await fs.copyFile(origPath, newOrigPath);

    // Copy cache files to CACHE_DIR and build path map
    const cacheMap = new Map<string, string>(); // old id → new id
    const extractCache = path.join(extractDir, 'cache');
    try {
      const cacheFiles = await fs.readdir(extractCache);
      for (const file of cacheFiles) {
        const oldId = path.basename(file, '.png');
        const newId = randomUUID();
        await fs.copyFile(path.join(extractCache, file), path.join(CACHE_DIR, `${newId}.png`));
        cacheMap.set(oldId, newId);
      }
    } catch { /* no cache dir — fine */ }

    // Remap layer cache IDs
    const layers = project.layers.map((layer) => ({
      ...layer,
      resultImageId: cacheMap.get(layer.resultImageId) || layer.resultImageId,
      equirectImageId: layer.equirectImageId ? (cacheMap.get(layer.equirectImageId) || layer.equirectImageId) : undefined,
    }));

    // Cleanup extract dir and uploaded ZIP
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

- [ ] **Step 4: Install archiver if not already present**

```bash
npm list archiver || npm install archiver
npm list @types/archiver || npm install -D @types/archiver
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/project.ts package.json package-lock.json
git commit -m "feat: add /project/download and /project/upload-zip endpoints

- POST /project/download: bundles project.json + original + cache/ as ZIP
- POST /project/upload-zip: extracts ZIP, copies files, remaps cache IDs
- Uses archiver for ZIP creation, unzip for extraction

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B3: Add download/uploadZip client API functions

**Files:**
- Modify: `client/lib/api.ts:83-99`

- [ ] **Step 1: Add `api.project.download()` and `api.project.uploadZip()`**

In [client/lib/api.ts](client/lib/api.ts), replace the existing `project` block (lines 83-99):

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
    // Upload .360project ZIP bundle
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

- [ ] **Step 2: Commit**

```bash
git add client/lib/api.ts
git commit -m "feat: add api.project.download() and uploadZip() client functions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B4: Rewire App.tsx save/load to use ZIP endpoints

**Files:**
- Modify: `client/App.tsx`

- [ ] **Step 1: Update `saveProject` to use ZIP download**

In [client/App.tsx](client/App.tsx), replace lines 37-51 (`saveProject` function):

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

- [ ] **Step 2: Update `loadProject` to use ZIP upload**

Replace lines 66-71 (`loadProject` function):

```typescript
  const loadProject = useCallback(async (file: File) => {
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      state.openImage(project.imagePath, meta.width, meta.height);
      useProjectStore.setState({ layers: project.layers ?? [], horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 } });
      setFileSize(meta.sizeBytes);
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    }
  }, [state.openImage]);
```

- [ ] **Step 3: Remove `saveProjectServer` and its button**

Delete lines 53-64 (`saveProjectServer` function).

In line 99, remove the "Save to Server" button:
```typescript
            <button disabled={!state.imagePath} onClick={() => void saveProjectServer()}>💿 Save to Server</button>
```

- [ ] **Step 4: Update Toolbar onSave prop**

In line 109, change:
```typescript
        <Toolbar onExport={() => setExportOpen(true)} onSave={() => void saveProject()} />
```
to:
```typescript
        <Toolbar onExport={() => setExportOpen(true)} onSave={() => { void saveProject(); }} />
```

Actually this is already correct (already uses `void` pattern). No change needed.

- [ ] **Step 5: Commit**

```bash
git add client/App.tsx
git commit -m "feat: switch save/load to ZIP bundle with download/upload-zip

- Save: downloads .360project ZIP containing project.json + original + cache
- Load: uploads ZIP, extracts, remaps paths, opens project
- Remove 'Save to Server' button (no longer needed)
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

### Part A — Mask System
1. Enter canvas edit mode → LayerPanel shows mask panel with "Use mask for AI" + "Apply mask to layer" toggles
2. Switch to View mode → mask panel hidden
3. Draw brush strokes → maskDirty=true, dirty=true
4. Click "Apply Mask" (no AI result) → reprojects, maskDirty=false
5. Uncheck "Use mask for AI" → Generate → AI gets empty mask (full image generation)
6. Switch to Eraser tool → draw → erases existing mask areas
7. Draw lasso → undo → maskDirty stays true
8. Back to View → re-enter edit → previous mask shapes restored on canvas

### Part B — Save/Load
1. Download Project → browser downloads `.360project` ZIP file
2. Open downloaded `.360project` on another machine → project loads with all layers and cache files
3. Cross-machine paths resolved correctly
