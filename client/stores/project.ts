import { create } from 'zustand';
import type {
  AiModelOption,
  GeneratedVariant,
  Horizon,
  Layer,
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

export type ActiveTool = 'brush' | 'rect' | 'lasso' | null;
export type ViewMode = 'viewer' | 'canvas';

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
  editSnapshot: EditSnapshot | null;
  dirty: boolean;
  generatedVariants: GeneratedVariant[];
  selectedVariantId: string | null;
  selectedModel: AiModelOption | null;
  previewImage: string | null;
  previewLayer: Partial<Layer> | null;
  getMaskBase64: (() => string | null) | null;

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
  setGetMaskBase64(fn: (() => string | null) | null): void;
  setSelectionDraft(selection: SelectionDraft | null): void;
  markDirty(): void;
  setSelectedModel(model: AiModelOption | null): void;
  addGeneratedVariant(variant: GeneratedVariant): void;
  selectVariant(id: string | null): void;
  clearVariants(): void;
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
  editSnapshot: null,
  dirty: false,
  generatedVariants: [],
  selectedVariantId: null,
  selectedModel: null,
  previewImage: null,
  previewLayer: null,
  getMaskBase64: null,

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
  }),
  updateViewPose: (pose) => set((state) => state.workflow === 'viewing'
    ? { viewPose: { ...state.viewPose, ...pose }, horizon: { ...state.horizon, ...pose } }
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
      tileCoords: { x: 0, y: 0, w: perspWidth, h: perspHeight },
      maskData: [],
      prompt: selection.prompt,
      resultImageId,
      status: 'draft',
      selection,
    };
    return {
      layers: [...state.layers, layer],
      activeLayerId: layerId,
      workflow: 'canvas-edit',
      selectionDraft: selection,
      activeTool: 'brush',
      editSnapshot: { layer: null, selection },
      dirty: false,
    };
  }),
  openLayerEditor: (id) => set((state) => {
    const layer = state.layers.find((item) => item.id === id);
    if (!layer) return {};
    return {
      workflow: 'canvas-edit',
      activeLayerId: id,
      activeTool: 'brush',
      selectionDraft: layer.selection ?? null,
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
  setGetMaskBase64: (getMaskBase64) => set({ getMaskBase64 }),
  setSelectionDraft: (selectionDraft) => set({ selectionDraft, dirty: true }),
  markDirty: () => set({ dirty: true }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  addGeneratedVariant: (variant) => set((state) => ({
    workflow: 'ai-review',
    generatedVariants: [...state.generatedVariants, variant],
    selectedVariantId: variant.id,
  })),
  selectVariant: (selectedVariantId) => set({ selectedVariantId }),
  clearVariants: () => set({ generatedVariants: [], selectedVariantId: null, previewImage: null }),
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
          ? { ...layer, prompt: draft.prompt, selection: draft, status: 'committed' as const }
          : layer);
      }
    }
    return {
      layers,
      selectionDraft,
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
  })),
  updateLayer: (id, patch) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
  })),
  removeLayer: (id) => set((state) => ({
    layers: state.layers.filter((layer) => layer.id !== id),
    activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
  })),
  toggleLayerVisibility: (id) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id
      ? { ...layer, visible: layer.visible === false }
      : layer),
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
    editSnapshot: null,
    dirty: false,
    generatedVariants: [],
    selectedVariantId: null,
    previewImage: null,
    previewLayer: null,
    getMaskBase64: null,
  }),
}));
