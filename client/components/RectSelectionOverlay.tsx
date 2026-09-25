import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import type { SelectionDraft } from '../../shared/types';
import {
  clampPoint,
  containRect,
  dragRect,
  mapViewportRectToImage,
  SELECTION_RATIOS,
  type Size,
  type Point,
  type Rect,
} from './rect-selection';

export default function RectSelectionOverlay({
  sourceView,
}: {
  sourceView: '360' | 'flat';
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<Point | null>(null);
  const applyingRef = useRef(false);
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);
  const [fullFrame, setFullFrame] = useState(false);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const state = useProjectStore();
  const hasRect = rect.width >= 8 && rect.height >= 8;

  useEffect(() => {
    const element = overlayRef.current!;
    let previous = { width: 0, height: 0 };
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === previous.width && height === previous.height) return;
      // A resized viewport invalidates the screen-space drag; never apply a
      // stale rectangle to a differently sized image/view.
      if (previous.width) {
        setRect({ x: 0, y: 0, width: 0, height: 0 });
        setFullFrame(false);
        startRef.current = null;
      }
      previous = { width, height };
      setViewport(previous);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bounds = (box: DOMRect): Rect => sourceView === 'flat'
    ? containRect(
        { width: box.width, height: box.height },
        { width: state.imageWidth, height: state.imageHeight },
      )
    : { x: 0, y: 0, width: box.width, height: box.height };
  const point = (event: React.PointerEvent, box: DOMRect): Point => {
    const selectionBounds = bounds(box);
    return clampPoint(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      selectionBounds,
    );
  };
  const apply = async () => {
    if (applyingRef.current || !hasRect) return;
    applyingRef.current = true;
    const box = overlayRef.current!.getBoundingClientRect();
    const selectionBounds = bounds(box);
    const selected = rect;
    const mode = fullFrame ? 'full-frame' : 'free-select';
    setApplying(true);
    setError('');
    try {
      const viewPose = state.viewLock ?? state.viewPose;
      const selection: SelectionDraft = {
        sourceView,
        mode,
        rect: selected,
        viewport: { width: box.width, height: box.height },
        tileCoords: sourceView === 'flat'
          ? mapViewportRectToImage(
              selected,
              selectionBounds,
              { width: state.imageWidth, height: state.imageHeight },
            )
          : { x: 0, y: 0, w: Math.round(selected.width), h: Math.round(selected.height) },
        viewPose,
        prompt: '',
      };

      if (sourceView === 'flat') {
        // Flat view — no perspective rendering needed
        state.createPerspectiveLayer(selection, '', selection.tileCoords.w, selection.tileCoords.h);
      } else {
        // 360 view — server-side perspective render, always from the
        // untouched source panorama (no layer compositing) to keep this
        // fast. Pick non-overlapping selections to avoid stacking edits.
        if (!state.imagePath) throw new Error('Chưa mở ảnh panorama.');
        const result = await api.image.perspectiveRender({
          imagePath: state.imagePath,
          layers: [],
          viewPose,
          viewport: { width: box.width, height: box.height },
          rect: selected,
          mode,
          scaleFactor: 1,
          alignToModel: false,
        });
        // The server's rectangle is authoritative for later reprojection.
        selection.rect = result.rect ?? selection.rect;
        selection.tileCoords = { x: 0, y: 0, w: result.width, h: result.height };
        state.createPerspectiveLayer(selection, result.resultImageId, result.width, result.height);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tạo được vùng chỉnh sửa.');
      setApplying(false);
      applyingRef.current = false;
    }
  };

  return (
    <div
      ref={overlayRef}
      className={`rect-select-overlay ${applying ? 'applying' : ''}`}
      aria-busy={applying}
      onPointerDown={(event) => {
        if (applying) return;
        if (event.button !== 0) return;
        const box = overlayRef.current!.getBoundingClientRect();
        const p = point(event, box);
        startRef.current = p;
        setFullFrame(false);
        setError('');
        setRect({ ...p, width: 0, height: 0 });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (applying) return;
        if (!startRef.current) return;
        const box = overlayRef.current!.getBoundingClientRect();
        setRect(dragRect(startRef.current, point(event, box), bounds(box), ratioWidth / ratioHeight));
      }}
      onPointerUp={(event) => {
        if (applying) return;
        if (!startRef.current) return;
        const box = overlayRef.current!.getBoundingClientRect();
        setRect(dragRect(startRef.current, point(event, box), bounds(box), ratioWidth / ratioHeight));
        startRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { startRef.current = null; }}
    >
      {hasRect && <div className="selection-rect" style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}>
        <span>{Math.round(rect.width)} × {Math.round(rect.height)}{!fullFrame && ` · ${aspectRatio}`}</span>
      </div>}
      <div className="rect-actions" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rect-crop-options">
          <label>
            Tỉ lệ khung
            <select aria-label="Tỉ lệ khung" value={aspectRatio} disabled={applying}
              onChange={(event) => {
                setAspectRatio(event.target.value);
                setRect({ x: 0, y: 0, width: 0, height: 0 });
                setFullFrame(false);
                startRef.current = null;
                setError('');
              }}>
              {SELECTION_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
          </label>
          <span>Chọn tỉ lệ trước khi vẽ khung · Full Frame chọn toàn bộ khung hình</span>
        </div>
        <button disabled={applying} onClick={() => state.leaveCanvas('discard')}>Cancel</button>
        <button disabled={applying} onClick={() => {
          setRect(bounds(overlayRef.current!.getBoundingClientRect()));
          setFullFrame(true);
          setError('');
        }}>Full Frame</button>
        <button className="primary" disabled={!hasRect || applying} onClick={() => void apply()}>{applying ? 'Đang chuẩn bị…' : 'Apply Rect'}</button>
      </div>
      {applying && (
        <div className="rect-apply-progress" role="status" aria-live="polite">
          <span className="inline-spinner" />
          <div>
            <strong>Đang chuẩn bị vùng chỉnh sửa…</strong>
            <span>Đang dựng ảnh phối cảnh từ panorama.</span>
            <small>Ảnh panorama lớn có thể cần một chút thời gian.</small>
          </div>
        </div>
      )}
      {error && <div className="rect-error">{error}</div>}
    </div>
  );
}
