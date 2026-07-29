import React, { useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onPreview: (base64Result: string, translatedPrompt: string) => void;
  onApply: () => void;
  hasPreview: boolean;
  disabled: boolean;
}

export default function PromptBar({ onPreview, onApply, hasPreview, disabled }: Props) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePreview = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Step 1: translate
      const { translated } = await api.ai.translate(prompt.trim());
      onPreview('', translated); // placeholder — actual AI edit needs mask
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.bar}>
      <input
        style={styles.input}
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Mô tả thay đổi (VD: xóa xe máy)..."
        disabled={disabled || loading}
        onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
      />
      <button
        style={{ ...styles.btn, ...styles.previewBtn }}
        onClick={handlePreview}
        disabled={disabled || loading || !prompt.trim()}
      >
        {loading ? '⏳' : '👁'} Preview
      </button>
      <button
        style={{ ...styles.btn, ...styles.applyBtn }}
        onClick={onApply}
        disabled={!hasPreview}
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
  previewBtn: { background: '#0d7377', color: '#fff' },
  applyBtn: { background: '#2e7d32', color: '#fff' },
  error: { color: '#ef5350', fontSize: 13, marginLeft: 8 },
};
