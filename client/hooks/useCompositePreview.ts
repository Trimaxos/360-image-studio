import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

export function useCompositePreview(): string | null {
  const imagePath = useProjectStore((state) => state.imagePath);
  const layers = useProjectStore((state) => state.layers);
  const [url, setUrl] = useState<string | null>(null);
  const reviewKey = useMemo(
    () => layers.map((layer) => `${layer.id}:${layer.visible}:${layer.resultImageId}:${layer.status}`).join('|'),
    [layers],
  );

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    const committed = layers.filter((layer) => layer.status === 'committed');
    if (!imagePath || !committed.length) {
      setUrl(null);
      return;
    }
    const safeLayers = committed.map((layer) => ({
      ...layer,
      selection: layer.selection
        ? { ...layer.selection, sourceImageBase64: undefined }
        : undefined,
    }));
    api.image.preview({ path: imagePath, layers: safeLayers }).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return objectUrl;
      });
    }).catch(() => {
      if (!disposed) setUrl(null);
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imagePath, reviewKey]);

  return url;
}
