import React, { useCallback, useRef, useState } from 'react';
import CanvasEditor from './components/CanvasEditor';
import ExportDialog from './components/ExportDialog';
import ImageDropZone from './components/ImageDropZone';
import LayerPanel from './components/LayerPanel';
import PromptBar from './components/PromptBar';
import Toolbar from './components/Toolbar';
import { downloadBlob } from './lib/canvas-exchange';
import { api } from './lib/api';
import { useProjectStore } from './stores/project';
import type { ProjectFile } from '../shared/types';
import FlatView from './views/FlatView';
import Viewer360 from './views/Viewer360';

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const state = useProjectStore();
  const [activeTab, setActiveTab] = useState<'360' | 'flat'>('360');
  const [exportOpen, setExportOpen] = useState(false);
  const [fileSize, setFileSize] = useState<number>();
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileName = state.imagePath?.split('/').pop()?.split('\\').pop();
  const committed = state.layers.some((layer) => layer.status === 'committed');

  const openFile = useCallback(async (file: File) => {
    const meta = await api.image.upload(file);
    useProjectStore.getState().openImage(meta.path, meta.width, meta.height);
    setFileSize(file.size);
  }, []);

  const saveProject = useCallback(async () => {
    const current = useProjectStore.getState();
    if (!current.imagePath) return;
    const project: ProjectFile = {
      version: 3,
      imagePath: current.imagePath,
      layers: current.layers,
      horizon: current.horizon,
    };
    try {
      const zipBlob = await api.project.download(project);
      const base = current.imagePath.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'project';
      downloadBlob(zipBlob, `${base}.360project`);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    }
  }, []);

  const loadProject = useCallback(async (file: File) => {
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      useProjectStore.getState().openImage(project.imagePath, meta.width, meta.height);
      useProjectStore.setState({
        layers: project.layers ?? [],
        horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 },
      });
      setFileSize(meta.sizeBytes);
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    }
  }, []);

  const canvasWorkflow = ['canvas-edit', 'generating', 'ai-review'].includes(state.workflow);
  return (
    <div className="app-shell">
      <input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void openFile(file);
        event.target.value = '';
      }} />
      <input ref={projectInput} hidden type="file" accept=".360project" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void loadProject(file);
        event.target.value = '';
      }} />

      <header className="top-bar">
        <span className="top-bar-logo"><strong>360</strong><span>ImageStudio</span></span>
        <nav className="top-bar-tabs">
          <button className={`top-bar-tab ${activeTab === '360' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('360')}>🌐 360 View</button>
          <button className={`top-bar-tab ${activeTab === 'flat' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('flat')}>📐 Flat View</button>
        </nav>
        <details className="file-menu">
          <summary>☰ File</summary>
          <div className="file-menu-popover">
            <button onClick={() => imageInput.current?.click()}>📂 Open Image</button>
            <button onClick={() => projectInput.current?.click()}>📋 Load Project</button>
            <button disabled={!state.imagePath} onClick={() => void saveProject()}>💾 Download Project</button>
            <button disabled={!state.imagePath || !committed} onClick={() => setExportOpen(true)}>📤 Export Final</button>
            <button disabled={!state.imagePath} onClick={state.reset}>↻ New</button>
          </div>
        </details>
        {fileName && <span className="top-bar-file"><strong>{fileName}</strong> · {state.imageWidth} × {state.imageHeight} {fileSize ? `· ${formatFileSize(fileSize)}` : ''}</span>}
        <button className="export-final-btn" disabled={!state.imagePath || !committed} onClick={() => setExportOpen(true)}>Export Final</button>
      </header>

      <main className="workspace">
        <Toolbar onExport={() => setExportOpen(true)} onSave={() => void saveProject()} />
        <section className="editor-area">
          {state.workflow === 'empty'
            ? <ImageDropZone onOpenFile={openFile} />
            : canvasWorkflow
              ? <CanvasEditor />
              : activeTab === '360' ? <Viewer360 /> : <FlatView />}
        </section>
        <LayerPanel />
      </main>
      <PromptBar />
      <footer className="status-bar">
        <span>{fileName ? `${fileName} — ${state.layers.length} layer(s)` : 'Chưa mở ảnh'}</span>
        <span>{state.workflow}</span>
      </footer>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
