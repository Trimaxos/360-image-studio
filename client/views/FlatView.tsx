import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import type { RectSelect } from '../stores/project';

export default function FlatView() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const imagePath = useProjectStore((s) => s.imagePath);
  const imageWidth = useProjectStore((s) => s.imageWidth);
  const imageHeight = useProjectStore((s) => s.imageHeight);
  const activeTool = useProjectStore((s) => s.activeTool);
  const rectSelect = useProjectStore((s) => s.rectSelect);
  const setRectSelect = useProjectStore((s) => s.setRectSelect);
  const setIsEditing = useProjectStore((s) => s.setIsEditing);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);

  // Canvas setup — load full equirectangular image via serve endpoint
  useEffect(() => {
    if (!canvasElRef.current || !imagePath) return;

    import('fabric').then(({ Canvas, Image }) => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
      }

      const displayW = Math.min(2048, imageWidth || 8192);
      const displayH = Math.round(displayW / 2); // giữ tỉ lệ 2:1

      const canvas = new Canvas(canvasElRef.current!, {
        width: displayW,
        height: displayH,
        backgroundColor: '#0f0f23',
        selection: false,
      });

      // Load ảnh equirectangular đã resize (giữ tỉ lệ 2:1)
      const serveUrl = api.image.serveUrl(imagePath, displayW);
      Image.fromURL(serveUrl, { crossOrigin: 'anonymous' }).then((img: any) => {
        if (!img) return;
        img.set({ left: 0, top: 0, selectable: false, evented: false });
        canvas.add(img);
        canvas.renderAll();
      });

      // Rect Select tool — vẽ rect trên canvas
      let rectObj: any = null;
      canvas.on('mouse:down', (opt: any) => {
        if (activeTool === 'rect') {
          setIsDrawingRect(true);
          const ptr = canvas.getPointer(opt.e);
          setRectStart({ x: ptr.x / zoom - panX, y: ptr.y / zoom - panY });
          rectObj = new (fabricRef.current?.Rect || Rect)({
            left: ptr.x, top: ptr.y, width: 0, height: 0,
            fill: 'rgba(79,195,247,0.12)', stroke: '#4fc3f7', strokeWidth: 2,
            selectable: false, evented: false,
          });
          canvas.add(rectObj);
        } else if (activeTool === 'brush' || activeTool === 'lasso') {
          canvas.isDrawingMode = true;
          canvas.freeDrawingBrush.width = activeTool === 'brush' ? 25 : 3;
          canvas.freeDrawingBrush.color = 'rgba(233,69,96,.35)';
          setIsEditing(true);
        }
      });

      canvas.on('mouse:move', (opt: any) => {
        if (isDrawingRect && rectObj && rectStart) {
          const ptr = canvas.getPointer(opt.e);
          rectObj.set({
            width: Math.abs(ptr.x - (rectObj.left || 0)),
            height: Math.abs(ptr.y - (rectObj.top || 0)),
          });
          canvas.renderAll();
        }
      });

      canvas.on('mouse:up', () => {
        if (isDrawingRect && rectObj) {
          setIsDrawingRect(false);
          // Calculate native resolution
          const scaleX = (imageWidth || 8192) / (canvas.width || 2048);
          const scaleY = (imageHeight || 4096) / (canvas.height || 1024);
          setRectSelect({
            x: Math.round(rectObj.left! / zoom * scaleX),
            y: Math.round(rectObj.top! / zoom * scaleY),
            w: Math.round(rectObj.width! / zoom * scaleX),
            h: Math.round(rectObj.height! / zoom * scaleY),
            nativeW: Math.round(rectObj.width! / zoom * scaleX),
            nativeH: Math.round(rectObj.height! / zoom * scaleY),
          });
          rectObj = null;
        }
      });

      fabricRef.current = canvas;

      // Set callback for PromptBar to get mask base64
      useProjectStore.getState().setGetMaskBase64(() => {
        if (!fabricRef.current) return null;
        return fabricRef.current.toDataURL({ format: 'png', multiplier: 1 }).split(',')[1];
      });
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        useProjectStore.getState().setGetMaskBase64(null);
        fabricRef.current = null;
      }
    };
  }, [imagePath]);

  // Update drawing mode when tool changes
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    if (activeTool === 'brush' || activeTool === 'lasso') {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.width = activeTool === 'brush' ? 25 : 3;
    } else {
      canvas.isDrawingMode = false;
    }
  }, [activeTool]);

  // Zoom bằng scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.1, Math.min(5, z - e.deltaY * 0.001)));
  }, []);

  return (
    <div className="flat-view-container" onWheel={handleWheel}>
      {!imagePath ? (
        <div className="placeholder">Mở ảnh panorama để bắt đầu</div>
      ) : (
        <div style={{ transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`, transformOrigin: 'center' }}>
          <canvas ref={canvasElRef} />
          {rectSelect && (
            <div className="rect-resolution-info">
              Vùng chọn: <strong>{rectSelect.nativeW} × {rectSelect.nativeH} px</strong>
              <span className="native-note">ảnh gốc: {imageWidth} × {imageHeight}px</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
