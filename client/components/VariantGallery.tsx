import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import ResultMaskEditor from './ResultMaskEditor';

export default function VariantGallery() {
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const layers = useProjectStore((s) => s.layers);
  const activeLayerId = useProjectStore((s) => s.activeLayerId);
  const pendingFitVariant = useProjectStore((s) => s.pendingFitVariant);
  const setPendingFitVariant = useProjectStore((s) => s.setPendingFitVariant);

  // Import lệch tỉ lệ → tự mở trình căn chỉnh (transform) cho variant đó
  useEffect(() => {
    if (!pendingFitVariant || pendingFitVariant.layerId !== activeLayerId) return;
    setEditingVariantId(pendingFitVariant.variantId);
    setPendingFitVariant(null);
  }, [pendingFitVariant, activeLayerId, setPendingFitVariant]);
  const imagePath = useProjectStore((s) => s.imagePath);
  const selectVariantForEditing = useProjectStore((s) => s.selectVariantForEditing);
  const selectOriginalVariant = useProjectStore((s) => s.selectOriginalVariant);
  const removeVariantFromLayer = useProjectStore((s) => s.removeVariantFromLayer);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const variants = activeLayer?.variants ?? [];
  const appliedVariant = variants.find((variant) => variant.applied);
  const originalUrl = activeLayer?.resultImageId
    ? api.image.cacheUrl(activeLayer.resultImageId)
    : imagePath && activeLayer
      ? api.image.tileUrl(
        imagePath,
        activeLayer.tileCoords.x,
        activeLayer.tileCoords.y,
        activeLayer.tileCoords.w,
        activeLayer.tileCoords.h,
      )
      : '';

  const handleSelect = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      selectVariantForEditing(activeLayerId, variantId);
    },
    [activeLayerId, selectVariantForEditing],
  );

  const handleDelete = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      if (!confirm('Xóa kết quả này?')) return;
      removeVariantFromLayer(activeLayerId, variantId);
    },
    [activeLayerId, removeVariantFromLayer],
  );

  if (!activeLayer || !activeLayerId || !originalUrl) return null;
  const editingVariant = variants.find((variant) => variant.id === editingVariantId);

  return (
    <div className="variant-gallery">
      <div className="variant-gallery-title">
        Results ({variants.length + 1})
      </div>
      <div className="variant-gallery-list">
        <div className={`variant-card original ${!appliedVariant ? 'applied' : ''}`}>
          <div className="variant-thumb-wrapper" onClick={() => selectOriginalVariant(activeLayerId)}>
            {!appliedVariant && <span className="variant-badge">✓ ĐANG XEM</span>}
            <img className="variant-thumb" src={originalUrl} alt="Original" />
          </div>
          <div className="variant-meta">
            <span className="variant-source">Original</span>
            <span className="variant-size">
              {activeLayer.tileCoords.w}×{activeLayer.tileCoords.h}
            </span>
          </div>
        </div>
        {variants.map((variant) => {
          const isApplied = variant.applied;
          const cacheUrl = api.image.cacheUrl(variant.resultImageId);
          return (
            <div
              key={variant.id}
              className={`variant-card ${isApplied ? 'applied' : ''}`}
            >
              <div className="variant-thumb-wrapper" onClick={() => handleSelect(variant.id)}>
                {isApplied && <span className="variant-badge">✓ ĐÃ CHỌN</span>}
                <img
                  className="variant-thumb"
                  src={cacheUrl}
                  alt={variant.source}
                />
              </div>
              <div className="variant-meta">
                <span className="variant-source">
                  {variant.source === 'ai-generated'
                    ? `AI: ${variant.modelId ?? 'unknown'}`
                    : 'Imported'}
                </span>
                <span className="variant-size">
                  {variant.width}×{variant.height}
                </span>
                {variant.needsFit && <span className="variant-needs-fit">⚠ Cần căn chỉnh</span>}
                {variant.visibilityMask?.base64Mask && <span className="variant-edited">Đã tinh chỉnh</span>}
              </div>
              <div className="variant-actions">
                <button
                  className="variant-action-btn"
                  onClick={() => setEditingVariantId(variant.id)}
                  title="Xóa hoặc phục hồi vùng Result"
                >
                  ✎ Edit
                </button>
                <button
                  className="variant-action-btn variant-delete"
                  onClick={() => handleDelete(variant.id)}
                  title="Delete result"
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {editingVariant && (
        <ResultMaskEditor
          layerId={activeLayerId}
          variant={editingVariant}
          onClose={() => setEditingVariantId(null)}
        />
      )}
    </div>
  );
}
