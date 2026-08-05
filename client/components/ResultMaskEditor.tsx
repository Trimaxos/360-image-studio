import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LayerVariant } from '../../shared/types';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

interface Props { layerId: string; variant: LayerVariant; onClose: () => void }
type Tool = 'erase' | 'restore';

export default function ResultMaskEditor({ layerId, variant, onClose }: Props) {
  const displayRef = useRef<HTMLCanvasElement>(null);
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
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redo, undo]);

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
    event.currentTarget.setPointerCapture(event.pointerId);
    undoRef.current.push(maskRef.current.toDataURL());
    if (undoRef.current.length > 30) undoRef.current.shift();
    redoRef.current = []; drawingRef.current = true;
    const next = point(event); lastRef.current = next; paintTo(next); refreshHistory((value) => value + 1);
  };
  const movePaint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const next = point(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    // Cursor is absolutely positioned relative to the workspace, while pointer
    // coordinates are relative to the canvas. Include the canvas offset so the
    // visual brush ring and the painted mask use the exact same position.
    setCursor({
      x: event.currentTarget.offsetLeft + event.clientX - bounds.left,
      y: event.currentTarget.offsetTop + event.clientY - bounds.top,
      scale: next.scale,
    });
    if (drawingRef.current) paintTo(next);
  };
  const stopPaint = () => { drawingRef.current = false; lastRef.current = undefined; };
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

  return <div className="result-mask-backdrop" role="dialog" aria-modal="true" aria-label="Chỉnh sửa vùng hiển thị">
    <div className="result-mask-modal">
      <header className="result-mask-header"><div><h2>Tinh chỉnh kết quả</h2><p>Xóa phần AI không cần thiết hoặc phục hồi lại bất cứ lúc nào.</p></div><div className="result-mask-header-actions"><button className={`compare ${showOriginal ? 'active' : ''}`} onClick={toggleOriginal}>◉ {showOriginal ? 'Ẩn ảnh gốc' : 'Hiện ảnh gốc'}</button><button className="primary" onClick={save}>✓ Áp dụng chỉnh sửa</button><button onClick={onClose} aria-label="Đóng">✕</button></div></header>
      <div className="result-mask-tools">
        <div className="result-mask-mode"><button className={tool === 'erase' ? 'active erase' : ''} onClick={() => setTool('erase')}>⌫ Xóa</button><button className={tool === 'restore' ? 'active restore' : ''} onClick={() => setTool('restore')}>♻ Phục hồi</button><button onClick={resetMask}>Phục hồi toàn bộ</button><button disabled={!undoRef.current.length} onClick={undo} title="Undo (Ctrl+Z)">↶</button><button disabled={!redoRef.current.length} onClick={redo} title="Redo (Ctrl+Y)">↷</button><details className="result-mask-help-popover"><summary aria-label="Hướng dẫn sử dụng brush" title="Hướng dẫn sử dụng"><span>i</span></summary><div><strong>Hướng dẫn brush:</strong><ul><li><b>Xóa:</b> quét vùng muốn trong suốt</li><li><b>Phục hồi:</b> lấy lại pixel gốc</li><li><b>Độ cứng = 0:</b> viền mờ dần (feather)</li><li><b>Độ mờ &lt; 100%:</b> xóa/phục hồi bán phần</li><li>Ctrl+Z / Ctrl+Y để undo/redo</li></ul></div></details></div>
        <div className="result-mask-sliders"><label>Kích thước <strong>{size}px</strong><input type="range" min="10" max="300" value={size} onChange={(event) => setSize(+event.target.value)} /></label><label>Độ mờ <strong>{opacity}%</strong><input type="range" min="5" max="100" value={opacity} onChange={(event) => setOpacity(+event.target.value)} /></label><label>Độ cứng <strong>{hardness}%</strong><input type="range" min="0" max="100" value={hardness} onChange={(event) => setHardness(+event.target.value)} /></label></div>
      </div>
      <div className="result-mask-workspace" onMouseLeave={() => setCursor(undefined)}><canvas ref={displayRef} onPointerDown={startPaint} onPointerMove={movePaint} onPointerUp={stopPaint} onPointerCancel={stopPaint} />{!ready && <span className="result-mask-loading">Đang tải ảnh…</span>}{cursor && <span className="result-mask-cursor" style={{ left: cursor.x, top: cursor.y, width: size / cursor.scale, height: size / cursor.scale }} />}</div>
    </div>
  </div>;
}
