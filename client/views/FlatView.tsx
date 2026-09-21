import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import { composeVariantPreview } from '../lib/visibility-mask';
import RectSelectionOverlay from '../components/RectSelectionOverlay';

interface FlatOverlay {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export default function FlatView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imagePath = useProjectStore((state) => state.imagePath);
  const imageWidth = useProjectStore((state) => state.imageWidth);
  const imageHeight = useProjectStore((state) => state.imageHeight);
  const layers = useProjectStore((state) => state.layers);
  const workflow = useProjectStore((state) => state.workflow);
  const enterRectSelect = useProjectStore((state) => state.enterRectSelect);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [maskedSources, setMaskedSources] = useState<Record<string, string>>({});
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const committedLayers = layers
    .filter((layer) => layer.status === 'committed')
    .sort((a, b) => a.order - b.order);
  const overlayKey = committedLayers.map((layer) => {
    const applied = (layer.variants ?? []).find((variant) => variant.applied);
    return `${layer.id}:${applied?.resultImageId ?? ''}:${applied?.visibilityMask?.base64Mask ? 'masked' : ''}`;
  }).join('|');

  // Visibility masks are baked on a tile-sized canvas once per variant, so
  // hiding/showing layers never triggers a full server-side re-composite.
  useEffect(() => {
    let disposed = false;
    const jobs = committedLayers.flatMap((layer) => {
      const applied = (layer.variants ?? []).find((variant) => variant.applied);
      const mask = applied?.visibilityMask?.base64Mask;
      if (!applied || !mask || !imagePath) return [];
      const tileUrl = api.image.tileUrl(
        imagePath, layer.tileCoords.x, layer.tileCoords.y, layer.tileCoords.w, layer.tileCoords.h,
      );
      return [composeVariantPreview(tileUrl, api.image.cacheUrl(applied.resultImageId), mask)
        .then((source) => [layer.id, source] as const)];
    });
    if (!jobs.length) return;
    void Promise.all(jobs)
      .then((entries) => { if (!disposed) setMaskedSources(Object.fromEntries(entries)); })
      .catch(() => { if (!disposed) setMaskedSources({}); });
    return () => { disposed = true; };
  }, [overlayKey, imagePath]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imagePath]);

  // The selection overlay maps pointer positions against the contain-fit
  // image, so any zoom/pan left over from viewing would shift the crop.
  useEffect(() => {
    if (workflow !== 'viewing') {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [workflow]);

  // Layers render as stacked SVG images in source-pixel coordinates — the
  // same approach the 360 viewer uses with PSV meshes, so visibility toggles
  // are pure CSS and need no server round-trip.
  const overlays = committedLayers.flatMap((layer): FlatOverlay[] => {
    const applied = (layer.variants ?? []).find((variant) => variant.applied);
    if (!applied || applied.needsFit) return [];
    const source = applied.visibilityMask?.base64Mask
      ? maskedSources[layer.id]
      : api.image.cacheUrl(applied.resultImageId);
    if (!source) return [];
    return [{
      id: layer.id,
      src: source,
      x: layer.tileCoords.x,
      y: layer.tileCoords.y,
      width: applied.width,
      height: applied.height,
      visible: layer.visible !== false,
    }];
  });

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
      {imagePath && imageWidth > 0 && imageHeight > 0 && (
        <svg
          className="flat-stage"
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <image
            className="flat-image"
            href={api.image.serveUrl(imagePath)}
            x={0}
            y={0}
            width={imageWidth}
            height={imageHeight}
            preserveAspectRatio="none"
          />
          {overlays.map((overlay) => (
            <image
              key={overlay.id}
              className="flat-layer"
              data-layer-id={overlay.id}
              href={overlay.src}
              x={overlay.x}
              y={overlay.y}
              width={overlay.width}
              height={overlay.height}
              preserveAspectRatio="none"
              style={overlay.visible ? undefined : { display: 'none' }}
            />
          ))}
        </svg>
      )}
      {workflow === 'viewing' && (
        <button className="edit-here-btn" onClick={() => enterRectSelect('flat')}>🔒 Edit Here</button>
      )}
      {workflow === 'rect-select' && <RectSelectionOverlay sourceView="flat" />}
    </div>
  );
}
