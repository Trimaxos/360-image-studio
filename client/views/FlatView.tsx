import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer } from '../../shared/types';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import RectSelectionOverlay from '../components/RectSelectionOverlay';
import { MarkDrawOverlay, MarksSvgLayer } from '../components/MarksOverlay';

const OVERLAY_MAX_WIDTH = 4096;
const appliedVariantOf = (layer: Layer) => layer.variants?.find((variant) => variant.applied);
/** A layer whose applied result is part of the changes (the server leaves the others out too). */
const hasAppliedResult = (layer: Layer) => layer.status === 'committed' && !!appliedVariantOf(layer);
/** What a layer's pixels in the overlay depend on: not its prompt, its name or the results it is not showing. */
const pictureKey = (layer: Layer) => {
  const applied = appliedVariantOf(layer)!;
  return [layer.id, layer.order, layer.tileCoords, applied.id, applied.resultImageId, applied.equirectImageId ?? layer.equirectImageId,
    applied.needsFit ?? false, applied.visibilityMask?.base64Mask ?? ''];
};

export default function FlatView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imagePath = useProjectStore((state) => state.imagePath);
  const imageWidth = useProjectStore((state) => state.imageWidth);
  const imageHeight = useProjectStore((state) => state.imageHeight);
  const workflow = useProjectStore((state) => state.workflow);
  const enterRectSelect = useProjectStore((state) => state.enterRectSelect);
  const marks = useProjectStore((state) => state.marks);
  const marksUi = useProjectStore((state) => state.marksUi);
  const layers = useProjectStore((state) => state.layers);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  // The toggle belongs to the image it was turned on for: another image starts with it off.
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const changesOn = changesFor !== null && changesFor === imagePath;
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [changesBusy, setChangesBusy] = useState(false);
  const [changesError, setChangesError] = useState('');

  // The Flat View is a clean map (original, grid, boxes): layers are looked at in the 360 view, or all at once
  // through "Xem thay đổi", one merged picture the server builds.
  const appliedLayers = useMemo(() => layers.filter(hasAppliedResult), [layers]);
  const shownLayers = useMemo(() => appliedLayers.filter((layer) => layer.visible !== false), [appliedLayers]);
  const changesKey = useMemo(() => JSON.stringify(shownLayers.map(pictureKey)), [shownLayers]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imagePath]);

  // Ask again whenever what the picture is made of changes; an answer that is no longer wanted (a newer request,
  // the toggle turned off) is dropped.
  useEffect(() => {
    if (!changesOn || !imagePath || shownLayers.length === 0) {
      setChangesBusy(false);
      if (shownLayers.length === 0) setOverlayId(null);
      return;
    }
    let wanted = true;
    setChangesBusy(true);
    setChangesError('');
    api.image.changesOverlay({ imagePath, layers: shownLayers, maxWidth: OVERLAY_MAX_WIDTH })
      .then((overlay) => {
        if (!wanted) return;
        setOverlayId(overlay.overlayId);
        setChangesBusy(false);
      })
      .catch((error) => {
        if (!wanted) return;
        setOverlayId(null);
        setChangesError(error instanceof Error ? error.message : String(error));
        setChangesBusy(false);
      });
    return () => { wanted = false; };
  }, [changesOn, imagePath, changesKey]);

  const toggleChanges = () => {
    setChangesFor(changesOn ? null : imagePath);
    setOverlayId(null);
    setChangesError('');
  };

  // The selection overlay (and the mark-drawing overlay) maps pointer positions
  // against the contain-fit image, so any zoom/pan left over from viewing would
  // shift the crop.
  useEffect(() => {
    if (workflow !== 'viewing' || marksUi.draw) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [workflow, marksUi.draw]);

  return (
    <div
      ref={containerRef}
      className="flat-view-container"
      onWheel={(event) => {
        if (workflow !== 'viewing' || marksUi.draw) return;
        event.preventDefault();
        setZoom((value) => Math.max(0.25, Math.min(6, value - event.deltaY * 0.001)));
      }}
      onPointerDown={(event) => {
        if (workflow !== 'viewing' || marksUi.draw || event.button !== 1) return;
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
          {workflow === 'viewing' && changesOn && overlayId && (
            <image
              className="flat-changes"
              href={api.image.cacheUrl(overlayId)}
              x={0}
              y={0}
              width={imageWidth}
              height={imageHeight}
              preserveAspectRatio="none"
              pointerEvents="none"
            />
          )}
          {marksUi.open && (
            <MarksSvgLayer width={imageWidth} height={imageHeight} marks={marks} grid={marksUi.grid} />
          )}
        </svg>
      )}
      {workflow === 'viewing' && appliedLayers.length > 0 && (
        <div className="flat-changes-bar">
          <button
            className={`flat-changes-btn ${changesOn ? 'active' : ''}`}
            aria-pressed={changesOn}
            aria-busy={changesBusy}
            title="Xem mọi thay đổi đã áp dụng, gộp thành một lớp trong suốt trên ảnh gốc"
            onClick={toggleChanges}
          >
            {changesBusy ? '⏳ Đang dựng…' : '👁 Xem thay đổi'}
          </button>
          {changesOn && changesError && <span className="flat-changes-error" role="alert">{changesError}</span>}
        </div>
      )}
      {workflow === 'viewing' && !marksUi.draw && (
        <button className="edit-here-btn" onClick={() => enterRectSelect('flat')}>🔒 Edit Here</button>
      )}
      {workflow === 'viewing' && marksUi.open && marksUi.draw && (
        <MarkDrawOverlay imageWidth={imageWidth} imageHeight={imageHeight} />
      )}
      {workflow === 'rect-select' && <RectSelectionOverlay sourceView="flat" />}
    </div>
  );
}
