import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { blobToBase64, createWhiteMask } from '../lib/mask-utils';
import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';
import ModelSelector from './ModelSelector';

export default function PromptBar() {
  const state = useProjectStore();
  const permission = permissionsFor(state.workflow);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const generating = state.workflow === 'generating';
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);

  useEffect(() => {
    setPrompt(state.selectionDraft?.prompt ?? '');
  }, [state.activeLayerId]);

  const generate = async () => {
    const selection = state.selectionDraft;
    const model = state.selectedModel;
    const layerId = state.activeLayerId;
    if (!selection || !state.imagePath || !model || !prompt.trim()) return;

    setError('');
    state.setWorkflow('generating');
    try {
      const translated = (await api.ai.translate(prompt.trim())).translated;
      let base64Image: string | undefined;

      // Continue from the selected result, or from the untouched original tile.
      const selectedVariant = activeLayer?.variants?.find((variant) => variant.applied);
      const sourceResultImageId = selectedVariant?.resultImageId ?? activeLayer?.resultImageId;
      if (sourceResultImageId) {
        const cacheUrl = api.image.cacheUrl(sourceResultImageId);
        const response = await fetch(cacheUrl);
        if (!response.ok) throw new Error('Không đọc được ảnh canvas từ cache.');
        base64Image = await blobToBase64(await response.blob());
      } else {
        // Fallback: load tile from original image (flat view or draft layer)
        const coords = selection.tileCoords;
        const imageResponse = await fetch(api.image.tileUrl(
          state.imagePath, coords.x, coords.y, coords.w, coords.h,
        ));
        if (!imageResponse.ok) throw new Error('Không đọc được vùng ảnh.');
        base64Image = await blobToBase64(await imageResponse.blob());
      }

      // Mask drawing has been removed: AI always edits the full selected rectangle.
      const effectiveMask = await createWhiteMask(
        selection.tileCoords.w,
        selection.tileCoords.h,
      );

      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: effectiveMask,
        prompt: translated,
      });
      state.setSelectionDraft({ ...selection, prompt });

      // Persist to server cache — MUST happen before creating variant
      const { resultImageId } = await api.image.saveResultCache(result.base64Result);

      // Add as LayerVariant to active layer (variant system)
      if (layerId) {
        const variant: import('../../shared/types').LayerVariant = {
          id: crypto.randomUUID(),
          resultImageId,
          source: 'ai-generated',
          modelId: result.model,
          applied: false,
          width: activeLayer?.tileCoords.w ?? selection.tileCoords.w,
          height: activeLayer?.tileCoords.h ?? selection.tileCoords.h,
          createdAt: Date.now(),
        };
        state.addVariantToLayer(layerId, variant);
        state.selectVariantForEditing(layerId, variant.id);
      }

      state.addGeneratedVariant({
        id: crypto.randomUUID(),
        base64Result: result.base64Result,
        modelId: result.model,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Generate thất bại');
      state.setWorkflow(state.generatedVariants.length ? 'ai-review' : 'canvas-edit');
    }
  };

  return (
    <div className="prompt-bar">
      <ModelSelector disabled={!permission.ai || generating} />
      <input
        value={prompt}
        onChange={(event) => {
          const value = event.target.value;
          setPrompt(value);
          if (state.selectionDraft) {
            state.setSelectionDraft({ ...state.selectionDraft, prompt: value });
          } else {
            state.markDirty();
          }
        }}
        placeholder="Nhập prompt..."
        disabled={!permission.ai || generating}
        onKeyDown={(event) => { if (event.key === 'Enter') void generate(); }}
      />
      <button
        className="prompt-btn prompt-btn-generate"
        disabled={!permission.ai || generating || !prompt.trim() || !state.selectedModel}
        onClick={() => void generate()}
      >
        {generating ? 'Generating…' : 'Generate'}
      </button>
      {error && <span className="prompt-error" title={error}>⚠ {error}</span>}
    </div>
  );
}
