import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  blobToPngBase64,
  copyPngBlob,
  downloadBlob,
} from '../lib/canvas-exchange';
import { fabricToMaskData } from '../lib/mask-utils';
import { useProjectStore } from '../stores/project';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import VariantGallery from './VariantGallery';

export default function CanvasEditor() {
  const state = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const resultInputRef = useRef<HTMLInputElement>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sourceError, setSourceError] = useState('');
  const [exchangeMessage, setExchangeMessage] = useState('');
  const selectedVariant = useMemo(
    () => state.generatedVariants.find((item) => item.id === state.selectedVariantId),
    [state.generatedVariants, state.selectedVariantId],
  );
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const tile = activeLayer?.tileCoords ?? state.selectionDraft?.tileCoords;
  const sourceUrl = useMemo(() => {
    // Perspective layers: load from server cache via resultImageId
    if (activeLayer?.type === 'perspective' && activeLayer?.resultImageId) {
      return api.image.cacheUrl(activeLayer.resultImageId);
    }
    // Flat view: load tile from original image
    if (!state.imagePath || !tile) return '';
    return state.selectionDraft?.sourceView === 'flat'
      ? api.image.tileUrl(state.imagePath, tile.x, tile.y, tile.w, tile.h)
      : api.image.serveUrl(state.imagePath, 4096);
  }, [
    activeLayer?.resultImageId,
    activeLayer?.type,
    state.imagePath,
    state.selectionDraft?.sourceView,
    tile?.x,
    tile?.y,
    tile?.w,
    tile?.h,
  ]);

  useEffect(() => {
    if (!canvasRef.current || !state.imagePath || !tile) return;
    let disposed = false;
    setSourceStatus('loading');
    setSourceError('');
    import('fabric').then(async ({ Canvas, FabricImage, Path, PencilBrush, Polygon, Polyline }) => {
      try {
        if (disposed || !canvasRef.current) return;
        const parent = canvasRef.current.parentElement!;
        const canvas = new Canvas(canvasRef.current, {
          width: parent.clientWidth,
          height: parent.clientHeight,
          backgroundColor: '#080808',
          selection: false,
        });
        const image = await FabricImage.fromURL(sourceUrl);
        if (!image.width || !image.height) {
          throw new Error('Ảnh vùng chọn không có kích thước hợp lệ.');
        }
      const scale = Math.min(canvas.width! / image.width!, canvas.height! / image.height!);
      image.set({
        left: (canvas.width! - image.width! * scale) / 2,
        top: (canvas.height! - image.height! * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
      });
      canvas.add(image);
      canvas.requestRenderAll();
      setSourceStatus('ready');

      // Restore saved mask shapes from layer data
      const savedShapes = activeLayer?.maskData ?? [];
      if (savedShapes.length > 0) {
        const fromNative = (p: { x: number; y: number }) => ({
          x: p.x * scale + image.left!,
          y: p.y * scale + image.top!,
        });
        for (const shape of savedShapes) {
          if (shape.enabled === false) continue;
          if (shape.type === 'brush' && shape.points && shape.points.length > 0) {
            const canvasPoints = shape.points.map(fromNative);
            if (canvasPoints.length >= 2) {
              const d = canvasPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const pathObj = new Path(d, {
                stroke: 'rgba(233,69,96,.55)',
                strokeWidth: 24,
                fill: 'transparent',
                selectable: false,
                evented: false,
              }) as any;
              pathObj._shapeId = shape.id; // stable ID for merge
              if (shape.action === 'subtract') pathObj._maskAction = 'subtract';
              canvas.add(pathObj);
            }
          } else if (shape.type === 'lasso' && shape.points && shape.points.length >= 3) {
            const canvasPoints = shape.points.map(fromNative);
            const polygon = new Polygon(canvasPoints, {
              fill: 'rgba(233,69,96,.38)',
              stroke: '#e94560',
              strokeWidth: 2,
              selectable: false,
              evented: false,
            }) as any;
            polygon._shapeId = shape.id; // stable ID for merge
            if (shape.action === 'subtract') polygon._maskAction = 'subtract';
            canvas.add(polygon);
          }
        }
        canvas.requestRenderAll();
      }

      canvas.freeDrawingBrush = new PencilBrush(canvas);
      canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
      canvas.freeDrawingBrush.width = 24;
      canvas.isDrawingMode = true;
      const exportMask = () => {
        image.set({ visible: false });
        const previousBackground = canvas.backgroundColor;
        const maskObjects = canvas.getObjects().filter((object: any) => object !== image);
        const appearances = maskObjects.map((object: any) => ({
          object,
          fill: object.fill,
          stroke: object.stroke,
          opacity: object.opacity,
        }));
        for (const appearance of appearances) {
          appearance.object.set({ fill: '#ffffff', stroke: '#ffffff', opacity: 1 });
        }
        canvas.backgroundColor = '#000000';
        canvas.requestRenderAll();
        const displayedWidth = image.width! * image.scaleX!;
        const displayedHeight = image.height! * image.scaleY!;
        const result = canvas.toDataURL({
          format: 'png',
          left: image.left!,
          top: image.top!,
          width: displayedWidth,
          height: displayedHeight,
          multiplier: image.width! / displayedWidth,
        }).split(',')[1];
        image.set({ visible: true });
        for (const appearance of appearances) {
          appearance.object.set({
            fill: appearance.fill,
            stroke: appearance.stroke,
            opacity: appearance.opacity,
          });
        }
        canvas.backgroundColor = previousBackground;
        canvas.requestRenderAll();
        return result;
      };
      // Extract mask shapes in native tile coordinates for the mask management panel
      const exportMaskShapes = () => {
        const scale = image.scaleX!;
        const toNative = (p: { x: number; y: number }) => ({
          x: (p.x - image.left!) / scale,
          y: (p.y - image.top!) / scale,
        });
        return fabricToMaskData(canvas, toNative);
      };
      canvas.on('path:created', () => {
        const current = useProjectStore.getState();
        if (current.selectionDraft) {
          current.setSelectionDraft({
            ...current.selectionDraft,
            maskBase64: exportMask(),
          });
        }
        current.markDirty();
        useProjectStore.setState({ maskDirty: true });
      });
      let lassoPoints: Array<{ x: number; y: number }> = [];
      let lassoPreview: any = null;
      canvas.on('mouse:down', (event: any) => {
        if (useProjectStore.getState().activeTool !== 'lasso') return;
        const pointer = canvas.getScenePoint(event.e);
        lassoPoints = [{ x: pointer.x, y: pointer.y }];
        lassoPreview = new Polyline(lassoPoints, {
          fill: 'transparent',
          stroke: '#e94560',
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
        canvas.add(lassoPreview);
      });
      canvas.on('mouse:move', (event: any) => {
        if (!lassoPreview || useProjectStore.getState().activeTool !== 'lasso') return;
        const pointer = canvas.getScenePoint(event.e);
        lassoPoints.push({ x: pointer.x, y: pointer.y });
        lassoPreview.set({ points: [...lassoPoints] });
        canvas.requestRenderAll();
      });
      canvas.on('mouse:up', () => {
        if (!lassoPreview) return;
        canvas.remove(lassoPreview);
        lassoPreview = null;
        if (lassoPoints.length >= 3) {
          canvas.add(new Polygon(lassoPoints, {
            fill: 'rgba(233,69,96,.38)',
            stroke: '#e94560',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          }));
          const current = useProjectStore.getState();
          if (current.selectionDraft) {
            current.setSelectionDraft({ ...current.selectionDraft, maskBase64: exportMask() });
          }
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
        }
        lassoPoints = [];
      });
      const undo = () => {
        const masks = canvas.getObjects().filter((object: any) =>
          object.type === 'path' || object.type === 'polygon');
        const last = masks.at(-1);
        if (last) {
          canvas.remove(last);
          const current = useProjectStore.getState();
          if (current.selectionDraft) {
            current.setSelectionDraft({ ...current.selectionDraft, maskBase64: exportMask() });
          }
          current.markDirty();
          useProjectStore.setState({ maskDirty: true });
        }
      };
      window.addEventListener('canvas-undo', undo);
      fabricRef.current = canvas;
      state.setGetMaskBase64(exportMask);
      state.setGetMaskShapes(exportMaskShapes);
      const observer = new ResizeObserver(() => {
        canvas.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
        canvas.requestRenderAll();
      });
      observer.observe(parent);
      (canvas as any).__observer = observer;
      (canvas as any).__undo = undo;
      } catch (reason) {
        if (!disposed) {
          setSourceStatus('error');
          setSourceError(reason instanceof Error ? reason.message : 'Không tải được ảnh vùng chọn.');
        }
      }
    });
    return () => {
      disposed = true;
      if (fabricRef.current) {
        (fabricRef.current as any).__observer?.disconnect();
        window.removeEventListener('canvas-undo', (fabricRef.current as any).__undo);
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      useProjectStore.getState().setGetMaskBase64(null);
      useProjectStore.getState().setGetMaskShapes(null);
    };
  }, [
    state.imagePath,
    sourceUrl,
    state.selectionDraft?.sourceView,
    tile?.x,
    tile?.y,
    tile?.w,
    tile?.h,
  ]);

  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = state.activeTool === 'brush' || state.activeTool === 'eraser';
    if (canvas.freeDrawingBrush) {
      if (state.activeTool === 'eraser') {
        canvas.freeDrawingBrush.color = 'rgba(255,100,100,0.7)';
        canvas.freeDrawingBrush.width = 40;
      } else if (state.activeTool === 'lasso') {
        canvas.freeDrawingBrush.width = 3;
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
      } else {
        canvas.freeDrawingBrush.color = 'rgba(233,69,96,.55)';
        canvas.freeDrawingBrush.width = 24;
      }
    }
    // Tag eraser paths so fabricToMaskData can set action:'subtract'
    const isEraser = state.activeTool === 'eraser';
    const onPathCreated = (e: any) => {
      if (isEraser && e.path) {
        e.path._maskAction = 'subtract';
      }
    };
    canvas.on('path:created', onPathCreated);
    return () => {
      canvas.off('path:created', onPathCreated);
    };
  }, [state.activeTool]);

  const back = () => {
    if (state.dirty) setBackOpen(true);
    else state.leaveCanvas('discard');
  };

  const getSourceBlob = async () => {
    if (!sourceUrl) throw new Error('Chưa có ảnh canvas để xuất.');
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error('Không đọc được ảnh canvas.');
    return response.blob();
  };

  const downloadCanvas = async () => {
    setExchangeMessage('');
    try {
      downloadBlob(await getSourceBlob(), 'canvas-source.png');
      setExchangeMessage('Đã tải canvas.');
    } catch (reason) {
      setExchangeMessage(reason instanceof Error ? reason.message : 'Không thể tải canvas.');
    }
  };

  const copyCanvas = async () => {
    setExchangeMessage('');
    try {
      await copyPngBlob(await getSourceBlob());
      setExchangeMessage('Đã copy canvas vào clipboard.');
    } catch (reason) {
      setExchangeMessage(reason instanceof Error ? reason.message : 'Không thể copy canvas.');
    }
  };

  const downloadMask = () => {
    setExchangeMessage('');
    const base64Mask = state.getMaskBase64?.() ?? state.selectionDraft?.maskBase64;
    if (!base64Mask) {
      setExchangeMessage('Chưa có mask để tải.');
      return;
    }
    fetch(`data:image/png;base64,${base64Mask}`)
      .then((response) => response.blob())
      .then((blob) => {
        downloadBlob(blob, 'canvas-mask.png');
        setExchangeMessage('Đã tải mask.');
      })
      .catch(() => setExchangeMessage('Không thể tải mask.'));
  };

  const importResult = async (file?: File) => {
    if (!file || !activeLayer) return;
    setExchangeMessage('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('File kết quả phải là ảnh.');

      // Read imported image dimensions
      const bitmap = await createImageBitmap(file);
      const importedW = bitmap.width;
      const importedH = bitmap.height;
      bitmap.close();

      // Expected canvas dimensions (perspective output size from active layer)
      const expectedW = activeLayer.tileCoords.w;
      const expectedH = activeLayer.tileCoords.h;
      const expectedRatio = expectedW / expectedH;
      const importedRatio = importedW / importedH;

      // Ratio tolerance: ±1%
      const ratioDelta = Math.abs(expectedRatio - importedRatio) / expectedRatio;
      if (ratioDelta > 0.01) {
        throw new Error(
          `Tỉ lệ ảnh không khớp. Ảnh nhập: ${importedW}×${importedH} (tỉ lệ ${importedRatio.toFixed(3)}). ` +
          `Yêu cầu: ${expectedW}×${expectedH} (tỉ lệ ${expectedRatio.toFixed(3)}). ` +
          `Vui lòng tạo lại ảnh đúng tỉ lệ.`,
        );
      }

      // Resize to exact canvas dimensions (upscale or downscale as needed)
      const base64Result = await blobToPngBase64(file, { width: expectedW, height: expectedH });
      state.addGeneratedVariant({
        id: crypto.randomUUID(),
        base64Result,
        modelId: 'external/manual',
      });

      if (importedW === expectedW && importedH === expectedH) {
        setExchangeMessage(`Đã nạp kết quả (${expectedW} × ${expectedH}px).`);
      } else {
        const action = importedW > expectedW ? 'downscale' : 'upscale';
        setExchangeMessage(`Đã nạp kết quả và ${action} về ${expectedW} × ${expectedH}px.`);
      }
    } catch (reason) {
      setExchangeMessage(reason instanceof Error ? reason.message : 'Không thể nạp ảnh kết quả.');
    }
  };

  return (
    <div className="canvas-editor">
      <input
        ref={resultInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event) => {
          void importResult(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <div className="canvas-toolbar">
        <button onClick={back}>← Back to View</button>
        <span>{activeLayer ? `${activeLayer.tileCoords.w} × ${activeLayer.tileCoords.h}px` : 'Edit Canvas'}</span>
        <div className="canvas-toolbar-actions">
          <button disabled={sourceStatus !== 'ready'} onClick={() => void downloadCanvas()}>Download Image</button>
          <button disabled={sourceStatus !== 'ready'} onClick={() => void copyCanvas()}>Copy Image</button>
          <button disabled={sourceStatus !== 'ready'} onClick={downloadMask}>Download Mask</button>
          <button disabled={sourceStatus !== 'ready'} onClick={() => resultInputRef.current?.click()}>Import Result</button>
        </div>
      </div>
      <div className="canvas-stage">
        <canvas ref={canvasRef} />
        {sourceStatus === 'loading' && <div className="canvas-source-message">Đang tải vùng chỉnh sửa…</div>}
        {sourceStatus === 'error' && <div className="canvas-source-message error">{sourceError}</div>}
        {selectedVariant && (
          <img className="selected-variant-preview" src={`data:image/png;base64,${selectedVariant.base64Result}`} alt="Selected result" />
        )}
      </div>
      {exchangeMessage && <div className="canvas-exchange-message">{exchangeMessage}</div>}
      <VariantGallery />
      {backOpen && (
        <UnsavedChangesDialog
          onSave={() => state.leaveCanvas('save')}
          onDiscard={() => state.leaveCanvas('discard')}
          onCancel={() => setBackOpen(false)}
        />
      )}
    </div>
  );
}
