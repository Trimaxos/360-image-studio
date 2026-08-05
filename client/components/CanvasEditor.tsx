import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  blobToPngBase64,
  copyPngBlob,
  downloadBlob,
} from '../lib/canvas-exchange';
import { useProjectStore } from '../stores/project';
import { applyVariantToPanorama } from '../lib/apply-variant';
import { composeVariantPreview } from '../lib/visibility-mask';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import VariantGallery from './VariantGallery';
import type { LayerVariant } from '../../shared/types';

export default function CanvasEditor() {
  const state = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const resultInputRef = useRef<HTMLInputElement>(null);
  const [backOpen, setBackOpen] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sourceError, setSourceError] = useState('');
  const [exchangeMessage, setExchangeMessage] = useState('');
  const [returningToView, setReturningToView] = useState(false);
  const selectedVariant = useMemo(
    () => state.generatedVariants.find((item) => item.id === state.selectedVariantId),
    [state.generatedVariants, state.selectedVariantId],
  );
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const appliedVariant = activeLayer?.variants?.find((v) => v.applied);
  const tile = activeLayer?.tileCoords ?? state.selectionDraft?.tileCoords;
  const originalSourceUrl = useMemo(() => {
    if (activeLayer?.type === 'perspective' && activeLayer.resultImageId) {
      return api.image.cacheUrl(activeLayer.resultImageId);
    }
    if (!state.imagePath || !tile) return '';
    return state.selectionDraft?.sourceView === 'flat'
      ? api.image.tileUrl(state.imagePath, tile.x, tile.y, tile.w, tile.h)
      : api.image.serveUrl(state.imagePath, 4096);
  }, [activeLayer?.resultImageId, activeLayer?.type, state.imagePath, state.selectionDraft?.sourceView, tile?.x, tile?.y, tile?.w, tile?.h]);
  const sourceUrl = useMemo(() => {
    // Applied variant takes priority — its cache file is the source of truth
    if (appliedVariant?.resultImageId) {
      return api.image.cacheUrl(appliedVariant.resultImageId);
    }
    // Perspective layers: load from server cache via resultImageId
    return originalSourceUrl;
  }, [
    appliedVariant?.resultImageId,
    originalSourceUrl,
  ]);

  useEffect(() => {
    if (!canvasRef.current || !state.imagePath || !tile) return;
    let disposed = false;
    setSourceStatus('loading');
    setSourceError('');
    import('fabric').then(async ({ Canvas, FabricImage }) => {
      try {
        if (disposed || !canvasRef.current) return;
        const parent = canvasRef.current.parentElement!;
        const canvas = new Canvas(canvasRef.current, {
          width: parent.clientWidth,
          height: parent.clientHeight,
          backgroundColor: '#080808',
          selection: false,
        });
        const displayUrl = appliedVariant?.visibilityMask?.base64Mask && originalSourceUrl
          ? await composeVariantPreview(originalSourceUrl, sourceUrl, appliedVariant.visibilityMask.base64Mask)
          : sourceUrl;
        const image = await FabricImage.fromURL(displayUrl);
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

      canvas.isDrawingMode = false;
      fabricRef.current = canvas;
      const observer = new ResizeObserver(() => {
        canvas.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
        canvas.requestRenderAll();
      });
      observer.observe(parent);
      (canvas as any).__observer = observer;
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
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [
    state.imagePath,
    sourceUrl,
    originalSourceUrl,
    appliedVariant?.visibilityMask?.base64Mask,
    state.selectionDraft?.sourceView,
    tile?.x,
    tile?.y,
    tile?.w,
    tile?.h,
  ]);

  const leaveForView = async (choice: 'save' | 'discard') => {
    const current = useProjectStore.getState();
    const layer = current.layers.find((item) => item.id === current.activeLayerId);
    const selected = layer?.variants?.find((variant) => variant.applied);
    setReturningToView(true);
    setExchangeMessage(selected ? 'Đang áp kết quả vào panorama…' : '');
    try {
      if (layer && selected) await applyVariantToPanorama(layer.id, selected.id);
      useProjectStore.getState().leaveCanvas(choice);
      setBackOpen(false);
    } catch (error) {
      setExchangeMessage(error instanceof Error ? error.message : 'Không thể áp kết quả vào panorama.');
    } finally {
      setReturningToView(false);
    }
  };

  const back = () => {
    if (returningToView) return;
    if (state.dirty) setBackOpen(true);
    else void leaveForView('discard');
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

  const importResult = async (file?: File) => {
    if (!file || !activeLayer) return;
    setExchangeMessage('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('File kết quả phải là ảnh.');

      const bitmap = await createImageBitmap(file);
      const importedW = bitmap.width;
      const importedH = bitmap.height;
      bitmap.close();

      const expectedW = activeLayer.tileCoords.w;
      const expectedH = activeLayer.tileCoords.h;
      const expectedRatio = expectedW / expectedH;
      const importedRatio = importedW / importedH;
      const ratioDelta = Math.abs(expectedRatio - importedRatio) / expectedRatio;
      if (ratioDelta > 0.01) {
        throw new Error(
          `Tỉ lệ ảnh không khớp. Ảnh nhập: ${importedW}×${importedH} (tỉ lệ ${importedRatio.toFixed(3)}). ` +
          `Yêu cầu: ${expectedW}×${expectedH} (tỉ lệ ${expectedRatio.toFixed(3)}).`,
        );
      }

      const base64Result = await blobToPngBase64(file, { width: expectedW, height: expectedH });

      // Persist to server cache FIRST — resultImageId must point to a real file
      const { resultImageId } = await api.image.saveResultCache(base64Result);

      const variant: LayerVariant = {
        id: crypto.randomUUID(),
        resultImageId,
        source: 'imported',
        applied: false,
        width: expectedW,
        height: expectedH,
        createdAt: Date.now(),
      };

      // Add variant to layer and select it (deselects others automatically)
      state.addVariantToLayer(activeLayer.id, variant);
      state.selectVariantForEditing(activeLayer.id, variant.id);

      const action = importedW > expectedW ? 'downscale' : 'upscale';
      setExchangeMessage(`Đã nạp kết quả và ${action} về ${expectedW} × ${expectedH}px.`);
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
        <button disabled={returningToView} onClick={back}>
          {returningToView ? 'Applying…' : '← Back to View'}
        </button>
        <span>{activeLayer ? `${activeLayer.tileCoords.w} × ${activeLayer.tileCoords.h}px` : 'Edit Canvas'}</span>
        <div className="canvas-toolbar-actions">
          <button disabled={sourceStatus !== 'ready'} onClick={() => void downloadCanvas()}>Download Image</button>
          <button disabled={sourceStatus !== 'ready'} onClick={() => void copyCanvas()}>Copy Image</button>
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
          onSave={() => { void leaveForView('save'); }}
          onDiscard={() => state.leaveCanvas('discard')}
          onCancel={() => setBackOpen(false)}
        />
      )}
    </div>
  );
}
