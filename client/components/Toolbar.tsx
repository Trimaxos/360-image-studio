import React from 'react';
import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';

interface Props {
  onExport: () => void;
  onSave: () => void;
}

export default function Toolbar({ onExport, onSave }: Props) {
  const state = useProjectStore();
  const permission = permissionsFor(state.workflow);
  const committed = state.layers.some((layer) => layer.status === 'committed');
  const controls = [
    { key: 'yaw' as const, label: 'Yaw', min: -180, max: 180 },
    { key: 'pitch' as const, label: 'Pitch', min: -90, max: 90 },
    { key: 'roll' as const, label: 'Roll', min: -180, max: 180 },
    { key: 'fov' as const, label: 'FOV', min: 10, max: 120 },
  ];
  const tools = [
    { id: 'rect' as const, icon: '▭', label: 'Rectangle Select', enabled: permission.rect },
    { id: 'brush' as const, icon: '🖊', label: 'Brush Mask', enabled: permission.brush },
    { id: 'lasso' as const, icon: '⌁', label: 'Lasso', enabled: permission.lasso },
    { id: 'eraser' as const, icon: '⌫', label: 'Eraser', enabled: permission.eraser },
  ];

  return (
    <aside className="sidebar-left">
      <section className="sidebar-section">
        <div className="sidebar-section-title">Tools</div>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`sidebar-btn ${state.activeTool === tool.id ? 'active' : ''}`}
            disabled={!tool.enabled}
            onClick={() => state.setActiveTool(tool.id)}
          >
            <span className="sidebar-btn-icon">{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
        ))}
        <button className="sidebar-btn" disabled={!permission.undo} onClick={() => window.dispatchEvent(new Event('canvas-undo'))}>
          <span className="sidebar-btn-icon">↩</span><span>Undo</span>
        </button>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-title">View Controls</div>
        {controls.map((control) => (
          <label className="sidebar-view-row" key={control.key}>
            <span>{control.label}</span>
            <strong>{state.viewPose[control.key].toFixed(1)}°</strong>
            <input
              aria-label={control.label}
              type="range"
              min={control.min}
              max={control.max}
              step={0.1}
              value={state.viewPose[control.key]}
              disabled={!permission.viewControls}
              onChange={(event) => state.updateViewPose({ [control.key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </section>

      <section className="sidebar-section project-section">
        <div className="sidebar-section-title">Project</div>
        <button className="sidebar-btn" disabled={!state.imagePath} onClick={onSave}>
          <span className="sidebar-btn-icon">💾</span><span>Save Project</span>
        </button>
        <button className="sidebar-btn" disabled={!state.imagePath || !committed} onClick={onExport}>
          <span className="sidebar-btn-icon">📤</span><span>Export Final</span>
        </button>
      </section>
    </aside>
  );
}
