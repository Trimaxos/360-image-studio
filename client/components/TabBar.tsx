import React from 'react';

interface Props {
  activeTab: '360' | 'flat';
  onTabChange: (tab: '360' | 'flat') => void;
  disabled: boolean;
}

export default function TabBar({ activeTab, onTabChange, disabled }: Props) {
  return (
    <div style={styles.bar}>
      <button
        style={{ ...styles.tab, ...(activeTab === '360' ? styles.active : {}) }}
        onClick={() => onTabChange('360')}
        disabled={disabled}
      >
        🔄 360 View
      </button>
      <button
        style={{ ...styles.tab, ...(activeTab === 'flat' ? styles.active : {}) }}
        onClick={() => onTabChange('flat')}
        disabled={disabled}
      >
        🗺️ Flat View
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    borderBottom: '2px solid #333',
    background: '#1a1a2e',
  },
  tab: {
    flex: 1,
    padding: '12px 24px',
    border: 'none',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 600,
  },
  active: {
    color: '#fff',
    borderBottom: '2px solid #4fc3f7',
    marginBottom: -2,
  },
};
