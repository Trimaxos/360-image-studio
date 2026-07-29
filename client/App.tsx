import React, { useState, useCallback } from 'react';
import TabBar from './components/TabBar';
import Toolbar from './components/Toolbar';
import PromptBar from './components/PromptBar';
import LayerPanel from './components/LayerPanel';
import ExportDialog from './components/ExportDialog';
import FlatView from './views/FlatView';
import Viewer360 from './views/Viewer360';
import { useProjectStore } from './stores/project';
import { api } from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'360' | 'flat'>('360');
  const [exportOpen, setExportOpen] = useState(false);
  const [promptTranslated, setPromptTranslated] = useState('');

  const imagePath = useProjectStore((s) => s.imagePath);
  const isEditing = useProjectStore((s) => s.isEditing);
  const hasPreview = useProjectStore((s) => !!s.previewImage);
  const openImage = useProjectStore((s) => s.openImage);
  const reset = useProjectStore((s) => s.reset);

  const handleOpenImage = useCallback(async () => {
    const path = prompt('Nhập đường dẫn ảnh panorama:');
    if (!path) return;
    try {
      const meta = await api.image.open(path);
      openImage(path, meta.width, meta.height);
    } catch (err: any) {
      alert(`Lỗi mở ảnh: ${err.message}`);
    }
  }, [openImage]);

  const handleSaveProject = useCallback(async () => {
    const { imagePath, layers, horizon } = useProjectStore.getState();
    if (!imagePath) return;
    const projectPath = imagePath.replace(/\.\w+$/, '.360project');
    try {
      await api.project.save(projectPath, { imagePath, layers, horizon });
      alert(`Đã lưu project: ${projectPath}`);
    } catch (err: any) {
      alert(`Lỗi lưu project: ${err.message}`);
    }
  }, []);

  const handleLoadProject = useCallback(async () => {
    const path = prompt('Nhập đường dẫn file .360project:');
    if (!path) return;
    try {
      const project = await api.project.load(path);
      const meta = await api.image.open(project.imagePath);
      openImage(project.imagePath, meta.width, meta.height);
      useProjectStore.setState({ layers: project.layers, horizon: project.horizon });
    } catch (err: any) {
      alert(`Lỗi mở project: ${err.message}`);
    }
  }, [openImage]);

  const handleApply = useCallback(() => {
    // Will be fully wired in Task 13 with actual mask data
    useProjectStore.getState().setPreview(null);
    useProjectStore.getState().setIsEditing(false);
  }, []);

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <h1 style={styles.logo}>360 Image Studio</h1>
        <div style={styles.topActions}>
          <button style={styles.topBtn} onClick={handleOpenImage}>📂 Mở ảnh</button>
          <button style={styles.topBtn} onClick={handleLoadProject}>📋 Load Project</button>
          <button style={styles.topBtn} onClick={handleSaveProject} disabled={!imagePath}>💾 Save Project</button>
          <button style={styles.topBtn} onClick={() => setExportOpen(true)} disabled={!imagePath}>📤 Export</button>
          <button style={styles.topBtn} onClick={reset} disabled={!imagePath}>🔄 Reset</button>
        </div>
      </div>

      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} disabled={isEditing} />

      {/* Toolbar */}
      <Toolbar />

      {/* Main area */}
      <div style={styles.main}>
        {/* Canvas / Viewer */}
        <div style={styles.editorArea}>
          {activeTab === '360' ? <Viewer360 /> : <FlatView />}

          {/* Bottom prompt bar */}
          <PromptBar
            onPreview={(result, translated) => setPromptTranslated(translated)}
            onApply={handleApply}
            hasPreview={hasPreview}
            disabled={!imagePath}
          />
        </div>

        {/* Sidebar */}
        <LayerPanel />
      </div>

      {/* Export modal */}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f0f23',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: '#1a1a2e',
    borderBottom: '1px solid #333',
  },
  logo: { fontSize: 20, fontWeight: 700, margin: 0, color: '#4fc3f7' },
  topActions: { display: 'flex', gap: 8 },
  topBtn: {
    padding: '6px 14px',
    border: '1px solid #444',
    borderRadius: 6,
    background: '#16213e',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 13,
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  editorArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
};
