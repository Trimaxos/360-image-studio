import { create } from 'zustand';
import type {
  AiModelOption,
  GeneratedVariant,
  Horizon,
  Layer,
  LayerVariant,
  SelectionDraft,
  ViewPose,
} from '../../shared/types';
import type { WorkflowState } from './workflow';

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

export interface ProjectState {
  imagePath: string | null;
  imageWidth: number;
  imageHeight: number;
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
  selectVariantForEditing(layerId: string, variantId: string): void;
  selectOriginalVariant(layerId: string): void;
  updateVariantMask(layerId: string, variantId: string, mask: LayerVariant['visibilityMask']): void;
  removeVariantFromLayer(layerId: string, variantId: string): void;
  leaveCanvas(choice: 'save' | 'discard'): void;
  addLayer(layer: Layer): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  removeLayer(id: string): void;
  toggleLayerVisibility(id: string): void;
  reorderLayer(id: string, newOrder: number): void;
  reset(): void;
}

const defaultPose: ViewPose = { yaw: 0, pitch: 0, roll: 0, fov: 90 };
const defaultHorizon: Horizon = { yaw: 0, pitch: 0, roll: 0 };

export const useProjectStore = create<ProjectState>((set, get) => ({
  imagePath: null,
  imageWidth: 0,
  imageHeight: 0,
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

  openImage: (imagePath, imageWidth, imageHeight) => set({
    imagePath,
    imageWidth,
    imageHeight,
    layers: [],
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
    const layerId = crypto.randomUUID();
    const layer: Layer = {
      id: layerId,
      order: state.layers.length + 1,
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
    return {
      layers: [...state.layers, layer],
      activeLayerId: layerId,
      workflow: 'canvas-edit',
      selectionDraft: selection,
      regionEdit: null,
      activeTool: null,
      editSnapshot: { layer: null, selection },
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
  selectVariantForEditing: (layerId, variantId) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === layerId
      ? {
        ...layer,
        // A layer-level panorama cache must always belong to the variant that
        // is currently selected. Never keep the previously selected cache.
        equirectImageId: (() => {
          const variants = layer.variants ?? [];
          const deselect = variants.some((variant) => variant.id === variantId && variant.applied);
          return deselect
            ? undefined
            : variants.find((variant) => variant.id === variantId)?.equirectImageId;
        })(),
        variants: (() => {
          const variants = layer.variants ?? [];
          const deselect = variants.some((variant) => variant.id === variantId && variant.applied);
          return variants.map((variant) => ({
            ...variant,
            applied: deselect ? false : variant.id === variantId,
          }));
        })(),
      }
      : layer),
    selectedVariantId: null,
    hasUnsavedChanges: true,
  })),
  selectOriginalVariant: (layerId) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === layerId
      ? {
        ...layer,
        equirectImageId: undefined,
        variants: (layer.variants ?? []).map((variant) => ({ ...variant, applied: false })),
      }
      : layer),
    selectedVariantId: null,
    hasUnsavedChanges: true,
  })),
  updateVariantMask: (layerId, variantId, mask) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === layerId
      ? {
        ...layer,
        equirectImageId: undefined,
        variants: (layer.variants ?? []).map((variant) => variant.id === variantId
          ? { ...variant, visibilityMask: mask, equirectImageId: undefined }
          : variant),
      }
      : layer),
    hasUnsavedChanges: true,
  })),
  removeVariantFromLayer: (layerId, variantId) => set((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, variants: (layer.variants ?? []).filter((v) => v.id !== variantId) }
        : layer
    ),
    hasUnsavedChanges: true,
  })),
  leaveCanvas: (choice) => set((state) => {
    let layers = state.layers;
    let selectionDraft = state.selectionDraft;
    if (choice === 'discard' && state.dirty && state.editSnapshot?.layer) {
      layers = layers.map((layer) => layer.id === state.editSnapshot?.layer?.id
        ? state.editSnapshot.layer!
        : layer);
      selectionDraft = state.editSnapshot.selection;
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
  removeLayer: (id) => set((state) => ({
    layers: state.layers.filter((layer) => layer.id !== id),
    activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
    hasUnsavedChanges: true,
  })),
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
    previewImage: null,
    previewLayer: null,
  }),
}));
