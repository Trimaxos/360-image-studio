import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LayerVariant } from '../../shared/types';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

interface Props { layerId: string; variant: LayerVariant; onClose: () => void }
type Tool = 'erase' | 'restore';

export default function ResultMaskEditor({ layerId, variant, onClose }: Props) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const originalRef = useRef<HTMLImageElement | undefined>(undefined);
  const showOriginalRef = useRef(false);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const [tool, setTool] = useState<Tool>('erase');
  const [size, setSize] = useState(variant.visibilityMask?.brushSize ?? 80);
  const [opacity, setOpacity] = useState(variant.visibilityMask?.brushOpacity ?? 100);
  const [hardness, setHardness] = useState(variant.visibilityMask?.brushHardness ?? 80);
  const [ready, setReady] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fittedSize, setFittedSize] = useState({ width: 0, height: 0 });
  const [, refreshHistory] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number; scale: number }>();
  const originalUrl = useProjectStore((state) => {
    const layer = state.layers.find((item) => item.id === layerId);
    if (!layer) return '';
    if (layer.resultImageId) return api.image.cacheUrl(layer.resultImageId);
    return state.imagePath
      ? api.image.tileUrl(state.imagePath, layer.tileCoords.x, layer.tileCoords.y, layer.tileCoords.w, layer.tileCoords.h)
      : '';
  });

  const redraw = useCallback((dirty?: { x: number; y: number; width: number; height: number }) => {
    const canvas = displayRef.current, mask = maskRef.current, image = imageRef.current;
    if (!canvas || !mask || !image) return;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const maskContext = mask.getContext('2d', { willReadFrequently: true })!;
    const left = Math.max(0, Math.floor(dirty?.x ?? 0));
    const top = Math.max(0, Math.floor(dirty?.y ?? 0));
    const right = Math.min(canvas.width, Math.ceil((dirty?.x ?? 0) + (dirty?.width ?? canvas.width)));
    const bottom = Math.min(canvas.height, Math.ceil((dirty?.y ?? 0) + (dirty?.height ?? canvas.height)));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return;

    context.clearRect(left, top, width, height);
    context.drawImage(
      image,
      left * image.naturalWidth / canvas.width,
      top * image.naturalHeight / canvas.height,
      width * image.naturalWidth / canvas.width,
      height * image.naturalHeight / canvas.height,
      left,
      top,
      width,
      height,
    );

    // Mask được lưu dạng grayscale và luôn có alpha=255. Vì vậy
    // destination-in không thể xóa ảnh; phải chuyển độ sáng mask thành alpha.
    const pixels = context.getImageData(left, top, width, height);
    const maskPixels = maskContext.getImageData(left, top, width, height);
    for (let index = 3; index < pixels.data.length; index += 4) {
      pixels.data[index] = Math.round(
        pixels.data[index] * maskPixels.data[index - 3] / 255,
      );
    }
    context.putImageData(pixels, left, top);
    const original = originalRef.current;
    if (showOriginalRef.current && original) {
      context.globalCompositeOperation = 'destination-over';
      context.drawImage(
        original,
        left * original.naturalWidth / canvas.width,
        top * original.naturalHeight / canvas.height,
        width * original.naturalWidth / canvas.width,
        height * original.naturalHeight / canvas.height,
        left,
        top,
        width,
        height,
      );
      context.globalCompositeOperation = 'source-over';
    }
  }, []);

  useEffect(() => {
    if (!originalUrl) return;
    const original = new Image();
    original.crossOrigin = 'anonymous';
    original.onload = () => {
      originalRef.current = original;
      if (showOriginalRef.current) redraw();
    };
    original.src = originalUrl;
    return () => { originalRef.current = undefined; };
  }, [originalUrl, redraw]);

  const toggleOriginal = () => {
    const next = !showOriginalRef.current;
    showOriginalRef.current = next;
    setShowOriginal(next);
    redraw();
  };

  const restoreSnapshot = useCallback((snapshot: string) => {
    const mask = maskRef.current;
    if (!mask) return;
    const image = new Image();
    image.onload = () => {
      const context = mask.getContext('2d')!;
      context.clearRect(0, 0, mask.width, mask.height);
      context.drawImage(image, 0, 0, mask.width, mask.height);
      redraw(); refreshHistory((value) => value + 1);
    };
    image.src = snapshot;
  }, [redraw]);

  const undo = useCallback(() => {
    const mask = maskRef.current, snapshot = undoRef.current.pop();
    if (!mask || !snapshot) return;
    redoRef.current.push(mask.toDataURL()); restoreSnapshot(snapshot);
  }, [restoreSnapshot]);
  const redo = useCallback(() => {
    const mask = maskRef.current, snapshot = redoRef.current.pop();
    if (!mask || !snapshot) return;
    undoRef.current.push(mask.toDataURL()); restoreSnapshot(snapshot);
  }, [restoreSnapshot]);

  useEffect(() => {
    const source = new Image();
    source.crossOrigin = 'anonymous';
    source.onload = () => {
      const scale = Math.min(1, 1800 / Math.max(source.naturalWidth, source.naturalHeight));
      const width = Math.max(1, Math.round(source.naturalWidth * scale));
      const height = Math.max(1, Math.round(source.naturalHeight * scale));
      const display = displayRef.current!;
      display.width = width; display.height = height;
      const mask = document.createElement('canvas');
      mask.width = width; mask.height = height; maskRef.current = mask; imageRef.current = source;
      const context = mask.getContext('2d')!;
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      const savedMask = variant.visibilityMask?.base64Mask;
      if (!savedMask) { redraw(); setReady(true); return; }
      const saved = new Image();
      saved.onload = () => { context.drawImage(saved, 0, 0, width, height); redraw(); setReady(true); };
      saved.src = `data:image/png;base64,${savedMask}`;
    };
    source.src = api.image.cacheUrl(variant.resultImageId);
  }, [redraw, variant.resultImageId, variant.visibilityMask?.base64Mask]);

  useEffect(() => {
    const canvas = displayRef.current;
    const workspace = workspaceRef.current;
    if (!ready || !canvas || !workspace) return;
    const measure = () => {
      // workspace now has a real flex-computed box (see .result-mask-workspace
      // flex: 1 1 auto), so its own clientWidth/clientHeight is the actual
      // available space — this stays accurate in both normal and fullscreen mode.
      const availableWidth = Math.max(1, workspace.clientWidth);
      const availableHeight = Math.max(1, workspace.clientHeight);
      const scale = Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
      setFittedSize({ width: canvas.width * scale, height: canvas.height * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redo, undo]);

  // Hold Space to pan the zoomed view by dragging, instead of scrollbars.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target)) return;
      // Must preventDefault on every repeat too, not just the first keydown —
      // otherwise the browser's native "Space = scroll page down" still fires
      // on the auto-repeated keydowns while the key is held.
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.width / bounds.width;
    return { x: (event.clientX - bounds.left) * scale, y: (event.clientY - bounds.top) * scale, scale };
  };
  const stamp = (x: number, y: number) => {
    const context = maskRef.current!.getContext('2d')!;
    const radius = Math.max(1, size / 2), inner = radius * hardness / 100;
    const value = tool === 'erase' ? 0 : 255;
    const gradient = context.createRadialGradient(x, y, inner, x, y, radius);
    gradient.addColorStop(0, `rgba(${value},${value},${value},1)`);
    if (inner < radius) gradient.addColorStop(Math.max(.001, hardness / 100), `rgba(${value},${value},${value},1)`);
    gradient.addColorStop(1, `rgba(${value},${value},${value},0)`);
    context.save(); context.globalAlpha = opacity / 100; context.fillStyle = gradient;
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.restore();
  };
  const paintTo = (next: { x: number; y: number }) => {
    const previous = lastRef.current ?? next;
    const steps = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) / Math.max(1, size / 8)));
    for (let index = 1; index <= steps; index += 1) {
      const ratio = index / steps;
      stamp(previous.x + (next.x - previous.x) * ratio, previous.y + (next.y - previous.y) * ratio);
    }
    lastRef.current = next;
    const padding = size / 2 + 2;
    const left = Math.min(previous.x, next.x) - padding;
    const top = Math.min(previous.y, next.y) - padding;
    redraw({
      x: left,
      y: top,
      width: Math.abs(next.x - previous.x) + padding * 2,
      height: Math.abs(next.y - previous.y) + padding * 2,
    });
  };
  const startPaint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || !maskRef.current) return;
    // Middle-click, or holding Space while left-click-dragging, pans the
    // zoomed view instead of painting — no need to reach for the scrollbars.
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: workspaceRef.current?.scrollLeft ?? 0,
        scrollTop: workspaceRef.current?.scrollTop ?? 0,
      };
      setIsPanning(true);
      setCursor(undefined);
      return;
    }
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    undoRef.current.push(maskRef.current.toDataURL());
    if (undoRef.current.length > 30) undoRef.current.shift();
    redoRef.current = []; drawingRef.current = true;
    const next = point(event); lastRef.current = next; paintTo(next); refreshHistory((value) => value + 1);
  };
  const movePaint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      const workspace = workspaceRef.current;
      if (workspace) {
        workspace.scrollLeft = panRef.current.scrollLeft - (event.clientX - panRef.current.startX);
        workspace.scrollTop = panRef.current.scrollTop - (event.clientY - panRef.current.startY);
      }
      return;
    }
    const next = point(event);
    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
    // Keep the brush ring in workspace coordinates, including scroll offsets,
    // while painting continues to use the canvas's pixel coordinates.
    setCursor({
      x: event.clientX - (workspaceBounds?.left ?? 0) + (workspaceRef.current?.scrollLeft ?? 0),
      y: event.clientY - (workspaceBounds?.top ?? 0) + (workspaceRef.current?.scrollTop ?? 0),
      scale: next.scale,
    });
    if (drawingRef.current) paintTo(next);
  };
  const stopPaint = () => { drawingRef.current = false; lastRef.current = undefined; panRef.current = null; setIsPanning(false); };
  const resetMask = () => {
    const mask = maskRef.current; if (!mask) return;
    undoRef.current.push(mask.toDataURL()); redoRef.current = [];
    const context = mask.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, mask.width, mask.height);
    redraw(); refreshHistory((value) => value + 1);
  };
  const save = () => {
    const mask = maskRef.current; if (!mask) return;
    useProjectStore.getState().updateVariantMask(layerId, variant.id, {
      base64Mask: mask.toDataURL('image/png').split(',')[1], brushSize: size,
      brushSoftness: 100 - hardness, brushOpacity: opacity, brushHardness: hardness,
    });
    onClose();
  };

  const clampZoom = (value: number) => Math.min(12, Math.max(.25, value));
  const changeZoom = (next: number) => setZoom(clampZoom(next));

  // Keeps the point under the cursor fixed on screen across a Ctrl+wheel zoom,
  // instead of zooming from whatever corner the canvas happens to grow from.
  const zoomAnchorRef = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(null);

  // React attaches onWheel as a passive listener, so preventDefault() inside a
  // JSX handler can't stop the browser's own Ctrl+wheel page zoom. A native
  // listener with { passive: false } is required to intercept it.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const canvas = displayRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        zoomAnchorRef.current = {
          fx: (event.clientX - rect.left) / rect.width,
          fy: (event.clientY - rect.top) / rect.height,
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }
      setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    workspace.addEventListener('wheel', onWheel, { passive: false });
    return () => workspace.removeEventListener('wheel', onWheel);
  }, []);

  // Runs after the canvas is resized for the new zoom level (but before paint)
  // and scrolls the workspace so the anchored point stays under the cursor.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const canvas = displayRef.current, workspace = workspaceRef.current;
    if (!canvas || !workspace) return;
    const rect = canvas.getBoundingClientRect();
    const currentClientX = rect.left + anchor.fx * rect.width;
    const currentClientY = rect.top + anchor.fy * rect.height;
    workspace.scrollLeft += currentClientX - anchor.clientX;
    workspace.scrollTop += currentClientY - anchor.clientY;
  }, [zoom]);

  return <div className={`result-mask-backdrop ${fullscreen ? 'fullscreen' : ''}`} role="dialog" aria-modal="true" aria-label="Chỉnh sửa vùng hiển thị">
    <div className={`result-mask-modal ${fullscreen ? 'fullscreen' : ''}`}>
      <header className="result-mask-header"><div><h2>Tinh chỉnh kết quả</h2><p>Xóa phần AI không cần thiết hoặc phục hồi lại bất cứ lúc nào.</p></div><div className="result-mask-header-actions"><button className={`compare ${showOriginal ? 'active' : ''}`} onClick={toggleOriginal}>◉ {showOriginal ? 'Ẩn ảnh gốc' : 'Hiện ảnh gốc'}</button><button onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? 'Thu nhỏ popup' : 'Phóng to popup'} title={fullscreen ? 'Thu nhỏ popup' : 'Phóng to popup toàn màn hình'}>{fullscreen ? '⤢' : '⛶'}</button><button className="primary" onClick={save}>✓ Áp dụng chỉnh sửa</button><button onClick={onClose} aria-label="Đóng">✕</button></div></header>
      <div className="result-mask-tools">
        <div className="result-mask-mode"><button className={tool === 'erase' ? 'active erase' : ''} onClick={() => setTool('erase')}>⌫ Xóa</button><button className={tool === 'restore' ? 'active restore' : ''} onClick={() => setTool('restore')}>♻ Phục hồi</button><button onClick={resetMask}>Phục hồi toàn bộ</button><button disabled={!undoRef.current.length} onClick={undo} title="Undo (Ctrl+Z)">↶</button><button disabled={!redoRef.current.length} onClick={redo} title="Redo (Ctrl+Y)">↷</button><details className="result-mask-help-popover"><summary aria-label="Hướng dẫn sử dụng brush" title="Hướng dẫn sử dụng"><span>i</span></summary><div><strong>Hướng dẫn brush:</strong><ul><li><b>Xóa:</b> quét vùng muốn trong suốt</li><li><b>Phục hồi:</b> lấy lại pixel gốc</li><li><b>Độ cứng = 0:</b> viền mờ dần (feather)</li><li><b>Độ mờ &lt; 100%:</b> xóa/phục hồi bán phần</li><li>Ctrl+Z / Ctrl+Y để undo/redo</li><li>Giữ <b>Space</b> hoặc chuột giữa để kéo di chuyển ảnh khi đã zoom</li></ul></div></details></div>
        <div className="result-mask-sliders"><label>Kích thước <strong>{size}px</strong><input type="range" min="1" max="300" value={size} onChange={(event) => setSize(+event.target.value)} /></label><label>Độ mờ <strong>{opacity}%</strong><input type="range" min="5" max="100" value={opacity} onChange={(event) => setOpacity(+event.target.value)} /></label><label>Độ cứng <strong>{hardness}%</strong><input type="range" min="0" max="100" value={hardness} onChange={(event) => setHardness(+event.target.value)} /></label></div>
      </div>
      <div className="result-mask-zoom"><button onClick={() => changeZoom(zoom / 1.25)} aria-label="Thu nhỏ">−</button><strong>{Math.round(zoom * 100)}%</strong><button onClick={() => changeZoom(zoom * 1.25)} aria-label="Phóng to">+</button><button onClick={() => setZoom(1)}>Vừa khung</button><span>Ctrl + con lăn để zoom · Giữ Space hoặc chuột giữa để kéo di chuyển</span></div>
      <div ref={workspaceRef} className="result-mask-workspace" onMouseLeave={() => setCursor(undefined)}><div className="result-mask-canvas-shell" style={{ width: fittedSize.width * zoom || undefined, height: fittedSize.height * zoom || undefined }}><canvas ref={displayRef} style={{ cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'none', ...(fittedSize.width ? { width: fittedSize.width * zoom, height: fittedSize.height * zoom } : undefined) }} onPointerDown={startPaint} onPointerMove={movePaint} onPointerUp={stopPaint} onPointerCancel={stopPaint} /></div>{!ready && <span className="result-mask-loading">Đang tải ảnh…</span>}{cursor && !isPanning && !spaceHeld && <span className="result-mask-cursor" style={{ left: cursor.x, top: cursor.y, width: size / cursor.scale, height: size / cursor.scale }} />}</div>
    </div>
  </div>;
}
