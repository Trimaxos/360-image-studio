import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { blobToBase64, createWhiteMask } from '../lib/mask-utils';
import { blendRegionResult, describeRegionLocation } from '../lib/region-edit';
import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';
import ModelSelector from './ModelSelector';

const MAX_REFERENCE_IMAGES = 3;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const REFERENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

interface ReferenceImage {
  id: string;
  name: string;
  base64Data: string;
  mimeType: typeof REFERENCE_MIME_TYPES[number];
}

export default function PromptBar() {
  const state = useProjectStore();
  const permission = permissionsFor(state.workflow);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const generating = state.workflow === 'generating';
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  const supportsReferenceImages = !!state.selectedModel?.supportsReferenceImages;

  useEffect(() => {
    setPrompt(state.selectionDraft?.prompt ?? '');
  }, [state.activeLayerId]);

  useEffect(() => {
    if (!supportsReferenceImages) setReferenceImages([]);
  }, [supportsReferenceImages]);

  const addReferenceImages = async (files: FileList | null) => {
    if (!files || !supportsReferenceImages) return;
    setError('');
    const availableSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const invalidType = selectedFiles.find((file) => !REFERENCE_MIME_TYPES.includes(file.type as any));
    if (invalidType) {
      setError('Ảnh tham chiếu chỉ hỗ trợ JPG, PNG hoặc WebP.');
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > MAX_REFERENCE_BYTES);
    if (oversized) {
      setError(`Ảnh tham chiếu "${oversized.name}" vượt quá 10 MB.`);
      return;
    }
    const additions = await Promise.all(selectedFiles.map(async (file): Promise<ReferenceImage> => ({
      id: crypto.randomUUID(),
      name: file.name,
      base64Data: await blobToBase64(file),
      mimeType: file.type as ReferenceImage['mimeType'],
    })));
    setReferenceImages((current) => [...current, ...additions].slice(0, MAX_REFERENCE_IMAGES));
  };

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

      // A drawn region (RegionSelectOverlay) does NOT crop the request — the AI
      // still sees the full image so it has real scene context to work from
      // (an isolated, feature-less crop makes weaker models hallucinate wrong
      // content). Instead, the result is blended back afterward so only the
      // drawn area actually changes, and — for models with real inpainting
      // mask support — the region mask is also sent to guide the edit there.
      const region = state.regionEdit;

      // Must match base64Image's real pixel size, not the on-screen selection rect —
      // for '360' selections these differ (viewport px vs. rendered perspective px).
      const imageWidth = activeLayer?.tileCoords.w ?? selection.tileCoords.w;
      const imageHeight = activeLayer?.tileCoords.h ?? selection.tileCoords.h;
      const effectiveMask = region?.maskBase64 ?? await createWhiteMask(imageWidth, imageHeight);

      // Many models have no real mask input at all — without this, they have
      // zero information about where in the image the region actually is.
      const promptWithLocation = region
        ? `${translated} (apply this specifically within the region at ${describeRegionLocation(region.points, imageWidth, imageHeight)})`
        : translated;
      const activeReferences = supportsReferenceImages ? referenceImages : [];
      const promptWithReferences = activeReferences.length
        ? `${promptWithLocation}\nImage/Figure 1 is the source scene to edit. Image(s)/Figure(s) 2-${activeReferences.length + 1} are visual references. Use the referenced subject, appearance, colors, design, and details as requested, place the result into Image/Figure 1, and do not treat the reference images as the output canvas.`
        : promptWithLocation;

      const result = await api.ai.edit({
        provider: model.provider,
        modelId: model.id,
        base64Image,
        base64Mask: effectiveMask,
        hasRegionMask: !!region,
        referenceImages: activeReferences.map(({ base64Data, mimeType }) => ({ base64Data, mimeType })),
        prompt: promptWithReferences,
      });
      const finalResult = region
        ? await blendRegionResult(base64Image, result.base64Result, region.maskBase64)
        : result.base64Result;
      state.setSelectionDraft({ ...selection, prompt });
      state.setRegionEdit(null);

      // Persist to server cache — MUST happen before creating variant
      const { resultImageId } = await api.image.saveResultCache(finalResult);

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
        base64Result: finalResult,
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
      <div className={`reference-upload ${supportsReferenceImages ? 'enabled' : 'disabled'}`}>
        <input
          ref={referenceInputRef}
          className="reference-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={!permission.ai || generating || !supportsReferenceImages}
          onChange={(event) => {
            void addReferenceImages(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="reference-upload-btn"
          disabled={!permission.ai || generating || !supportsReferenceImages || referenceImages.length >= MAX_REFERENCE_IMAGES}
          title={supportsReferenceImages
            ? 'Upload tối đa 3 ảnh JPG, PNG hoặc WebP để model dùng làm tham chiếu'
            : 'Model này không hỗ trợ nhiều ảnh đầu vào'}
          onClick={() => referenceInputRef.current?.click()}
        >
          + Ảnh tham chiếu{referenceImages.length ? ` (${referenceImages.length}/${MAX_REFERENCE_IMAGES})` : ''}
        </button>
        {referenceImages.length > 0 && (
          <div className="reference-image-list" aria-label="Ảnh tham chiếu đã chọn">
            {referenceImages.map((image, index) => (
              <div className="reference-image-chip" key={image.id} title={`Ảnh ${index + 2}: ${image.name}`}>
                <img src={`data:${image.mimeType};base64,${image.base64Data}`} alt={`Tham chiếu ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`Xóa ảnh tham chiếu ${image.name}`}
                  disabled={generating}
                  onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
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
