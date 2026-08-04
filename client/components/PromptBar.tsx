import React, { useEffect, useState } from 'react';
import type { MaskShape } from '../../shared/types';
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
    const mask = state.getMaskBase64?.();
    const layerId = state.activeLayerId;
    if (!selection || !state.imagePath || !model || !prompt.trim()) return;

    const useMaskForAi = activeLayer?.maskForAi !== false; // default true

    // When maskForAi is on, mask is required. When off, we generate a full-white mask.
    if (useMaskForAi && !mask) return;

    setError('');
    state.setWorkflow('generating');
    try {
      const translated = (await api.ai.translate(prompt.trim())).translated;
      let base64Image: string | undefined;

      // Try loading from active layer's cache first (perspective layers)
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

      // When maskForAi is off, create a full-white mask (AI regenerates entire tile)
      const effectiveMask = useMaskForAi ? mask! : await createWhiteMask(
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
        // Auto-select the newly generated variant
        state.toggleVariant(layerId, variant.id);
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

  const applySelected = async () => {
    const selection = state.selectionDraft;
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer || !selection || !state.imagePath) return;

    // Find the applied variant for this layer
    const appliedVariant = (layer.variants ?? []).find((v) => v.applied);
    if (!appliedVariant) {
      setError('Chưa chọn kết quả nào để apply.');
      return;
    }

    setError('');
    state.setWorkflow('generating'); // show loading state during reprojection
    try {
      // For perspective layers, reproject the applied variant to equirectangular
      let equirectImageId: string | undefined;
      if (selection.sourceView === '360') {
        const shapes = layer.maskData ?? [];
        const reprojResult = await api.image.reproject({
          resultImageId: appliedVariant.resultImageId,
          selection,
          imagePath: state.imagePath,
          maskEnabled: false,           // visibility mask is handled separately
          maskData: shapes.filter((s) => s.enabled !== false),
        });
        equirectImageId = reprojResult.equirectImageId;
      }

      // Commit the layer (variant already has applied=true).
      // Set layer.resultImageId to the applied variant's cache file so re-generating
      // the layer edits the current result (not the untouched original tile).
      // Store the reprojected equirect on the VARIANT so export composites the right
      // variant even if the user toggles to another variant afterwards.
      state.updateLayer(layer.id, {
        status: 'committed',
        resultImageId: appliedVariant.resultImageId,
        equirectImageId: equirectImageId ?? layer.equirectImageId,
        variants: (layer.variants ?? []).map((v) =>
          v.id === appliedVariant.id && equirectImageId
            ? { ...v, equirectImageId }
            : v,
        ),
      });

      useProjectStore.setState({
        workflow: 'canvas-edit',
        dirty: false,
        maskDirty: false,
        generatedVariants: [],
        selectedVariantId: null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply thất bại');
      state.setWorkflow('canvas-edit');
    }
  };

  const applyMaskOnly = async () => {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    const selection = state.selectionDraft;
    if (!layer?.resultImageId || !state.imagePath || !selection) return;
    if (!state.maskDirty) return;
    setError('');
    state.setWorkflow('generating');
    try {
      // Merge canvas shapes with stored enable/disable state
      const canvasShapes = state.getMaskShapes?.() ?? [];
      const storedShapes = layer.maskData ?? [];
      const storedMap = new Map(storedShapes.map((s) => [s.id, s]));

      // Canvas shapes get their geometry, but inherit enabled state from stored
      const merged: MaskShape[] = canvasShapes.map((cs) => ({
        ...cs,
        enabled: storedMap.get(cs.id)?.enabled ?? cs.enabled ?? true,
      }));

      // Also preserve stored shapes that are disabled (not rendered on canvas)
      for (const ss of storedShapes) {
        if (ss.enabled === false && !merged.find((m) => m.id === ss.id)) {
          merged.push(ss);
        }
      }

      const maskEnabled = layer.maskEnabled ?? false;
      if (selection.sourceView === '360') {
        const reprojResult = await api.image.reproject({
          resultImageId: layer.resultImageId,
          selection,
          imagePath: state.imagePath,
          maskEnabled,
          maskData: merged.filter((s) => s.enabled !== false),
        });
        state.updateLayer(layer.id, {
          equirectImageId: reprojResult.equirectImageId,
          maskData: merged,
          maskEnabled,
        });
      } else {
        state.updateLayer(layer.id, { maskData: merged, maskEnabled });
      }
      useProjectStore.setState({ maskDirty: false, workflow: 'canvas-edit' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Apply mask thất bại');
      state.setWorkflow('canvas-edit');
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
          disabled={!activeLayer?.variants?.find(v => v.applied)}
          onClick={() => void applySelected()}
        >
          Apply Selected
        </button>
      )}
      {permission.ai && (
        <button
          className="prompt-btn prompt-btn-apply"
          disabled={!activeLayer?.resultImageId || !state.maskDirty}
          onClick={() => void applyMaskOnly()}
          style={{ background: state.maskDirty ? '#0d7377' : undefined }}
        >
          Apply Mask
        </button>
      )}
      {error && <span className="prompt-error" title={error}>⚠ {error}</span>}
    </div>
  );
}
