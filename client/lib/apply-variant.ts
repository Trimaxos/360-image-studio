import { api } from './api';
import { useProjectStore } from '../stores/project';

export async function applyVariantToPanorama(layerId: string, variantId: string): Promise<void> {
  const state = useProjectStore.getState();
  const layer = state.layers.find((item) => item.id === layerId);
  const variant = layer?.variants?.find((item) => item.id === variantId);
  const selection = layer?.selection ?? state.selectionDraft;
  if (!layer || !variant) throw new Error('Không tìm thấy kết quả đã chọn.');
  if (variant.applied && layer.status === 'committed' && (layer.type !== 'perspective' || variant.equirectImageId)) return;

  const previousVariants = layer.variants ?? [];
  const selectedVariants = previousVariants.map((item) => ({
    ...item,
    applied: item.id === variantId,
  }));

  // The canvas selection already happened in the editor; prepare panorama data now.
  useProjectStore.getState().updateLayer(layerId, {
    status: 'committed',
    // Never fall back to layer.equirectImageId: it may belong to the variant
    // selected immediately before this one.
    equirectImageId: variant.equirectImageId,
    variants: selectedVariants,
  });
  useProjectStore.setState({ selectedVariantId: null });

  if (layer.type !== 'perspective' || variant.equirectImageId) {
    useProjectStore.setState({ workflow: 'canvas-edit', dirty: false });
    return;
  }

  useProjectStore.setState({ workflow: 'generating' });
  try {
    if (!selection || !state.imagePath) throw new Error('Thiếu dữ liệu để áp kết quả vào panorama.');
    const reprojection = await api.image.reproject({
      resultImageId: variant.resultImageId,
      selection,
      imagePath: state.imagePath,
      maskEnabled: false,
      maskData: [],
      visibilityMask: variant.visibilityMask,
    });

    useProjectStore.getState().updateLayer(layerId, {
      equirectImageId: reprojection.equirectImageId,
      variants: selectedVariants.map((item) => ({
        ...item,
        equirectImageId: item.id === variantId
          ? reprojection.equirectImageId
          : item.equirectImageId,
      })),
    });
    useProjectStore.setState({ workflow: 'canvas-edit', dirty: false, selectedVariantId: null });
  } catch (error) {
    useProjectStore.getState().updateLayer(layerId, {
      status: layer.status,
      equirectImageId: layer.equirectImageId,
      variants: previousVariants,
    });
    useProjectStore.setState({ workflow: 'canvas-edit' });
    throw error;
  }
}
