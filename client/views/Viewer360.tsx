import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import { degreesToRadians, radiansToDegrees } from '../components/view-controls';
import RectSelectionOverlay from '../components/RectSelectionOverlay';
import { useCompositePreview } from '../hooks/useCompositePreview';

export default function Viewer360() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const applyingPoseRef = useRef(false);
  const [ready, setReady] = useState(false);
  const imagePath = useProjectStore((state) => state.imagePath);
  const workflow = useProjectStore((state) => state.workflow);
  const viewPose = useProjectStore((state) => state.viewPose);
  const updateViewPose = useProjectStore((state) => state.updateViewPose);
  const enterRectSelect = useProjectStore((state) => state.enterRectSelect);
  const compositePreview = useCompositePreview();

  useEffect(() => {
    if (!containerRef.current || !imagePath) return;
    let disposed = false;
    import('@photo-sphere-viewer/core').then(({ Viewer }) => {
      if (disposed || !containerRef.current) return;
      const viewer = new Viewer({
        container: containerRef.current,
        panorama: api.image.serveUrl(imagePath, 4096),
        navbar: false,
        defaultZoomLvl: 27.272727,
        minFov: 10,
        maxFov: 120,
      });
      viewer.addEventListener('ready', () => setReady(true));
      viewer.addEventListener('position-updated', ({ position }: any) => {
        if (applyingPoseRef.current || useProjectStore.getState().workflow !== 'viewing') return;
        updateViewPose({
          yaw: radiansToDegrees(position.yaw),
          pitch: radiansToDegrees(position.pitch),
        });
      });
      viewer.addEventListener('zoom-updated', ({ zoomLevel }: any) => {
        if (applyingPoseRef.current || useProjectStore.getState().workflow !== 'viewing') return;
        updateViewPose({ fov: viewer.dataHelper.zoomLevelToFov(zoomLevel) });
      });
      viewerRef.current = viewer;
    });
    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      setReady(false);
    };
  }, [imagePath, updateViewPose]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    applyingPoseRef.current = true;
    viewer.rotate({
      yaw: degreesToRadians(viewPose.yaw),
      pitch: degreesToRadians(viewPose.pitch),
    });
    viewer.zoom(viewer.dataHelper.fovToZoomLevel(viewPose.fov));
    requestAnimationFrame(() => { applyingPoseRef.current = false; });
  }, [viewPose.yaw, viewPose.pitch, viewPose.fov, ready]);

  useEffect(() => {
    if (!viewerRef.current) return;
    const unlocked = workflow === 'viewing';
    viewerRef.current.setOption('mousemove', unlocked);
    viewerRef.current.setOption('mousewheel', unlocked);
  }, [workflow]);

  useEffect(() => {
    if (!viewerRef.current || !compositePreview || workflow !== 'viewing') return;
    viewerRef.current.setPanorama(compositePreview, { transition: false, showLoader: false });
  }, [compositePreview, workflow]);

  const editHere = useCallback(() => enterRectSelect('360'), [enterRectSelect]);

  return (
    <div className="viewer-container">
      <div
        ref={containerRef}
        className="viewer-viewport"
        style={{ transform: `rotate(${viewPose.roll}deg)` }}
      />
      {ready && workflow === 'viewing' && (
        <button className="edit-here-btn" onClick={editHere}>🔒 Edit Here</button>
      )}
      {workflow === 'rect-select' && (
        <>
          <div className="lock-badge">
            🔒 Locked · yaw {viewPose.yaw.toFixed(1)}° · pitch {viewPose.pitch.toFixed(1)}° · fov {viewPose.fov.toFixed(0)}°
          </div>
          <RectSelectionOverlay sourceView="360" />
        </>
      )}
    </div>
  );
}
