import React from 'react';
import { useProjectStore } from '../stores/project';

export default function LayerPanel() {
  const state = useProjectStore();
  const sorted = [...state.layers].sort((a, b) => b.order - a.order);
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);

  const toggleMaskShape = (shapeId: string) => {
    if (!activeLayer) return;
    const maskData = (activeLayer.maskData ?? []).map((s) =>
      s.id === shapeId ? { ...s, enabled: !(s.enabled !== false) } : s,
    );
    void state.setLayerMask(activeLayer.id, { maskData });
  };

  const removeMaskShape = (shapeId: string) => {
    if (!activeLayer) return;
    const maskData = (activeLayer.maskData ?? []).filter((s) => s.id !== shapeId);
    void state.setLayerMask(activeLayer.id, { maskData });
  };

  return (
    <aside className="layer-panel">
      <div className="panel-header">
        Layers <span className="layer-count">{state.layers.length} layer(s)</span>
      </div>
      {!sorted.length ? <p className="layer-empty">Chưa có chỉnh sửa nào</p> : (
        <div className="layer-list">
          {sorted.map((layer) => (
            <div
              key={layer.id}
              className={`layer-item ${state.activeLayerId === layer.id ? 'active' : ''} ${layer.visible === false ? 'hidden-layer' : ''}`}
              onClick={() => useProjectStore.setState({ activeLayerId: layer.id })}
            >
              <div className="layer-thumb">{layer.type === 'perspective' ? '360°' : '2D'}</div>
              <div className="layer-info">
                <div className="layer-name">{layer.name ?? `Layer ${layer.order}`}</div>
                <div className="layer-meta">{layer.status ?? 'draft'} · {layer.tileCoords.w}×{layer.tileCoords.h}</div>
              </div>
              <div className="layer-actions">
                <button className={layer.visible === false ? 'hidden' : 'visible'} onClick={(event) => { event.stopPropagation(); state.toggleLayerVisibility(layer.id); }} title="Ẩn/hiện">👁</button>
                <button onClick={(event) => { event.stopPropagation(); state.openLayerEditor(layer.id); }} title="Edit">✎</button>
                <button onClick={(event) => {
                  event.stopPropagation();
                  if (confirm(`Xóa Layer ${layer.order}?`)) state.removeLayer(layer.id);
                }} title="Xóa">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {activeLayer && state.workflow === 'canvas-edit' && (
        <div className="mask-panel">
          <label className="mask-toggle-row" title="When ON, mask shapes are sent to AI to limit generation scope. When OFF, AI generates on the full tile.">
            <input
              type="checkbox"
              checked={activeLayer.maskForAi !== false}
              onChange={(e) => { void state.setLayerMask(activeLayer.id, { maskForAi: e.target.checked }); }}
            />
            Use mask for AI
          </label>
          {(activeLayer.maskData ?? []).length === 0 ? (
            <p className="mask-empty">No mask shapes</p>
          ) : (
            <ul className="mask-shape-list">
              {(activeLayer.maskData ?? []).map((shape) => (
                <li key={shape.id} className="mask-shape-item">
                  <span>{shape.type}</span>
                  <button
                    className={shape.enabled !== false ? 'on' : 'off'}
                    onClick={() => toggleMaskShape(shape.id!)}
                    title={shape.enabled !== false ? 'Disable' : 'Enable'}
                  >
                    {shape.enabled !== false ? '👁' : '🚫'}
                  </button>
                  <button onClick={() => removeMaskShape(shape.id!)} title="Delete">🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
