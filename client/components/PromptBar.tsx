import React, { useEffect, useState } from 'react';
import type { Layer } from '../../shared/types';
import { api } from '../lib/api';
import { blobToBase64 } from '../lib/mask-utils';
import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';
import ModelSelector from './ModelSelector';

export default function PromptBar() {
  const state = useProjectStore();
  const permission = permissionsFor(state.workflow);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const generating = state.workflow === 'generating';
  const selectedVariant = state.generatedVariants.find((item) => item.id === state.selectedVariantId);

  useEffect(() => {
    setPrompt(state.selectionDraft?.prompt ?? '');
  }, [state.activeLayerId]);

  const generate = async () => {
    const selection = state.selectionDraft;
    const model = state.selectedModel;
    const mask = state.getMaskBase64?.();
    if (!selection || !state.imagePath || !model || !mask || !prompt.trim()) return;
    setError('');
    state.setWorkflow('generating');
    try {
      const translated = (await api.ai.translate(prompt.trim())).translated;
      let base64Image: string | undefined;

      // Try loading from active layer's cache first (perspective layers)
      const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
      if (activeLayer?.resultImageId) {
        const cacheUrl = api.image.cacheUrl(activeLayer.resultImageId);
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

      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: mask,
        prompt: translated,
      });
      state.setSelectionDraft({ ...selection, prompt });
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

  const applySelected = async () => {
    const selection = state.selectionDraft;
    if (!selectedVariant || !selection) return;
    setError('');
    state.setWorkflow('generating'); // show loading state during reprojection
    try {
      const { resultImageId } = await api.image.saveResultCache(selectedVariant.base64Result);

      // For perspective layers, reproject immediately so 360 view has the equirectangular buffer ready
      let equirectImageId: string | undefined;
      if (selection.sourceView === '360') {
        const reprojResult = await api.image.reproject({
          resultImageId,
          selection,
          imagePath: state.imagePath!,
        });
        equirectImageId = reprojResult.equirectImageId;
      }

      const existing = state.activeLayerId ? state.layers.find((layer) => layer.id === state.activeLayerId) : null;
      const layer: Layer = {
        id: existing?.id ?? crypto.randomUUID(),
        order: existing?.order ?? state.layers.length + 1,
        type: selection.sourceView === '360' ? 'perspective' : 'flat',
        visible: existing?.visible ?? true,
        ...selection.viewPose,
        tileCoords: existing?.tileCoords ?? selection.tileCoords,
        maskData: existing?.maskData ?? [],
        prompt,
        resultImageId,
        equirectImageId,
        status: 'committed',
        selection: { ...selection, prompt },
      };
      if (existing) state.updateLayer(existing.id, layer);
      else state.addLayer(layer);
      useProjectStore.setState({
        activeLayerId: layer.id,
        workflow: 'canvas-edit',
        dirty: false,
        generatedVariants: [],
        selectedVariantId: null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply thất bại');
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
      {permission.ai && (
        <button
          className="prompt-btn prompt-btn-apply"
          disabled={!selectedVariant}
          onClick={() => void applySelected()}
        >
          Apply Selected
        </button>
      )}
      {error && <span className="prompt-error" title={error}>⚠ {error}</span>}
    </div>
  );
}
