import React, { useCallback } from 'react';
import { useProjectStore } from '../stores/project';
import { api } from '../lib/api';
import type { LayerVariant } from '../../shared/types';

interface Props {
  onEditMask?: (variant: LayerVariant) => void;
}

export default function VariantGallery({ onEditMask }: Props) {
  const layers = useProjectStore((s) => s.layers);
  const activeLayerId = useProjectStore((s) => s.activeLayerId);
  const toggleVariant = useProjectStore((s) => s.toggleVariant);
  const removeVariantFromLayer = useProjectStore((s) => s.removeVariantFromLayer);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const variants = activeLayer?.variants ?? [];

  const handleToggle = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      toggleVariant(activeLayerId, variantId);
    },
    [activeLayerId, toggleVariant],
  );

  const handleDelete = useCallback(
    (variantId: string) => {
      if (!activeLayerId) return;
      if (!confirm('Xóa kết quả này?')) return;
      removeVariantFromLayer(activeLayerId, variantId);
    },
    [activeLayerId, removeVariantFromLayer],
  );

  if (!variants.length) return null;

  return (
    <div className="variant-gallery">
      <div className="variant-gallery-title">
        Results ({variants.length})
      </div>
      <div className="variant-gallery-list">
        {variants.map((variant) => {
          const isApplied = variant.applied;
          const cacheUrl = api.image.cacheUrl(variant.resultImageId);
          return (
            <div
              key={variant.id}
              className={`variant-card ${isApplied ? 'applied' : ''}`}
            >
              <div className="variant-thumb-wrapper" onClick={() => handleToggle(variant.id)}>
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
              </div>
              <div className="variant-actions">
                {isApplied && onEditMask && activeLayer?.type !== 'perspective' && (
                  <button
                    className="variant-action-btn"
                    onClick={() => onEditMask(variant)}
                    title="Edit visibility mask"
                  >
                    🖌 Edit Mask
                  </button>
                )}
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
    </div>
  );
}
