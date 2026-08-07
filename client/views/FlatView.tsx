import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import RectSelectionOverlay from '../components/RectSelectionOverlay';
import { useCompositePreview } from '../hooks/useCompositePreview';

export default function FlatView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imagePath = useProjectStore((state) => state.imagePath);
  const workflow = useProjectStore((state) => state.workflow);
  const enterRectSelect = useProjectStore((state) => state.enterRectSelect);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const compositePreview = useCompositePreview();
  const dragging = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imagePath]);

  return (
    <div
      ref={containerRef}
      className="flat-view-container"
      onWheel={(event) => {
        if (workflow !== 'viewing') return;
        event.preventDefault();
        setZoom((value) => Math.max(0.25, Math.min(6, value - event.deltaY * 0.001)));
      }}
      onPointerDown={(event) => {
        if (workflow !== 'viewing' || event.button !== 1) return;
        dragging.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        setPan({ x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y });
      }}
      onPointerUp={() => { dragging.current = null; }}
    >
      {imagePath && (
        <img
          className="flat-image"
          src={compositePreview ?? api.image.serveUrl(imagePath)}
          draggable={false}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
      )}
      {workflow === 'viewing' && (
        <button className="edit-here-btn" onClick={() => enterRectSelect('flat')}>🔒 Chỉnh sửa tại đây</button>
      )}
      {workflow === 'rect-select' && <RectSelectionOverlay sourceView="flat" />}
    </div>
  );
}
