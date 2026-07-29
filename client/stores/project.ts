import { create } from 'zustand';
import type { Layer, Horizon, MaskShape } from '../../shared/types';

export interface RectSelect {
  x: number; y: number; w: number; h: number;
  nativeW: number; nativeH: number;  // real pixel size at native resolution
}

interface ViewLock {
  yaw: number; pitch: number; roll: number; fov: number;
}

interface ProjectState {
  // Image
  imagePath: string | null;
  imageWidth: number;
  imageHeight: number;

  // Layers
  layers: Layer[];

  // Horizon
  horizon: Horizon;

  // Editing state
  isEditing: boolean;
  activeTool: 'brush' | 'rect' | 'lasso' | null;

  // Rect Select (B1)
  rectSelect: RectSelect | null;

  // 360 View lock
  viewLock: ViewLock | null;
  viewMode: 'viewer' | 'canvas';   // viewer=PSV 3D, canvas=flat 2D

  // Preview
  previewImage: string | null;
  previewLayer: Partial<Layer> | null;

  // Canvas ref (set by FlatView/Viewer360 when Fabric canvas is ready)
  getMaskBase64: (() => string | null) | null;
  setGetMaskBase64: (fn: (() => string | null) | null) => void;

  // Actions
  openImage: (path: string, width: number, height: number) => void;
  setActiveTool: (tool: ProjectState['activeTool']) => void;
  setIsEditing: (v: boolean) => void;
  setRectSelect: (r: RectSelect | null) => void;
  setViewLock: (lock: ViewLock | null) => void;
  setViewMode: (mode: 'viewer' | 'canvas') => void;
  setHorizon: (h: Partial<Horizon>) => void;
  setPreview: (imageBase64: string | null, layer?: Partial<Layer>) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  reorderLayer: (id: string, newOrder: number) => void;
  reset: () => void;
}

const initialHorizon: Horizon = { roll: 0, pitch: 0, yaw: 0 };

export const useProjectStore = create<ProjectState>((set) => ({
  imagePath: null,
  imageWidth: 0,
  imageHeight: 0,
  layers: [],
  horizon: { ...initialHorizon },
  isEditing: false,
  activeTool: null,
  rectSelect: null,
  viewLock: null,
  viewMode: 'viewer',
  previewImage: null,
  previewLayer: null,
  getMaskBase64: null,

  openImage: (path, width, height) =>
    set({ imagePath: path, imageWidth: width, imageHeight: height, layers: [], horizon: { ...initialHorizon } }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setIsEditing: (v) => set({ isEditing: v }),

  setRectSelect: (r) => set({ rectSelect: r }),

  setViewLock: (lock) => set({ viewLock: lock }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setGetMaskBase64: (fn) => set({ getMaskBase64: fn }),

  setHorizon: (h) => set((s) => ({ horizon: { ...s.horizon, ...h } })),

  setPreview: (imageBase64, layer) =>
    set({ previewImage: imageBase64, previewLayer: layer || null }),

  addLayer: (layer) =>
    set((s) => {
      // Ensure visible defaults to true
      const safeLayer = { ...layer, visible: layer.visible ?? true };
      return { layers: [...s.layers, safeLayer], previewImage: null, previewLayer: null, isEditing: false, rectSelect: null, viewMode: 'viewer' };
    }),

  removeLayer: (id) =>
    set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),

  toggleLayerVisibility: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !(l.visible ?? true) } : l)),
    })),

  reorderLayer: (id, newOrder) =>
    set((s) => {
      const layer = s.layers.find((l) => l.id === id);
      if (!layer || layer.order === newOrder) return s;
      const oldOrder = layer.order;
      const direction = newOrder > oldOrder ? 1 : -1;
      return {
        layers: s.layers.map((l) => {
          if (l.id === id) return { ...l, order: newOrder };
          // Shift các layer nằm giữa old và new position
          if (direction > 0 && l.order > oldOrder && l.order <= newOrder) return { ...l, order: l.order - 1 };
          if (direction < 0 && l.order < oldOrder && l.order >= newOrder) return { ...l, order: l.order + 1 };
          return l;
        }),
      };
    }),

  reset: () =>
    set({
      imagePath: null, imageWidth: 0, imageHeight: 0,
      layers: [], horizon: { ...initialHorizon },
      isEditing: false, activeTool: null, rectSelect: null, viewLock: null, viewMode: 'viewer',
      previewImage: null, previewLayer: null,
    }),
}));
