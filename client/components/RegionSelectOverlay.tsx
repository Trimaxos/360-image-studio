import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RegionEdit } from '../stores/project';

interface Props {
  sourceUrl: string;
  onCancel: () => void;
  onSelect: (region: RegionEdit) => void;
}

type Mode = 'freehand' | 'polygon';

/** Points within this many display px of the first vertex close the polygon. */
const CLOSE_RADIUS = 12;

/** Draw over the currently displayed image to mark the area Generate should
 *  keep the AI's edit within (see RegionEdit) — either by dragging a
 *  freeform lasso, or by clicking vertices to connect into a polygon. */
export default function RegionSelectOverlay({ sourceUrl, onCancel, onSelect }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const drawingRef = useRef(false);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [fitted, setFitted] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>('freehand');
  const [vertexCount, setVertexCount] = useState(0);

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
    setVertexCount(0);
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

    if (mode === 'freehand') {
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

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  /** Rasterizes the traced shape (display-space points) into a full-image
   *  mask and reports it — shared by both drawing modes. */
  const finalize = (points: { x: number; y: number }[]) => {
    const image = imageRef.current;
    if (!image || points.length < 3 || fitted.width === 0) return resetDraw();

    const scale = image.naturalWidth / fitted.width;
    const imagePoints = points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const xs = imagePoints.map((p) => p.x), ys = imagePoints.map((p) => p.y);
    const shapeW = Math.max(...xs) - Math.min(...xs), shapeH = Math.max(...ys) - Math.min(...ys);
    if (shapeW < 8 || shapeH < 8) return resetDraw();

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

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    if (mode === 'freehand') {
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      pointsRef.current = [point(event)];
      return;
    }
    // Polygon mode: each click adds a vertex; clicking back near the first
    // vertex closes the shape. No pointer capture — clicks are discrete.
    const next = point(event);
    const existing = pointsRef.current;
    if (existing.length >= 3) {
      const first = existing[0];
      if (Math.hypot(next.x - first.x, next.y - first.y) <= CLOSE_RADIUS) {
        finalize(existing);
        return;
      }
    }
    pointsRef.current = [...existing, next];
    setVertexCount(pointsRef.current.length);
    drawPreview();
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'freehand') {
      if (!drawingRef.current) return;
      pointsRef.current.push(point(event));
      drawPreview();
      return;
    }
    if (pointsRef.current.length === 0) return;
    cursorRef.current = point(event);
    drawPreview();
  };
  const pointerUp = () => {
    if (mode !== 'freehand' || !drawingRef.current) return;
    drawingRef.current = false;
    finalize(pointsRef.current);
  };
  const doubleClick = () => {
    if (mode === 'polygon' && pointsRef.current.length >= 3) finalize(pointsRef.current);
  };
  const undoVertex = () => {
    pointsRef.current = pointsRef.current.slice(0, -1);
    setVertexCount(pointsRef.current.length);
    drawPreview();
  };

  return (
    <div className="region-select-overlay" role="dialog" aria-modal="true" aria-label="Chọn vùng chỉnh sửa">
      <div className="region-select-hint">
        <div className="region-select-modes">
          <button className={mode === 'freehand' ? 'active' : ''} onClick={() => changeMode('freehand')}>✏ Vẽ tự do</button>
          <button className={mode === 'polygon' ? 'active' : ''} onClick={() => changeMode('polygon')}>📐 Nối điểm</button>
        </div>
        <span>
          {mode === 'freehand'
            ? 'Vẽ quanh vùng muốn AI chỉnh sửa, thả chuột để hoàn tất.'
            : 'Click từng điểm để nối thành vùng, click lại điểm đầu (vàng) hoặc double-click để hoàn tất.'}
        </span>
        <div className="region-select-actions">
          {mode === 'polygon' && vertexCount > 0 && (
            <button onClick={undoVertex}>↶ Xoá điểm cuối</button>
          )}
          {mode === 'polygon' && vertexCount >= 3 && (
            <button className="primary" onClick={() => finalize(pointsRef.current)}>✓ Hoàn tất</button>
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
            onPointerCancel={mode === 'freehand' ? resetDraw : undefined}
            onDoubleClick={doubleClick}
          />
        </>}
        {!ready && <span className="region-select-loading">Đang tải ảnh…</span>}
      </div>
    </div>
  );
}
