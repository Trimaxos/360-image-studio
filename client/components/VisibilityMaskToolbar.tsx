import React, { useState } from 'react';

interface Props {
  mode: 'add' | 'remove';
  brushSize: number;
  brushSoftness: number;
  onModeChange: (mode: 'add' | 'remove') => void;
  onBrushSizeChange: (size: number) => void;
  onBrushSoftnessChange: (softness: number) => void;
  onDone: () => void;
}

export default function VisibilityMaskToolbar({
  mode,
  brushSize,
  brushSoftness,
  onModeChange,
  onBrushSizeChange,
  onBrushSoftnessChange,
  onDone,
}: Props) {
  const [sizeInput, setSizeInput] = useState(String(brushSize));

  const applySize = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1 && n <= 500) {
      setSizeInput(String(n));
      onBrushSizeChange(n);
    }
  };

  return (
    <div className="visibility-mask-toolbar">
      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Mode:</span>
        <button
          className={`mask-mode-btn ${mode === 'add' ? 'active' : ''}`}
          onClick={() => onModeChange('add')}
        >
          Add Region
        </button>
        <button
          className={`mask-mode-btn ${mode === 'remove' ? 'active' : ''}`}
          onClick={() => onModeChange('remove')}
        >
          Remove Region
        </button>
      </div>

      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Size:</span>
        <button
          className="mask-size-btn"
          onClick={() => applySize(String(Math.max(1, brushSize - 4)))}
        >
          −
        </button>
        <input
          className="mask-size-input"
          type="number"
          min={1}
          max={500}
          value={sizeInput}
          onChange={(e) => setSizeInput(e.target.value)}
          onBlur={() => applySize(sizeInput)}
          onKeyDown={(e) => { if (e.key === 'Enter') applySize(sizeInput); }}
        />
        <button
          className="mask-size-btn"
          onClick={() => applySize(String(Math.min(500, brushSize + 4)))}
        >
          +
        </button>
      </div>

      <div className="mask-toolbar-row">
        <span className="mask-toolbar-label">Softness: {brushSoftness}%</span>
        <input
          className="mask-softness-slider"
          type="range"
          min={0}
          max={100}
          value={brushSoftness}
          onChange={(e) => onBrushSoftnessChange(Number(e.target.value))}
        />
      </div>

      <div className="mask-toolbar-row">
        <button className="mask-done-btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
