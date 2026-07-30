import React, { useRef, useState } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import type { SelectionDraft } from '../../shared/types';
import {
  clampPoint,
  containRect,
  dragRect,
  mapViewportRectToImage,
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
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const state = useProjectStore();
  const hasRect = rect.width >= 8 && rect.height >= 8;

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
  const apply = async (mode: 'full-frame' | 'free-select') => {
    const box = overlayRef.current!.getBoundingClientRect();
    const selectionBounds = bounds(box);
    const selected = mode === 'full-frame'
      ? selectionBounds
      : rect;
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
        // 360 view — server-side perspective render
        if (!state.imagePath) throw new Error('Chưa mở ảnh panorama.');
        const result = await api.image.perspectiveRender({
          imagePath: state.imagePath,
          viewPose,
          viewport: { width: box.width, height: box.height },
          rect: selected,
          mode,
        });
        state.createPerspectiveLayer(selection, result.resultImageId, result.width, result.height);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tạo được vùng chỉnh sửa.');
      setApplying(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="rect-select-overlay"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const box = overlayRef.current!.getBoundingClientRect();
        const p = point(event, box);
        startRef.current = p;
        setRect({ ...p, width: 0, height: 0 });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!startRef.current) return;
        const box = overlayRef.current!.getBoundingClientRect();
        setRect(dragRect(startRef.current, point(event, box), bounds(box)));
      }}
      onPointerUp={(event) => {
        if (!startRef.current) return;
        const box = overlayRef.current!.getBoundingClientRect();
        setRect(dragRect(startRef.current, point(event, box), bounds(box)));
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
        <span>{Math.round(rect.width)} × {Math.round(rect.height)}</span>
      </div>}
      <div className="rect-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => state.leaveCanvas('discard')}>Cancel</button>
        <button disabled={applying} onClick={() => void apply('full-frame')}>Full Frame</button>
        <button className="primary" disabled={!hasRect || applying} onClick={() => void apply('free-select')}>Apply Rect</button>
      </div>
      {error && <div className="rect-error">{error}</div>}
    </div>
  );
}
