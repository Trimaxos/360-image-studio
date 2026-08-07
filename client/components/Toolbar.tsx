import { permissionsFor } from '../stores/workflow';
import { useProjectStore } from '../stores/project';

interface Props {
  onExport: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function Toolbar({ onExport, onSave, isSaving }: Props) {
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
    { id: 'rect' as const, icon: '▭', label: 'Chọn hình chữ nhật', enabled: permission.rect },
  ];

  return (
    <aside className="sidebar-left">
      <section className="sidebar-section">
        <div className="sidebar-section-title">Công cụ</div>
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
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-title">Điều khiển góc nhìn</div>
        {controls.map((control) => (
          <label className="sidebar-view-row" key={control.key}>
            <span>{control.label}</span>
            <input
              className="sidebar-view-number"
              aria-label={`${control.label} value`}
              type="number"
              min={control.min}
              max={control.max}
              step={0.1}
              value={state.viewPose[control.key].toFixed(1)}
              disabled={!permission.viewControls}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(value)) return;
                state.updateViewPose({
                  [control.key]: Math.min(control.max, Math.max(control.min, value)),
                });
              }}
            />
            <input
              aria-label={`${control.label} slider`}
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
        <div className="sidebar-section-title">Dự án</div>
        <button className="sidebar-btn" disabled={!state.imagePath || isSaving} onClick={onSave} aria-busy={isSaving}>
          <span className="sidebar-btn-icon">{isSaving ? <span className="inline-spinner" /> : '💾'}</span>
          <span>{isSaving ? 'Đang chuẩn bị dự án…' : 'Lưu dự án'}</span>
        </button>
        <button className="sidebar-btn" disabled={!state.imagePath || !committed} onClick={onExport}>
          <span className="sidebar-btn-icon">📤</span><span>Xuất ảnh</span>
        </button>
      </section>
    </aside>
  );
}
