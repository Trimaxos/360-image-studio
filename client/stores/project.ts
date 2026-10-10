import { create } from 'zustand';
import type {
  AiModelOption,
  GeneratedVariant,
  Horizon,
  ImageMode,
  Layer,
  LayerVariant,
  SelectionDraft,
  ViewPose,
} from '../../shared/types';
import type { CropMark, ParsedMark } from '../../shared/crop-plan';
import type { WorkflowState } from './workflow';
import { detectImageMode } from '../lib/image-mode';

export interface RectSelect {
  x: number;
  y: number;
  w: number;
  h: number;
  nativeW: number;
  nativeH: number;
}

export type ActiveTool = 'rect' | null;
export type ViewMode = 'viewer' | 'canvas';

/**
 * A user-drawn region within the currently displayed canvas-edit image.
 * Generate still sends the AI the *full* image (so it has real scene context
 * instead of an isolated crop), but the result is only kept within this
 * region — everywhere else reverts to the original (see blendRegionResult).
 * For models with real inpainting mask support, `maskBase64` is also sent as
 * the AI's own mask so it's guided to edit there directly.
 */
export interface RegionEdit {
  /** The drawn lasso outline, in full-image pixel space — used to redraw
   *  exactly what the user traced (see CanvasEditor's indicator). */
  points: { x: number; y: number }[];
  /** Full-image-sized grayscale mask rasterized from `points` (white = inside). */
  maskBase64: string;
}

interface EditSnapshot {
  layer: Layer | null;
  selection: SelectionDraft | null;
}

/** An AI generation that belongs to a layer, not to the screen: it goes on when the editor is left. */
export interface Generation {
  status: 'queued' | 'running' | 'failed';
  error?: string;
  startedAt: number;
}

export interface ProjectState {
  imagePath: string | null;
  imageWidth: number;
  imageHeight: number;
  imageMode: ImageMode;
  layers: Layer[];
  horizon: Horizon;
  workflow: WorkflowState;
  viewPose: ViewPose;
  viewLock: ViewPose | null;
  viewMode: ViewMode;
  activeTool: ActiveTool;
  activeLayerId: string | null;
  rectSelect: RectSelect | null;
  selectionDraft: SelectionDraft | null;
  regionEdit: RegionEdit | null;
  editSnapshot: EditSnapshot | null;
  dirty: boolean;
  hasUnsavedChanges: boolean;
  generatedVariants: GeneratedVariant[];
  selectedVariantId: string | null;
  selectedModel: AiModelOption | null;
  previewImage: string | null;
  previewLayer: Partial<Layer> | null;
  /** Window boxes marked on the Flat View; session-only, turned into draft layers by "Tạo layer crop". */
  marks: CropMark[];
  /** open = the "Khung cửa" panel is showing (Flat View then draws the grid and the boxes). */
  marksUi: { open: boolean; grid: boolean; draw: boolean };
  /** The "Tạo layer crop" run in progress. Kept here, not in the panel, so closing the tab neither loses it nor allows a second one. */
  marksRun: { id: number; done: number; total: number } | null;
  /** Crops of the last run that failed ("Tên: lỗi"); cleared when the next run starts or another image opens. */
  marksFailures: string[];
  /**
   * The result the editor is looking at (null = the original tile). Looking is not applying: it only decides what the canvas
   * shows and what the next Generate continues from, and never reaches the 360 view, the export or the project file.
   */
  reviewVariantId: string | null;
  /** The layer whose result is being applied to the panorama (the server is reprojecting it). */
  applyingLayerId: string | null;
  /** AI generations by layer id: queued, running, or failed (a finished one leaves its result in the layer's variants). */
  generations: Record<string, Generation>;

  addMarks(marks: ParsedMark[]): void;
  removeMark(id: string): void;
  clearMarks(): void;
  setMarksUi(patch: Partial<ProjectState['marksUi']>): void;
  setMarksRun(run: ProjectState['marksRun']): void;
  setMarksFailures(failures: string[]): void;
  /** Adds an unedited crop layer without leaving the viewing screen (bulk crops). */
  addDraftLayer(selection: SelectionDraft, resultImageId: string, width: number, height: number, name: string): void;
  openImage(path: string, width: number, height: number): void;
  updateViewPose(pose: Partial<ViewPose>): void;
  enterRectSelect(sourceView: '360' | 'flat'): void;
  createPerspectiveLayer(selection: SelectionDraft, resultImageId: string, perspWidth: number, perspHeight: number): void;
  openLayerEditor(id: string): void;
  setWorkflow(workflow: WorkflowState): void;
  setActiveTool(tool: ActiveTool): void;
  setIsEditing(value: boolean): void;
  setRectSelect(rect: RectSelect | null): void;
  setViewLock(lock: ViewPose | null): void;
  setViewMode(mode: ViewMode): void;
  setImageMode(mode: ImageMode): void;
  setHorizon(horizon: Partial<Horizon>): void;
  setPreview(imageBase64: string | null, layer?: Partial<Layer>): void;
  setSelectionDraft(selection: SelectionDraft | null): void;
  setRegionEdit(region: RegionEdit | null): void;
  markDirty(): void;
  markProjectSaved(): void;
  setSelectedModel(model: AiModelOption | null): void;
  addGeneratedVariant(variant: GeneratedVariant): void;
  selectVariant(id: string | null): void;
  clearVariants(): void;
  // Variant management (v4)
  addVariantToLayer(layerId: string, variant: LayerVariant): void;
  setReviewVariant(variantId: string | null): void;
  setApplyingLayer(layerId: string | null): void;
  setGeneration(layerId: string, generation: Generation | null): void;
  updateVariantMask(layerId: string, variantId: string, mask: LayerVariant['visibilityMask']): void;
  updateVariantResult(layerId: string, variantId: string, result: {
    resultImageId: string; width: number; height: number;
  }): void;
  removeVariantFromLayer(layerId: string, variantId: string): void;
  /** Variant vừa import lệch tỉ lệ, cần tự mở trình căn chỉnh (transform) */
  pendingFitVariant: { layerId: string; variantId: string } | null;
  setPendingFitVariant(value: { layerId: string; variantId: string } | null): void;
  /** keep = Back: hide the editor and keep everything (results, applied result, running generations). */
  leaveCanvas(choice: 'save' | 'discard' | 'keep'): void;
  addLayer(layer: Layer): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  removeLayer(id: string): void;
  toggleLayerVisibility(id: string): void;
  reorderLayer(id: string, newOrder: number): void;
  reset(): void;
}

const defaultPose: ViewPose = { yaw: 0, pitch: 0, roll: 0, fov: 90 };
const defaultHorizon: Horizon = { yaw: 0, pitch: 0, roll: 0 };

/** What the editor looks at when a layer is opened: the result applied to the 360 view, else the newest result, else the original. */
function defaultReviewVariantId(layer: Layer): string | null {
  const variants = layer.variants ?? [];
  return variants.find((variant) => variant.applied)?.id ?? newestVariantId(variants);
}

/** The most recent result (the later one when two share a timestamp), or null when there are none. */
function newestVariantId(variants: LayerVariant[]): string | null {
  let newest: LayerVariant | undefined;
  for (const variant of variants) if (!newest || variant.createdAt >= newest.createdAt) newest = variant;
  return newest?.id ?? null;
}

function newPerspectiveLayer(
  order: number, selection: SelectionDraft, resultImageId: string, perspWidth: number, perspHeight: number,
): Layer {
  return {
    id: crypto.randomUUID(),
    order,
    type: selection.sourceView === '360' ? 'perspective' : 'flat',
    visible: true,
    ...selection.viewPose,
    tileCoords: selection.sourceView === 'flat'
      ? { x: selection.tileCoords.x, y: selection.tileCoords.y, w: perspWidth, h: perspHeight }
      : { x: 0, y: 0, w: perspWidth, h: perspHeight },
    maskData: [],
    prompt: selection.prompt,
    resultImageId,
    status: 'draft',
    selection,
    variants: [],
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  imagePath: null,
  imageWidth: 0,
  imageHeight: 0,
  imageMode: '360',
  layers: [],
  horizon: { ...defaultHorizon },
  workflow: 'empty',
  viewPose: { ...defaultPose },
  viewLock: null,
  viewMode: 'viewer',
  activeTool: null,
  activeLayerId: null,
  rectSelect: null,
  selectionDraft: null,
  regionEdit: null,
  editSnapshot: null,
  dirty: false,
  hasUnsavedChanges: false,
  generatedVariants: [],
  selectedVariantId: null,
  selectedModel: null,
  previewImage: null,
  previewLayer: null,
  marks: [],
  marksUi: { open: false, grid: true, draw: false },
  marksRun: null,
  marksFailures: [],
  reviewVariantId: null,
  applyingLayerId: null,
  generations: {},

  setMarksRun: (marksRun) => set({ marksRun }),
  setMarksFailures: (marksFailures) => set({ marksFailures }),
  addMarks: (marks) => set((state) => ({
    marks: [...state.marks, ...marks.map((mark) => ({ ...mark, id: crypto.randomUUID() }))],
  })),
  removeMark: (id) => set((state) => ({ marks: state.marks.filter((mark) => mark.id !== id) })),
  clearMarks: () => set({ marks: [] }),
  setMarksUi: (patch) => set((state) => ({ marksUi: { ...state.marksUi, ...patch } })),
  addDraftLayer: (selection, resultImageId, perspWidth, perspHeight, name) => set((state) => ({
    layers: [
      ...state.layers,
      { ...newPerspectiveLayer(state.layers.length + 1, selection, resultImageId, perspWidth, perspHeight), name },
    ],
    hasUnsavedChanges: true,
  })),
  openImage: (imagePath, imageWidth, imageHeight) => set({
    imagePath,
    imageWidth,
    imageHeight,
    imageMode: detectImageMode(imageWidth, imageHeight),
    layers: [],
    marks: [],
    marksUi: { ...get().marksUi, draw: false },
    marksRun: null,
    marksFailures: [],
    reviewVariantId: null,
    applyingLayerId: null,
    generations: {},
    workflow: 'viewing',
    viewPose: { ...defaultPose },
    horizon: { ...defaultHorizon },
    activeTool: null,
    selectionDraft: null,
    generatedVariants: [],
    hasUnsavedChanges: true,
  }),
  updateViewPose: (pose) => set((state) => state.workflow === 'viewing'
    ? { viewPose: { ...state.viewPose, ...pose }, horizon: { ...state.horizon, ...pose }, hasUnsavedChanges: true }
    : {}),
  enterRectSelect: (sourceView) => set((state) => ({
    workflow: 'rect-select',
    viewLock: { ...state.viewPose },
    viewMode: sourceView === '360' ? 'viewer' : 'canvas',
    activeTool: 'rect',
    selectionDraft: null,
    rectSelect: null,
  })),
  createPerspectiveLayer: (selection, resultImageId, perspWidth, perspHeight) => set((state) => {
    const layer = newPerspectiveLayer(state.layers.length + 1, selection, resultImageId, perspWidth, perspHeight);
    return {
      layers: [...state.layers, layer],
      activeLayerId: layer.id,
      workflow: 'canvas-edit',
      selectionDraft: selection,
      regionEdit: null,
      activeTool: null,
      editSnapshot: { layer: null, selection },
      reviewVariantId: null,
      dirty: false,
      hasUnsavedChanges: true,
    };
  }),
  openLayerEditor: (id) => set((state) => {
    if (['canvas-edit', 'generating', 'ai-review'].includes(state.workflow)) return {};
    const layer = state.layers.find((item) => item.id === id);
    if (!layer) return {};
    return {
      workflow: 'canvas-edit',
      activeLayerId: id,
      activeTool: null,
      selectionDraft: layer.selection ?? null,
      regionEdit: null,
      editSnapshot: { layer: structuredClone(layer), selection: layer.selection ?? null },
      reviewVariantId: defaultReviewVariantId(layer),
      dirty: false,
      generatedVariants: [],
      selectedVariantId: null,
    };
  }),
  setWorkflow: (workflow) => set({ workflow }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setIsEditing: (value) => set({ workflow: value ? 'rect-select' : 'viewing' }),
  setRectSelect: (rectSelect) => set({ rectSelect }),
  setViewLock: (viewLock) => set({ viewLock }),
  setViewMode: (viewMode) => set({ viewMode }),
  setImageMode: (imageMode) => set({ imageMode, hasUnsavedChanges: true }),
  setHorizon: (horizon) => get().updateViewPose(horizon),
  setPreview: (previewImage, previewLayer) => set({ previewImage, previewLayer: previewLayer ?? null }),
  setSelectionDraft: (selectionDraft) => set({ selectionDraft, dirty: true, hasUnsavedChanges: true }),
  setRegionEdit: (regionEdit) => set({ regionEdit }),
  markDirty: () => set({ dirty: true, hasUnsavedChanges: true }),
  markProjectSaved: () => set({ hasUnsavedChanges: false }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  addGeneratedVariant: (variant) => set((state) => ({
    workflow: 'ai-review',
    generatedVariants: [...state.generatedVariants, variant],
    selectedVariantId: variant.id,
    hasUnsavedChanges: true,
  })),
  selectVariant: (selectedVariantId) => set({ selectedVariantId }),
  clearVariants: () => set({ generatedVariants: [], selectedVariantId: null, previewImage: null }),
  addVariantToLayer: (layerId, variant) => set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, variants: [...(layer.variants ?? []), variant] }
        : layer
    ),
    hasUnsavedChanges: true,
  })),
  setReviewVariant: (reviewVariantId) => set({ reviewVariantId, selectedVariantId: null }),
  setApplyingLayer: (applyingLayerId) => set({ applyingLayerId }),
  setGeneration: (layerId, generation) => set((state) => {
    const generations = { ...state.generations };
    if (generation) generations[layerId] = generation;
    else delete generations[layerId];
    return { generations };
  }),
  // The mask and the fit are edits to a result. They never touch the panorama cache of the applied result: the 360 view
  // keeps showing what was applied until the next Apply recomputes it.
  updateVariantMask: (layerId, variantId, mask) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === layerId
      ? {
        ...layer,
        variants: (layer.variants ?? []).map((variant) => variant.id === variantId
          ? { ...variant, visibilityMask: mask }
          : variant),
      }
      : layer),
    hasUnsavedChanges: true,
  })),
  updateVariantResult: (layerId, variantId, result) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === layerId
      ? {
        ...layer,
        variants: (layer.variants ?? []).map((variant) => variant.id === variantId
          ? {
            ...variant,
            resultImageId: result.resultImageId,
            width: result.width,
            height: result.height,
            needsFit: false,
            visibilityMask: undefined,
          }
          : variant),
      }
      : layer),
    hasUnsavedChanges: true,
  })),
  pendingFitVariant: null,
  setPendingFitVariant: (pendingFitVariant) => set({ pendingFitVariant }),
  removeVariantFromLayer: (layerId, variantId) => set((state) => {
    const layers = state.layers.map((layer) =>
      layer.id === layerId
        ? {
          ...layer,
          variants: (layer.variants ?? []).filter((v) => v.id !== variantId),
          // The picture on the 360 view belongs to the applied result: deleting that result takes the layer out of it.
          equirectImageId: (layer.variants ?? []).some((v) => v.id === variantId && v.applied) ? undefined : layer.equirectImageId,
        }
        : layer
    );
    // Deleting the result being looked at moves the editor to the newest one that is left (or the original).
    const lookingAtIt = state.reviewVariantId === variantId;
    return {
      layers,
      reviewVariantId: lookingAtIt
        ? newestVariantId(layers.find((layer) => layer.id === layerId)?.variants ?? [])
        : state.reviewVariantId,
      hasUnsavedChanges: true,
    };
  }),
  leaveCanvas: (choice) => set((state) => {
    let layers = state.layers;
    let selectionDraft = state.selectionDraft;
    if (choice === 'discard' && state.dirty && state.editSnapshot?.layer) {
      layers = layers.map((layer) => layer.id === state.editSnapshot?.layer?.id
        ? state.editSnapshot.layer!
        : layer);
      selectionDraft = state.editSnapshot.selection;
    } else if (choice === 'discard' && state.activeLayerId && !state.editSnapshot?.layer) {
      // A new layer never goes back to a snapshot. If the user already applied
      // a variant, commit it — draft layers are filtered out of the view
      // preview, so discarding would silently hide the applied result.
      const active = state.layers.find((layer) => layer.id === state.activeLayerId);
      if ((active?.variants ?? []).some((variant) => variant.applied)) {
        layers = layers.map((layer) => layer.id === state.activeLayerId
          ? { ...layer, status: 'committed' as const }
          : layer);
      }
    } else if (choice === 'save' && state.activeLayerId) {
      // Update existing layer (created on Apply Rect) with latest selection state
      const draft = state.selectionDraft;
      if (draft) {
        layers = layers.map((layer): Layer => layer.id === state.activeLayerId
          ? {
            ...layer,
            prompt: draft.prompt,
            selection: draft,
            status: 'committed' as const,
          }
          : layer);
      }
    } else if (choice === 'keep' && state.activeLayerId) {
      // Back only hides the editor: the prompt and the selection are kept with the layer, nothing else changes. What is
      // applied to the 360 view, the results and the generations that are still running are all left alone.
      const draft = state.selectionDraft;
      if (draft) {
        layers = layers.map((layer): Layer => layer.id === state.activeLayerId
          ? { ...layer, prompt: draft.prompt, selection: draft }
          : layer);
      }
    }
    return {
      layers,
      selectionDraft,
      regionEdit: null,
      workflow: 'viewing',
      activeTool: null,
      activeLayerId: null,
      viewLock: null,
      editSnapshot: null,
      reviewVariantId: null,
      dirty: false,
      generatedVariants: [],
      selectedVariantId: null,
      previewImage: null,
    };
  }),
  addLayer: (layer) => set((state) => ({
    layers: [...state.layers, { ...layer, visible: layer.visible ?? true }],
    hasUnsavedChanges: true,
  })),
  updateLayer: (id, patch) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
    hasUnsavedChanges: true,
  })),
  removeLayer: (id) => set((state) => {
    const generations = { ...state.generations };
    delete generations[id];
    return {
      layers: state.layers.filter((layer) => layer.id !== id),
      activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
      generations,
      hasUnsavedChanges: true,
    };
  }),
  // Note: variant cache files are NOT deleted on removeLayer to avoid
  // accidental data loss. Cache dir is cleaned on reset.
  toggleLayerVisibility: (id) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id
      ? { ...layer, visible: layer.visible === false }
      : layer),
    hasUnsavedChanges: true,
  })),
  reorderLayer: (id, newOrder) => set((state) => {
    const target = state.layers.find((layer) => layer.id === id);
    if (!target) return {};
    const oldOrder = target.order;
    return {
      layers: state.layers.map((layer) => {
        if (layer.id === id) return { ...layer, order: newOrder };
        if (newOrder > oldOrder && layer.order > oldOrder && layer.order <= newOrder) {
          return { ...layer, order: layer.order - 1 };
        }
        if (newOrder < oldOrder && layer.order < oldOrder && layer.order >= newOrder) {
          return { ...layer, order: layer.order + 1 };
        }
        return layer;
      }),
      hasUnsavedChanges: true,
    };
  }),
  reset: () => set({
    imagePath: null,
    imageWidth: 0,
    imageHeight: 0,
    imageMode: '360',
    layers: [],
    marks: [],
    marksUi: { ...get().marksUi, draw: false },
    marksRun: null,
    marksFailures: [],
    reviewVariantId: null,
    applyingLayerId: null,
    generations: {},
    horizon: { ...defaultHorizon },
    workflow: 'empty',
    viewPose: { ...defaultPose },
    viewLock: null,
    viewMode: 'viewer',
    activeTool: null,
    activeLayerId: null,
    rectSelect: null,
    selectionDraft: null,
    regionEdit: null,
    editSnapshot: null,
    dirty: false,
    hasUnsavedChanges: false,
    generatedVariants: [],
    selectedVariantId: null,
    previewImage: null,
    previewLayer: null,
    pendingFitVariant: null,
  }),
}));
