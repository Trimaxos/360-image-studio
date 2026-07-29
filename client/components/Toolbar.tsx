import React from 'react';
import { useProjectStore } from '../stores/project';

const tools = [
  { id: 'brush' as const, label: '🖌️ Brush', shortcut: 'B' },
  { id: 'rect' as const, label: '⬜ Rect', shortcut: 'R' },
  { id: 'lasso' as const, label: '✏️ Lasso', shortcut: 'L' },
  { id: 'horizon' as const, label: '📐 Horizon', shortcut: 'H' },
];

export default function Toolbar() {
  const activeTool = useProjectStore((s) => s.activeTool);
  const setActiveTool = useProjectStore((s) => s.setActiveTool);
  const isEditing = useProjectStore((s) => s.isEditing);

  return (
    <div style={styles.bar}>
      {tools.map((t) => (
        <button
          key={t.id}
          style={{
            ...styles.tool,
            ...(activeTool === t.id ? styles.activeTool : {}),
          }}
          onClick={() => setActiveTool(activeTool === t.id ? null : t.id)}
          disabled={isEditing && t.id !== 'horizon'}
          title={`${t.label} (${t.shortcut})`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    gap: 4,
    padding: '8px 12px',
    background: '#16213e',
    borderBottom: '1px solid #333',
  },
  tool: {
    padding: '8px 16px',
    border: '1px solid #444',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 14,
  },
  activeTool: {
    background: '#0d7377',
    borderColor: '#4fc3f7',
    color: '#fff',
  },
};
