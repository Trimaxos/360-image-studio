import React from 'react';
import { useProjectStore } from '../stores/project';

export default function VariantGallery() {
  const variants = useProjectStore((state) => state.generatedVariants);
  const selected = useProjectStore((state) => state.selectedVariantId);
  const select = useProjectStore((state) => state.selectVariant);
  if (!variants.length) return null;
  return (
    <div className="variant-gallery">
      {variants.map((variant, index) => (
        <button
          key={variant.id}
          className={selected === variant.id ? 'selected' : ''}
          onClick={() => select(variant.id)}
          title={`Version ${index + 1} · ${variant.modelId}`}
        >
          <img src={`data:image/png;base64,${variant.base64Result}`} alt={`Version ${index + 1}`} />
          <span>{variant.modelId === 'external/manual' ? 'External' : `V${index + 1}`}</span>
        </button>
      ))}
    </div>
  );
}
