import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RegionEdit } from '../stores/project';

interface Props {
  sourceUrl: string;
  onCancel: () => void;
  /** Use the drawn shape as a region mask for the next Generate (current behavior). */
  onSelect: (region: RegionEdit) => void;
  /** Bake the shape (filled + stroked with the chosen colors) directly into a
   *  new result image, handed back as base64 — for prompting the AI against
   *  a visible marker instead of relying on a mask/location description. */
  onApply: (bakedBase64: string) => void;
}

type Mode = 'freehand' | 'rectangle' | 'polygon';

/** Points within this many display px of the first vertex close the polygon. */
const CLOSE_RADIUS = 12;

function rectCorners(start: { x: number; y: number }, end: { x: number; y: number }) {
  const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function ColorChip({ label, enabled, onToggle, color, onColorChange }: {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  color: string;
  onColorChange: (value: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(color);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className={`region-color-chip ${enabled ? '' : 'disabled'}`}>
      <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
      <span>{label}</span>
      <input type="color" value={color} disabled={!enabled} onChange={(event) => onColorChange(event.target.value)} />
      <input
        className="region-select-hex"
        type="text"
        value={color}
        disabled={!enabled}
        onChange={(event) => onColorChange(event.target.value)}
        spellCheck={false}
      />
      <button type="button" disabled={!enabled} onClick={copy} title="Copy mã màu">{copied ? '✓' : '⧉'}</button>
    </div>
  );
}

/** Draw over the currently displayed image to mark an area — either by
 *  dragging a freeform lasso, or by clicking vertices to connect into a
 *  polygon. Once drawn, choose to use it as a region mask (see RegionEdit)
 *  or bake it as a colored marker onto a new result (see onApply). */
export default function RegionSelectOverlay({ sourceUrl, onCancel, onSelect, onApply }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const drawingRef = useRef(false);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [fitted, setFitted] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>('freehand');
  const [vertexCount, setVertexCount] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [fillColor, setFillColor] = useState('#60a5fa');
  const [strokeColor, setStrokeColor] = useState('#1d4ed8');
  const [fillEnabled, setFillEnabled] = useState(false);
  const [strokeEnabled, setStrokeEnabled] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { imageRef.current = image; setReady(true); };
    image.src = sourceUrl;
    return () => { imageRef.current = undefined; };
  }, [sourceUrl]);

  useEffect(() => {
    const stage = stageRef.current, image = imageRef.current;
    if (!ready || !stage || !image) return;
    const measure = () => {
      const availableWidth = Math.max(1, stage.clientWidth);
      const availableHeight = Math.max(1, stage.clientHeight);
      const scale = Math.min(1, availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
      setFitted({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [ready]);

  const resetDraw = () => {
    drawingRef.current = false;
    pointsRef.current = [];
    cursorRef.current = null;
    rectStartRef.current = null;
    setVertexCount(0);
    setDrawn(false);
    drawPreview();
  };

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    resetDraw();
  };

  const drawPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const points = pointsRef.current;
    if (points.length === 0) return;

    if (drawn) {
      // Frozen shape, previewed exactly as "Áp dụng" would bake it — full
      // opacity, no fake transparency, so what you see is what you get.
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) context.lineTo(p.x, p.y);
      context.closePath();
      if (fillEnabled) {
        context.fillStyle = fillColor;
        context.fill();
      }
      if (strokeEnabled) {
        context.strokeStyle = strokeColor;
        context.lineWidth = 2.5;
        context.setLineDash([]);
        context.stroke();
      }
      return;
    }

    if (mode === 'freehand' || mode === 'rectangle') {
      if (points.length < 2) return;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) context.lineTo(p.x, p.y);
      context.closePath();
      context.fillStyle = 'rgba(147, 51, 234, .25)';
      context.fill();
      context.strokeStyle = '#9333ea';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.stroke();
      return;
    }

    // Polygon mode: placed segments, filled once closed enough to matter,
    // a rubber-band line to the cursor, and a marker at each vertex.
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) context.lineTo(p.x, p.y);
    if (points.length >= 3) {
      context.closePath();
      context.fillStyle = 'rgba(147, 51, 234, .18)';
      context.fill();
    }
    context.strokeStyle = '#9333ea';
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.stroke();

    const cursor = cursorRef.current;
    if (cursor) {
      context.beginPath();
      context.moveTo(points[points.length - 1].x, points[points.length - 1].y);
      context.lineTo(cursor.x, cursor.y);
      context.strokeStyle = 'rgba(147, 51, 234, .6)';
      context.setLineDash([3, 3]);
      context.stroke();
    }

    context.setLineDash([]);
    points.forEach((p, i) => {
      context.beginPath();
      context.arc(p.x, p.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
      context.fillStyle = i === 0 ? '#facc15' : '#9333ea';
      context.fill();
      context.strokeStyle = '#fff';
      context.lineWidth = 1.5;
      context.stroke();
    });
  };

  // Re-render the frozen preview whenever the fill/stroke controls change.
  useEffect(() => { if (drawn) drawPreview(); }, [drawn, fillColor, strokeColor, fillEnabled, strokeEnabled]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  /** Converts the frozen display-space shape into full-image pixel points,
   *  or null (and resets) if it's not a usable shape. */
  const imageSpacePoints = (): { x: number; y: number }[] | null => {
    const image = imageRef.current;
    const points = pointsRef.current;
    if (!image || points.length < 3 || fitted.width === 0) { resetDraw(); return null; }
    const scale = image.naturalWidth / fitted.width;
    const imagePoints = points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const xs = imagePoints.map((p) => p.x), ys = imagePoints.map((p) => p.y);
    const shapeW = Math.max(...xs) - Math.min(...xs), shapeH = Math.max(...ys) - Math.min(...ys);
    if (shapeW < 8 || shapeH < 8) { resetDraw(); return null; }
    return imagePoints;
  };

  /** Rasterizes the traced shape into a full-image mask and reports it for
   *  use as a region mask on the next Generate — unchanged from before. */
  const useAsMask = () => {
    const image = imageRef.current;
    const imagePoints = imageSpacePoints();
    if (!image || !imagePoints) return;

    // Full-image grayscale mask (black background, white = inside the traced
    // shape, blurred edge to feather) — used both to guide AI models that
    // support a real inpainting mask, and to blend the final result back so
    // only this area actually changes regardless of model support.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = image.naturalWidth;
    maskCanvas.height = image.naturalHeight;
    const maskContext = maskCanvas.getContext('2d')!;
    maskContext.fillStyle = '#000';
    maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskContext.beginPath();
    maskContext.moveTo(imagePoints[0].x, imagePoints[0].y);
    for (const p of imagePoints.slice(1)) maskContext.lineTo(p.x, p.y);
    maskContext.closePath();
    maskContext.filter = 'blur(8px)';
    maskContext.fillStyle = '#fff';
    maskContext.fill();

    onSelect({ points: imagePoints, maskBase64: maskCanvas.toDataURL('image/png').split(',')[1] });
  };

  /** Bakes the fill+stroke shape directly onto the image and hands the
   *  result back — for prompting the AI against a visible marker. */
  const applyColors = async () => {
    const image = imageRef.current;
    const imagePoints = imageSpacePoints();
    if (!image || !imagePoints || (!fillEnabled && !strokeEnabled)) return;
    setApplying(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      context.beginPath();
      context.moveTo(imagePoints[0].x, imagePoints[0].y);
      for (const p of imagePoints.slice(1)) context.lineTo(p.x, p.y);
      context.closePath();
      if (fillEnabled) {
        context.fillStyle = fillColor;
        context.fill();
      }
      if (strokeEnabled) {
        const strokeWidth = Math.max(3, Math.round(Math.min(image.naturalWidth, image.naturalHeight) * 0.0025));
        context.strokeStyle = strokeColor;
        context.lineWidth = strokeWidth;
        context.lineJoin = 'round';
        context.stroke();
      }
      onApply(canvas.toDataURL('image/png').split(',')[1]);
    } finally {
      setApplying(false);
    }
  };

  /** Freezes the shape and immediately registers it as the region mask —
   *  drawing a shape already means "use this", no separate confirm click.
   *  "Áp dụng" (bake colors) remains available as an extra step afterward. */
  const commitShape = () => {
    setDrawn(true);
    useAsMask();
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || drawn) return;
    if (mode === 'freehand') {
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      pointsRef.current = [point(event)];
      return;
    }
    if (mode === 'rectangle') {
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      const start = point(event);
      rectStartRef.current = start;
      pointsRef.current = rectCorners(start, start);
      return;
    }
    // Polygon mode: each click adds a vertex; clicking back near the first
    // vertex closes the shape. No pointer capture — clicks are discrete.
    const next = point(event);
    const existing = pointsRef.current;
    if (existing.length >= 3) {
      const first = existing[0];
      if (Math.hypot(next.x - first.x, next.y - first.y) <= CLOSE_RADIUS) {
        commitShape();
        return;
      }
    }
    pointsRef.current = [...existing, next];
    setVertexCount(pointsRef.current.length);
    drawPreview();
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drawn) return;
    if (mode === 'freehand') {
      if (!drawingRef.current) return;
      pointsRef.current.push(point(event));
      drawPreview();
      return;
    }
    if (mode === 'rectangle') {
      if (!drawingRef.current || !rectStartRef.current) return;
      pointsRef.current = rectCorners(rectStartRef.current, point(event));
      drawPreview();
      return;
    }
    if (pointsRef.current.length === 0) return;
    cursorRef.current = point(event);
    drawPreview();
  };
  const pointerUp = () => {
    if ((mode !== 'freehand' && mode !== 'rectangle') || !drawingRef.current) return;
    drawingRef.current = false;
    if (pointsRef.current.length >= 3) commitShape();
    else resetDraw();
  };
  const doubleClick = () => {
    if (mode === 'polygon' && !drawn && pointsRef.current.length >= 3) commitShape();
  };
  const undoVertex = () => {
    if (drawn) return;
    pointsRef.current = pointsRef.current.slice(0, -1);
    setVertexCount(pointsRef.current.length);
    drawPreview();
  };

  return (
    <div className="region-select-overlay" role="dialog" aria-modal="true" aria-label="Chọn vùng chỉnh sửa">
      <div className="region-select-hint">
        {!drawn && <div className="region-select-modes">
          <button className={mode === 'freehand' ? 'active' : ''} onClick={() => changeMode('freehand')}>✏ Vẽ tự do</button>
          <button className={mode === 'rectangle' ? 'active' : ''} onClick={() => changeMode('rectangle')}>⬜ Chữ nhật</button>
          <button className={mode === 'polygon' ? 'active' : ''} onClick={() => changeMode('polygon')}>📐 Nối điểm</button>
        </div>}
        {drawn && <div className="region-select-colors">
          <ColorChip label="Nền" enabled={fillEnabled} onToggle={setFillEnabled} color={fillColor} onColorChange={setFillColor} />
          <ColorChip label="Viền" enabled={strokeEnabled} onToggle={setStrokeEnabled} color={strokeColor} onColorChange={setStrokeColor} />
        </div>}
        {!drawn && (
          <span>
            {mode === 'freehand'
              ? 'Vẽ quanh vùng muốn AI chỉnh sửa, thả chuột để hoàn tất.'
              : mode === 'rectangle'
                ? 'Kéo chuột để vẽ khung chữ nhật, thả chuột để hoàn tất.'
                : 'Click từng điểm để nối thành vùng, click lại điểm đầu (vàng) hoặc double-click để hoàn tất.'}
          </span>
        )}
        <div className="region-select-actions">
          {!drawn && mode === 'polygon' && vertexCount > 0 && (
            <button onClick={undoVertex}>↶ Xoá điểm cuối</button>
          )}
          {!drawn && mode === 'polygon' && vertexCount >= 3 && (
            <button onClick={commitShape}>✓ Hoàn tất nét vẽ</button>
          )}
          {drawn && <button onClick={resetDraw}>↺ Vẽ lại</button>}
          {drawn && (
            <button
              className="primary"
              disabled={applying || (!fillEnabled && !strokeEnabled)}
              onClick={() => void applyColors()}
            >
              {applying ? 'Đang áp dụng…' : '🖌 Áp dụng'}
            </button>
          )}
          <button onClick={onCancel}>Hủy</button>
        </div>
      </div>
      <div ref={stageRef} className="region-select-stage">
        {ready && fitted.width > 0 && <>
          <img className="region-select-image" src={sourceUrl} alt="" draggable={false}
            style={{ width: fitted.width, height: fitted.height }} />
          <canvas
            ref={canvasRef}
            width={fitted.width}
            height={fitted.height}
            style={{ width: fitted.width, height: fitted.height }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={(mode === 'freehand' || mode === 'rectangle') && !drawn ? resetDraw : undefined}
            onDoubleClick={doubleClick}
          />
        </>}
        {!ready && <span className="region-select-loading">Đang tải ảnh…</span>}
      </div>
    </div>
  );
}
