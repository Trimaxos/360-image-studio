// AI generations belong to a layer, not to the editor screen: they go on when the editor is left, several can run at the same
// time, and what they produce lands in the layer's results. The state lives in the store (`generations`), so any screen can show it.
import type { AiEditRequest, AiModelOption, LayerVariant, SelectionDraft } from '../../shared/types';
import { useProjectStore, type Generation, type RegionEdit } from '../stores/project';
import { api } from './api';
import { blobToBase64, createWhiteMask } from './mask-utils';
import { blendRegionResult, describeRegionLocation } from './region-edit';

/**
 * The browser keeps six connections to one address and every generation holds one for about two minutes: four at a time leaves
 * room for pictures and everything else the screen needs.
 */
export const MAX_PARALLEL_GENERATIONS = 4;

export interface GenerationInput {
  layerId: string;
  prompt: string;
  model: AiModelOption;
  referenceImages: NonNullable<AiEditRequest['referenceImages']>;
}

/** Everything a generation needs, fixed at the moment Generate was pressed. */
interface Job {
  layerId: string;
  imagePath: string;
  prompt: string;
  model: AiModelOption;
  referenceImages: GenerationInput['referenceImages'];
  selection: SelectionDraft;
  /** Cache id of the picture to continue from (the result being looked at, else the layer's own tile); '' = cut it from the image. */
  sourceResultId: string;
  tile: { x: number; y: number; w: number; h: number };
  size: { width: number; height: number };
  region: RegionEdit | null;
}

/** The slow, browser-only steps of the chain; tests replace them. */
export const generationSteps = {
  async sourceImage(job: Pick<Job, 'imagePath' | 'sourceResultId' | 'tile'>): Promise<string> {
    if (job.sourceResultId) {
      const response = await fetch(api.image.cacheUrl(job.sourceResultId));
      if (!response.ok) throw new Error('Không đọc được ảnh canvas từ cache.');
      return blobToBase64(await response.blob());
    }
    const { x, y, w, h } = job.tile;
    const response = await fetch(api.image.tileUrl(job.imagePath, x, y, w, h));
    if (!response.ok) throw new Error('Không đọc được vùng ảnh.');
    return blobToBase64(await response.blob());
  },
  whiteMask: createWhiteMask,
  blend: blendRegionResult,
};

// In the order Generate was pressed (a Map keeps insertion order).
const jobs = new Map<string, Job>();

/** True while a generation is queued or running; a failed one does not count. */
export function hasGenerationInFlight(generations: Record<string, Generation>): boolean {
  return Object.values(generations).some((generation) => generation.status !== 'failed');
}

/** Queues a generation for a layer and returns at once; progress and result are in the store. */
export function startGeneration(input: GenerationInput): void {
  const state = useProjectStore.getState();
  const layer = state.layers.find((item) => item.id === input.layerId);
  const open = state.activeLayerId === input.layerId;
  const selection = (open ? state.selectionDraft : null) ?? layer?.selection;
  const prompt = input.prompt.trim();
  const current = state.generations[input.layerId];
  if (!layer || !selection || !state.imagePath || !prompt) return;
  if (current && current.status !== 'failed') return;

  const looked = open ? layer.variants?.find((variant) => variant.id === state.reviewVariantId) : undefined;
  jobs.delete(layer.id);
  jobs.set(layer.id, {
    layerId: layer.id,
    imagePath: state.imagePath,
    prompt,
    model: input.model,
    referenceImages: input.referenceImages,
    selection,
    sourceResultId: looked?.resultImageId ?? layer.resultImageId,
    tile: selection.tileCoords,
    size: { width: layer.tileCoords.w, height: layer.tileCoords.h },
    region: open ? state.regionEdit : null,
  });
  state.setGeneration(layer.id, { status: 'queued', startedAt: Date.now() });
  pump();
}

/** Starts queued generations while fewer than MAX_PARALLEL_GENERATIONS are running. */
function pump(): void {
  let running = Object.values(useProjectStore.getState().generations).filter((generation) => generation.status === 'running').length;
  for (const [layerId, job] of jobs) {
    if (running >= MAX_PARALLEL_GENERATIONS) break;
    const generation = useProjectStore.getState().generations[layerId];
    if (!generation) { jobs.delete(layerId); continue; } // cleared with its image or layer: nobody is waiting for it
    if (generation.status !== 'queued') continue;
    useProjectStore.getState().setGeneration(layerId, { ...generation, status: 'running' });
    running += 1;
    void run(job);
  }
}

/** True while the image and the layer this generation was made for are still there. */
function stillWanted(job: Job): boolean {
  const state = useProjectStore.getState();
  return state.imagePath === job.imagePath && state.layers.some((layer) => layer.id === job.layerId);
}

async function run(job: Job): Promise<void> {
  try {
    const translated = (await api.ai.translate(job.prompt)).translated;
    const base64Image = await generationSteps.sourceImage({ imagePath: job.imagePath, sourceResultId: job.sourceResultId, tile: job.tile });
    const { region } = job;
    const mask = region?.maskBase64 ?? await generationSteps.whiteMask(job.size.width, job.size.height);
    // Many models have no real mask input at all — without this they have no idea where in the image the region is.
    const located = region
      ? `${translated} (apply this specifically within the region at ${describeRegionLocation(region.points, job.size.width, job.size.height)})`
      : translated;
    const references = job.model.supportsReferenceImages ? job.referenceImages : [];
    const prompt = references.length
      ? `${located}\nImage/Figure 1 is the source scene to edit. Image(s)/Figure(s) 2-${references.length + 1} are visual references. Use the referenced subject, appearance, colors, design, and details as requested, place the result into Image/Figure 1, and do not treat the reference images as the output canvas.`
      : located;
    const result = await api.ai.edit({
      provider: job.model.provider,
      modelId: job.model.id,
      base64Image,
      base64Mask: mask,
      hasRegionMask: !!region,
      referenceImages: references,
      prompt,
    });
    const finalResult = region ? await generationSteps.blend(base64Image, result.base64Result, region.maskBase64) : result.base64Result;
    const { resultImageId } = await api.image.saveResultCache(finalResult);

    if (stillWanted(job)) land(job, resultImageId, finalResult, result.model);
  } catch (reason) {
    if (stillWanted(job)) {
      const generation = useProjectStore.getState().generations[job.layerId];
      useProjectStore.getState().setGeneration(job.layerId, {
        status: 'failed',
        error: reason instanceof Error ? reason.message : 'Generate thất bại',
        startedAt: generation?.startedAt ?? Date.now(),
      });
    }
  } finally {
    jobs.delete(job.layerId);
    pump();
  }
}

/** Puts a finished result into its layer. Nothing here applies it to the 360 view. */
function land(job: Job, resultImageId: string, base64Result: string, modelId: string): void {
  const state = useProjectStore.getState();
  const variant: LayerVariant = {
    id: crypto.randomUUID(),
    resultImageId,
    source: 'ai-generated',
    modelId,
    applied: false,
    width: job.size.width,
    height: job.size.height,
    createdAt: Date.now(),
  };
  state.addVariantToLayer(job.layerId, variant);
  if (state.activeLayerId === job.layerId) {
    // The editor is on this layer: look at the new result, and show it over the canvas as before.
    state.setSelectionDraft({ ...job.selection, prompt: job.prompt });
    state.setRegionEdit(null);
    state.setReviewVariant(variant.id);
    state.addGeneratedVariant({ id: crypto.randomUUID(), base64Result, modelId });
  } else {
    state.updateLayer(job.layerId, { prompt: job.prompt, selection: { ...job.selection, prompt: job.prompt } });
  }
  state.setGeneration(job.layerId, null);
}
