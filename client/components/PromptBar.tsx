import React, { useState, useCallback } from 'react';
import { api } from '../lib/api';
import { blobToBase64 } from '../lib/mask-utils';
import { useProjectStore } from '../stores/project';
import type { Layer } from '../../shared/types';

interface Props {
  onPreview: (base64Result: string, translatedPrompt: string) => void;
  onApply: () => void;
  hasPreview: boolean;
  disabled: boolean;
}

export default function PromptBar({ onPreview, onApply, hasPreview, disabled }: Props) {
  const [prompt, setPrompt] = useState('');
  const [flowState, setFlowState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [promptTranslated, setPromptTranslated] = useState('');
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setFlowState('loading');
    setError('');
    try {
      // 1. Translate VN→EN
      const { translated } = await api.ai.translate(prompt.trim());
      setPromptTranslated(translated);

      // 2. Get rect + mask from store
      const { rectSelect, imagePath, getMaskBase64 } = useProjectStore.getState();
      if (!rectSelect || !imagePath) throw new Error('Vẽ Rect Select trước');

      // 3. Crop tile at exact rect coordinates
      const tileUrl = `/api/image/tile?path=${encodeURIComponent(imagePath)}&x=${rectSelect.x}&y=${rectSelect.y}&w=${rectSelect.nativeW}&h=${rectSelect.nativeH}`;
      const tileResp = await fetch(tileUrl);
      const tileBlob = await tileResp.blob();
      const base64Image = await blobToBase64(tileBlob);

      // 4. Get mask as base64 from Fabric canvas (via store callback, set by FlatView/Viewer360)
      const base64Mask = getMaskBase64?.();
      if (!base64Mask) throw new Error('Vẽ mask trước khi generate');

      // 5. Call AI
      const result = await api.ai.edit({ base64Image, base64Mask, prompt: translated });

      // 6. Show preview
      setAiResult(result.base64Result);
      onPreview(result.base64Result, translated);
      setFlowState('done');
    } catch (err: any) {
      setError(err.message);
      setFlowState('idle');
    }
  };

  const handleApply = useCallback(async () => {
    const state = useProjectStore.getState();
    if (!aiResult || !state.rectSelect) return;

    // Lưu AI result vào disk cache, lấy SHA256 hash làm resultImageId
    const { resultImageId } = await api.image.saveResultCache(aiResult);

    const layer: Layer = {
      id: crypto.randomUUID(),
      order: state.layers.length + 1,
      type: state.viewLock ? 'perspective' : 'flat',
      visible: true,
      yaw: state.viewLock?.yaw ?? 0,
      pitch: state.viewLock?.pitch ?? 0,
      roll: state.viewLock?.roll ?? 0,
      fov: state.viewLock?.fov ?? 90,
      tileCoords: {
        x: state.rectSelect.x,
        y: state.rectSelect.y,
        w: state.rectSelect.nativeW,
        h: state.rectSelect.nativeH,
      },
      maskData: [],
      prompt: promptTranslated,
      resultImageId,
    };

    state.addLayer(layer);
    setFlowState('idle');
    setAiResult(null);
    onApply();
  }, [aiResult, promptTranslated, onApply]);

  return (
    <div style={styles.bar}>
      <input
        style={styles.input}
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Mô tả thay đổi (VD: xóa xe máy)..."
        disabled={disabled || flowState === 'loading'}
        onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
      />
      <button
        style={{ ...styles.btn, ...styles.generateBtn }}
        onClick={handleGenerate}
        disabled={disabled || flowState === 'loading' || !prompt.trim()}
      >
        {flowState === 'loading' ? '⏳ Generating...' : '⚡ Generate'}
      </button>
      <button
        style={{ ...styles.btn, ...styles.previewBtn }}
        disabled={flowState !== 'done'}
      >
        👁 Preview
      </button>
      <button
        style={{ ...styles.btn, ...styles.applyBtn }}
        onClick={handleApply}
        disabled={flowState !== 'done'}
      >
        ✅ Apply
      </button>
      {error && <span style={styles.error}>{error}</span>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    background: '#16213e',
    borderTop: '1px solid #333',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 6,
    border: '1px solid #444',
    background: '#1a1a2e',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    padding: '10px 20px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  generateBtn: { background: '#e94560', color: '#fff' },
  previewBtn: { background: '#0d7377', color: '#fff' },
  applyBtn: { background: '#2e7d32', color: '#fff' },
  error: { color: '#ef5350', fontSize: 13, marginLeft: 8 },
};
