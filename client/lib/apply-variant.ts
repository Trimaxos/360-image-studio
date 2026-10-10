import { api } from './api';
import { useProjectStore } from '../stores/project';

/**
 * Applies the result the editor is looking at to the panorama: the only way a result reaches the 360 view, the export and
 * the project file. variantId = null is the original, i.e. take the layer out of the 360 view.
 *
 * The reprojection is always recomputed (the server remembers identical runs, so repeating one is cheap) and written to the
 * layer only when it is done: while the server works, or if it fails, the layer keeps showing what it showed before.
 */
export async function applyVariantToPanorama(layerId: string, variantId: string | null): Promise<void> {
  const state = useProjectStore.getState();
  const layer = state.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error('Không tìm thấy layer.');
  const variants = layer.variants ?? [];

  if (variantId === null) {
    if (!variants.some((variant) => variant.applied)) return;
    state.updateLayer(layerId, {
      equirectImageId: undefined,
      variants: variants.map((variant) => ({ ...variant, applied: false, equirectImageId: undefined })),
    });
    return;
  }

  const variant = variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('Không tìm thấy kết quả đã chọn.');
  if (variant.needsFit) throw new Error('Kết quả đang lệch tỉ lệ — căn chỉnh xong rồi mới áp dụng.');
  if (state.applyingLayerId) throw new Error('Đang áp dụng một kết quả khác, hãy chờ xong.');
  const selection = layer.selection ?? state.selectionDraft;

  state.setApplyingLayer(layerId);
  try {
    let equirectImageId: string | undefined;
    if (layer.type === 'perspective') {
      if (!selection || !state.imagePath) throw new Error('Thiếu dữ liệu để áp kết quả vào panorama.');
      ({ equirectImageId } = await api.image.reproject({
        resultImageId: variant.resultImageId,
        selection,
        imagePath: state.imagePath,
        maskEnabled: false,
        maskData: [],
        visibilityMask: variant.visibilityMask,
      }));
    }
    // The layer may have changed or gone while the server worked: write onto what is there now, and nothing for a result
    // that was deleted meanwhile.
    const current = useProjectStore.getState().layers.find((item) => item.id === layerId);
    if (!current || !(current.variants ?? []).some((item) => item.id === variantId)) return;
    useProjectStore.getState().updateLayer(layerId, {
      status: 'committed',
      equirectImageId,
      variants: (current.variants ?? []).map((item) => ({
        ...item,
        applied: item.id === variantId,
        equirectImageId: item.id === variantId ? equirectImageId : undefined,
      })),
    });
  } finally {
    useProjectStore.getState().setApplyingLayer(null);
  }
}
