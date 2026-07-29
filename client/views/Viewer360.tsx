import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';

export default function Viewer360() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const imagePath = useProjectStore((s) => s.imagePath);
  const isEditing = useProjectStore((s) => s.isEditing);
  const viewLock = useProjectStore((s) => s.viewLock);
  const setViewLock = useProjectStore((s) => s.setViewLock);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const setIsEditing = useProjectStore((s) => s.setIsEditing);
  const [viewerReady, setViewerReady] = useState(false);

  // Init PSV with equirectangular image (NOT square tile)
  useEffect(() => {
    if (!containerRef.current || !imagePath) return;

    import('@photo-sphere-viewer/core').then(({ Viewer }) => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
      }

      // Serve ảnh equirectangular giữ tỉ lệ 2:1
      const panoramaUrl = api.image.serveUrl(imagePath, 4096);

      const viewer = new Viewer({
        container: containerRef.current!,
        panorama: panoramaUrl,
        navbar: false,
        defaultZoomLvl: 0,
        minFov: 10,
        maxFov: 120,
      });

      viewer.addEventListener('ready', () => {
        setViewerReady(true);
      });

      viewerRef.current = viewer;
    });

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
        setViewerReady(false);
      }
    };
  }, [imagePath]);

  // Lock rotation when editing
  useEffect(() => {
    if (!viewerRef.current) return;
    const v = viewerRef.current;
    if (isEditing) {
      v.setOption('mousewheel', false);
      v.setOption('mousemove', false);
    } else {
      v.setOption('mousewheel', true);
      v.setOption('mousemove', true);
    }
  }, [isEditing]);

  // "Edit Here" — lock current view position
  const handleEditHere = useCallback(() => {
    if (!viewerRef.current) return;
    const v = viewerRef.current;
    const pos = v.getPosition();
    setViewLock({
      yaw: pos.yaw,
      pitch: pos.pitch,
      roll: pos.roll ?? 0,
      fov: v.getZoomLevel(),
    });
    setIsEditing(true);
    setViewMode('viewer'); // bắt đầu ở viewer mode, sau Rect Select sẽ chuyển sang canvas
  }, [setViewLock, setIsEditing, setViewMode]);

  return (
    <div className="viewer-container">
      {!imagePath ? (
        <div className="placeholder">
          <p>Mở ảnh panorama để bắt đầu</p>
        </div>
      ) : (
        <>
          <div ref={containerRef} className="viewer-square" />
          {/* Nút "Edit Here" — chỉ hiện khi chưa lock */}
          {viewerReady && !isEditing && (
            <button className="edit-here-btn" onClick={handleEditHere}>
              🔒 Edit Here
            </button>
          )}
          {/* Lock badge — hiển thị giá trị góc thực */}
          {isEditing && viewLock && (
            <div className="lock-badge">
              🔒 Locked — yaw:{viewLock.yaw.toFixed(1)}° pitch:{viewLock.pitch.toFixed(1)}° fov:{viewLock.fov.toFixed(0)}°
            </div>
          )}
        </>
      )}
    </div>
  );
}
