import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LayerVariant } from '../../shared/types';
import { api } from '../lib/api';
import {
  MIN_TRANSFORM_SIZE,
  moveRect,
  resizeRect,
  type TransformHandle,
  type TransformRect,
} from '../lib/transform-rect';
import { useProjectStore } from '../stores/project';

interface Props {
  layerId: string;
  variant: LayerVariant;
  /** Tile gốc (chưa AI/cắt) để đối chiếu khi căn chỉnh. */
  originalUrl: string;
  onCommit: () => void;
  onCancel: () => void;
}

type DragState =
  | { kind: 'move'; startX: number; startY: number; rect: TransformRect }
  | { kind: 'handle'; handle: TransformHandle; rect: TransformRect };

const HANDLE_DISPLAY_PX = 14;

const HANDLE_CURSORS: Record<TransformHandle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

export default function VariantTransformEditor({ layerId, variant, originalUrl, onCommit, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const originalRef = useRef<HTMLImageElement | null>(null);
  const rectRef = useRef<TransformRect | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [opacity, setOpacity] = useState(100);
  const [, refresh] = useState(0);

  // zustand v5 feeds selectors straight into useSyncExternalStore without
  // memoization — only primitives / stable references may be selected.
  const tileW = useProjectStore((state) => state.layers.find((item) => item.id === layerId)?.tileCoords.w ?? 0);
  const tileH = useProjectStore((state) => state.layers.find((item) => item.id === layerId)?.tileCoords.h ?? 0);

  const containRect = useCallback((): TransformRect | null => {
    const image = imageRef.current;
    if (!image || !tileW || !tileH) return null;
    const scale = Math.min(tileW / image.naturalWidth, tileH / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const left = (tileW - width) / 2;
    const top = (tileH - height) / 2;
    return { left, top, right: left + width, bottom: top + height };
  }, [tileW, tileH]);

  const coverRect = useCallback((): TransformRect | null => {
    const image = imageRef.current;
    if (!image || !tileW || !tileH) return null;
    const scale = Math.max(tileW / image.naturalWidth, tileH / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const left = (tileW - width) / 2;
    const top = (tileH - height) / 2;
    return { left, top, right: left + width, bottom: top + height };
  }, [tileW, tileH]);

  const commitRect = useCallback((rect: TransformRect | null) => {
    rectRef.current = rect;
    refresh((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setLoadError('');
    const source = new Image();
    source.crossOrigin = 'anonymous';
    source.onload = () => {
      if (cancelled) return;
      imageRef.current = source;
      const canvas = canvasRef.current;
      if (canvas && tileW > 0 && tileH > 0) {
        canvas.width = tileW;
        canvas.height = tileH;
      }
      const scale = Math.min(tileW / source.naturalWidth, tileH / source.naturalHeight);
      const width = source.naturalWidth * scale;
      const height = source.naturalHeight * scale;
      const left = (tileW - width) / 2;
      const top = (tileH - height) / 2;
      rectRef.current = { left, top, right: left + width, bottom: top + height };
      setReady(true);
      refresh((value) => value + 1);
    };
    source.onerror = () => {
      if (!cancelled) setLoadError('Không tải được ảnh nguồn để căn chỉnh.');
    };
    source.src = api.image.cacheUrl(variant.resultImageId);
    return () => { cancelled = true; imageRef.current = null; };
  }, [variant.resultImageId, tileW, tileH]);

  useEffect(() => {
    let cancelled = false;
    if (!originalUrl) return;
    const original = new Image();
    original.crossOrigin = 'anonymous';
    original.onload = () => {
      if (cancelled) return;
      originalRef.current = original;
      refresh((value) => value + 1);
    };
    original.src = originalUrl;
    return () => { cancelled = true; originalRef.current = null; };
  }, [originalUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const rect = rectRef.current;
    if (!canvas || !image || !rect || tileW <= 0 || tileH <= 0) return;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0b0f16';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Ảnh gốc bên dưới để đối chiếu khi căn chỉnh
    const original = originalRef.current;
    if (original) {
      context.globalAlpha = 1;
      context.drawImage(original, 0, 0, tileW, tileH);
    }

    // Lớp đang căn chỉnh — độ mờ chỉnh được để nhìn xuyên xuống ảnh gốc
    context.globalAlpha = opacity / 100;
    context.drawImage(image, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.globalAlpha = 1;

    // Biên ảnh (có thể tràn ra ngoài khung)
    context.save();
    context.strokeStyle = 'rgba(255,255,255,.5)';
    context.setLineDash([8, 6]);
    context.lineWidth = 1.5;
    context.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    context.restore();

    // Khung tile cố định
    context.strokeStyle = '#4dd0e1';
    context.lineWidth = 2;
    context.strokeRect(1, 1, tileW - 2, tileH - 2);

    // Tay nắm: 4 góc + 4 cạnh (kéo cạnh để giãn ngang/dọc tự do)
    const bounds = canvas.getBoundingClientRect();
    const k = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const half = (HANDLE_DISPLAY_PX / 2) * k;
    context.fillStyle = '#4dd0e1';
    for (const [hx, hy] of handlePoints(rect)) {
      context.fillRect(hx - half, hy - half, half * 2, half * 2);
    }

    context.strokeStyle = 'rgba(77,208,225,.7)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(tileW / 2 - 10 * k, tileH / 2);
    context.lineTo(tileW / 2 + 10 * k, tileH / 2);
    context.moveTo(tileW / 2, tileH / 2 - 10 * k);
    context.lineTo(tileW / 2, tileH / 2 + 10 * k);
    context.stroke();
  }, [opacity, tileW, tileH]);

  useEffect(() => { if (ready) draw(); });

  const toCanvas = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const scaleX = event.currentTarget.width / (bounds.width || 1);
    const scaleY = event.currentTarget.height / (bounds.height || 1);
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY,
      displayK: scaleX,
    };
  };

  const hitHandle = (x: number, y: number, displayK: number): TransformHandle | null => {
    const rect = rectRef.current;
    if (!rect) return null;
    const r = HANDLE_DISPLAY_PX * displayK;
    for (const [id, hx, hy] of handleList(rect)) {
      if (Math.abs(x - hx) <= r && Math.abs(y - hy) <= r) return id;
    }
    return null;
  };

  const startDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || !rectRef.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y, displayK } = toCanvas(event);
    const handle = hitHandle(x, y, displayK);
    dragRef.current = handle
      ? { kind: 'handle', handle, rect: { ...rectRef.current } }
      : { kind: 'move', startX: x, startY: y, rect: { ...rectRef.current } };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const { x, y, displayK } = toCanvas(event);
    const drag = dragRef.current;
    if (!drag) {
      const handle = hitHandle(x, y, displayK);
      event.currentTarget.style.cursor = handle ? HANDLE_CURSORS[handle] : 'grab';
      return;
    }
    const next = drag.kind === 'move'
      ? moveRect(drag.rect, x - drag.startX, y - drag.startY)
      : resizeRect(drag.rect, drag.handle, { x, y }, event.shiftKey);
    rectRef.current = next;
    draw();
    refresh((value) => value + 1);
  };

  const stopDrag = () => { dragRef.current = null; };

  const commit = async () => {
    const image = imageRef.current;
    const rect = rectRef.current;
    if (!image || !rect || tileW <= 0 || tileH <= 0) return;
    const rectW = rect.right - rect.left;
    const rectH = rect.bottom - rect.top;
    if (rectW < MIN_TRANSFORM_SIZE || rectH < MIN_TRANSFORM_SIZE) {
      setCommitError('Vùng cắt quá nhỏ.');
      return;
    }
    setCommitting(true);
    setCommitError('');
    try {
      const output = document.createElement('canvas');
      output.width = tileW;
      output.height = tileH;
      const context = output.getContext('2d')!;
      const sourceW = tileW * image.naturalWidth / rectW;
      const sourceH = tileH * image.naturalHeight / rectH;
      const sourceX = (0 - rect.left) * image.naturalWidth / rectW;
      const sourceY = (0 - rect.top) * image.naturalHeight / rectH;
      context.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, tileW, tileH);
      const base64Result = output.toDataURL('image/png').split(',')[1];
      const { resultImageId } = await api.image.saveResultCache(base64Result);
      useProjectStore.getState().updateVariantResult(layerId, variant.id, {
        resultImageId,
        width: tileW,
        height: tileH,
      });
      onCommit();
    } catch (reason) {
      setCommitError(reason instanceof Error ? reason.message : 'Không thể áp dụng cắt.');
    } finally {
      setCommitting(false);
    }
  };

  if (!tileW || !tileH) return <div className="transform-error">Không tìm thấy layer.</div>;

  const rect = rectRef.current;
  const image = imageRef.current;
  const contain = containRect();
  const scalePct = rect && contain
    ? Math.round(((rect.right - rect.left) / (contain.right - contain.left)) * 100)
    : 100;
  const coverage = rect && image
    ? Math.min(100, Math.round(
      ((rect.right - rect.left) * (rect.bottom - rect.top))
      / (image.naturalWidth * image.naturalHeight) * 100,
    ))
    : 100;

  return (
    <div className="variant-transform">
      <div className="variant-transform-toolbar">
        <button onClick={() => commitRect(containRect())} title="Thu nhỏ để thấy toàn bộ ảnh">Vừa khung</button>
        <button onClick={() => commitRect(coverRect())} title="Phóng to để lấp đầy khung">Vừa khít</button>
        <label className="variant-transform-opacity">
          Độ mờ <strong>{opacity}%</strong>
          <input type="range" min={0} max={100} value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))} />
        </label>
        <span className="variant-transform-info">{scalePct}% · giữ {coverage}% ảnh nguồn</span>
        <button className="primary" disabled={!ready || committing} onClick={() => void commit()}>
          {committing ? 'Đang áp dụng…' : '✓ Áp dụng cắt'}
        </button>
        <button onClick={onCancel}>✕ Bỏ qua</button>
      </div>
      <div className="variant-transform-workspace">
        {!ready && !loadError && <span className="result-mask-loading">Đang tải ảnh…</span>}
        {loadError && <span className="transform-error">{loadError}</span>}
        <canvas
          ref={canvasRef}
          className="variant-transform-canvas"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          style={{ touchAction: 'none' }}
        />
      </div>
      {commitError && <div className="transform-error">{commitError}</div>}
      <div className="variant-transform-hint">
        Kéo trong khung để di chuyển · kéo cạnh để giãn ngang/dọc · kéo góc để phóng to/thu nhỏ · Shift + góc để giữ tỉ lệ
      </div>
    </div>
  );
}

function handlePoints(rect: TransformRect): Array<[number, number]> {
  const midX = (rect.left + rect.right) / 2;
  const midY = (rect.top + rect.bottom) / 2;
  return [
    [rect.left, rect.top], [rect.right, rect.top],
    [rect.left, rect.bottom], [rect.right, rect.bottom],
    [midX, rect.top], [midX, rect.bottom],
    [rect.left, midY], [rect.right, midY],
  ];
}

function handleList(rect: TransformRect): Array<[TransformHandle, number, number]> {
  const midX = (rect.left + rect.right) / 2;
  const midY = (rect.top + rect.bottom) / 2;
  return [
    ['nw', rect.left, rect.top], ['ne', rect.right, rect.top],
    ['sw', rect.left, rect.bottom], ['se', rect.right, rect.bottom],
    ['n', midX, rect.top], ['s', midX, rect.bottom],
    ['w', rect.left, midY], ['e', rect.right, midY],
  ];
}
