import { useCallback, useEffect, useRef, useState } from 'react';
import { SphereGeometry, Mesh, MeshBasicMaterial, TextureLoader } from 'three';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';
import { degreesToRadians, radiansToDegrees } from '../components/view-controls';
import RectSelectionOverlay from '../components/RectSelectionOverlay';

const SPHERE_RADIUS = 10;

function disposeMesh(mesh: Mesh) {
  mesh.geometry?.dispose();
  (mesh.material as MeshBasicMaterial)?.map?.dispose();
  (mesh.material as MeshBasicMaterial)?.dispose();
}

export default function Viewer360() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const applyingPoseRef = useRef(false);
  const overlayMeshesRef = useRef<Map<string, Mesh>>(new Map());
  const [ready, setReady] = useState(false);
  const imagePath = useProjectStore((state) => state.imagePath);
  const workflow = useProjectStore((state) => state.workflow);
  const viewPose = useProjectStore((state) => state.viewPose);
  const layers = useProjectStore((state) => state.layers);
  const updateViewPose = useProjectStore((state) => state.updateViewPose);
  const enterRectSelect = useProjectStore((state) => state.enterRectSelect);

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

  // Sync overlay spheres with perspective layers
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;

    // Base sphere that holds the panorama — overlay must be child to inherit rotation
    const parent: Mesh | undefined = viewer.renderer.mesh;
    if (!parent) return;

    const currentIds = new Set(layers.map(l => l.id));

    // Remove meshes for deleted layers
    for (const [id, mesh] of overlayMeshesRef.current) {
      if (!currentIds.has(id)) {
        parent.remove(mesh);
        disposeMesh(mesh);
        overlayMeshesRef.current.delete(id);
        viewer.needsUpdate();
      }
    }

    // Add/update meshes for current perspective layers
    for (const layer of layers) {
      // Prefer the applied variant's equirectImageId — the layer-level field
      // may be stale when the selected variant hasn't been reprojected yet.
      const appliedVariant = (layer.variants ?? []).find(v => v.applied);
      const equirectId = appliedVariant?.equirectImageId ?? layer.equirectImageId;
      if (layer.type !== 'perspective' || !equirectId) continue;

      const textureUrl = api.image.cacheUrl(equirectId);
      let mesh = overlayMeshesRef.current.get(layer.id);

      // Recreate mesh when texture URL changes (e.g. mask toggle triggers re-reproject)
      const stale = !mesh || mesh.userData.textureUrl !== textureUrl;
      if (stale) {
        if (mesh) {
          parent.remove(mesh);
          disposeMesh(mesh);
        }
        // Match PSV's non-shader phiStart = -Math.PI/2 to align UV-to-spatial mapping
        const geometry = new SphereGeometry(SPHERE_RADIUS, 64, 32, -Math.PI / 2)
          .scale(-1, 1, 1);
        const texture = new TextureLoader().load(
          textureUrl,
          () => viewer.needsUpdate(),
        );
        const material = new MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
        mesh = new Mesh(geometry, material);
        mesh.userData.textureUrl = textureUrl;
        parent.add(mesh);
        overlayMeshesRef.current.set(layer.id, mesh);
        viewer.needsUpdate();
      }

      // mesh is guaranteed to exist here: stale=true creates it, stale=false means we had it
      const resolved = overlayMeshesRef.current.get(layer.id);
      if (!resolved) continue;

      const prevVisible = resolved.visible;
      resolved.visible = layer.visible !== false;
      if (resolved.visible !== prevVisible) {
        viewer.needsUpdate();
      }
    }
  }, [layers, ready]);

  // Cleanup overlay meshes on unmount or panorama change
  useEffect(() => {
    return () => {
      for (const mesh of overlayMeshesRef.current.values()) {
        mesh.removeFromParent();
        disposeMesh(mesh);
      }
      overlayMeshesRef.current.clear();
    };
  }, [imagePath]);

  const editHere = useCallback(() => enterRectSelect('360'), [enterRectSelect]);

  return (
    <div className="viewer-container">
      <div
        ref={containerRef}
        className="viewer-viewport"
        style={{ transform: `rotate(${viewPose.roll}deg)` }}
      >
        {workflow === 'rect-select' && (
          <>
            <div className="lock-badge">
              🔒 Đã khóa · yaw {viewPose.yaw.toFixed(1)}° · pitch {viewPose.pitch.toFixed(1)}° · fov {viewPose.fov.toFixed(0)}°
            </div>
            <RectSelectionOverlay sourceView="360" />
          </>
        )}
      </div>
      {ready && workflow === 'viewing' && (
        <button className="edit-here-btn" onClick={editHere}>🔒 Chỉnh sửa tại đây</button>
      )}
    </div>
  );
}
