import { useCallback, useEffect, useRef, useState } from 'react';
import BatchSaveConfirm from './components/BatchSaveConfirm';
import RightSidebar, { type RightTab } from './components/RightSidebar';
import { useBatchStore } from './stores/batch';
import { addBatchProjects, restoreBatchItem, saveCurrentToBatch, snapshotProject } from './lib/batch-project';
import CanvasEditor from './components/CanvasEditor';
import ErrorBoundary from './components/ErrorBoundary';
import ExportDialog from './components/ExportDialog';
import ImageDropZone from './components/ImageDropZone';
import PromptBar from './components/PromptBar';
import Toolbar from './components/Toolbar';
import { downloadBlob } from './lib/canvas-exchange';
import { api } from './lib/api';
import { resolveImageMode } from './lib/image-mode';
import { useProjectStore } from './stores/project';
import FlatView from './views/FlatView';
import Viewer360 from './views/Viewer360';
import { useAuth } from './components/LoginGate';

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const { logout } = useAuth();
  const state = useProjectStore();
  const [activeTab, setActiveTab] = useState<'360' | 'flat'>('360');
  const [exportOpen, setExportOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [loadingProjectName, setLoadingProjectName] = useState('');
  const [fileSize, setFileSize] = useState<number>();
  const saveInFlight = useRef(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchLock = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [batchError, setBatchError] = useState('');
  const [rightTab, setRightTab] = useState<RightTab>('layers');
  const batch = useBatchStore();
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDetailsElement>(null);
  const fileName = state.imagePath ? (batch.originalName || state.imagePath.split('/').pop()?.split('\\').pop()) : undefined;
  const committed = state.layers.some((layer) => layer.status === 'committed');
  const closeFileMenu = () => {
    if (fileMenuRef.current) fileMenuRef.current.open = false;
  };

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useProjectStore.getState().hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  const openFile = useCallback(async (file: File) => {
    const meta = await api.image.upload(file);
    useProjectStore.getState().reset();
    useProjectStore.getState().openImage(meta.path, meta.width, meta.height);
    useBatchStore.getState().setCurrent(null, file.name);
    setFileSize(file.size);
  }, []);

  const saveProject = useCallback(async () => {
    if (saveInFlight.current) return;
    const current = useProjectStore.getState();
    if (!current.imagePath) return;
    saveInFlight.current = true;
    setIsSavingProject(true);
    const project = snapshotProject();
    try {
      if (useBatchStore.getState().activeId) {
        setRightTab('batch');
        await saveCurrentToBatch();
        return;
      }
      const zipBlob = await api.project.download(project);
      const base = current.imagePath.split('/').pop()?.split('\\').pop()?.replace(/\.\w+$/, '') ?? 'project';
      downloadBlob(zipBlob, `${base}.360project`);
      const after = useProjectStore.getState();
      if (after.imagePath === current.imagePath && after.layers === current.layers
        && after.horizon === current.horizon && after.imageMode === current.imageMode) after.markProjectSaved();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      saveInFlight.current = false;
      setIsSavingProject(false);
    }
  }, []);

  const loadProject = useCallback(async (file: File) => {
    setIsLoadingProject(true);
    setLoadingProjectName(file.name);
    try {
      const { project } = await api.project.uploadZip(file);
      const meta = await api.image.open(project.imagePath);
      useProjectStore.getState().reset();
      useProjectStore.getState().openImage(project.imagePath, meta.width, meta.height);
      useBatchStore.getState().setCurrent(null, project.originalName || file.name.replace(/\.360project$/i, ''));
      useProjectStore.setState({
        imageMode: resolveImageMode(project.mode, useProjectStore.getState().imageMode),
        layers: project.layers ?? [],
        horizon: project.horizon ?? { yaw: 0, pitch: 0, roll: 0 },
        hasUnsavedChanges: false,
      });
      setFileSize(meta.sizeBytes);
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    } finally {
      setIsLoadingProject(false);
      setLoadingProjectName('');
    }
  }, []);

  const runBatchTask = async (action: () => Promise<void>) => {
    if (batchLock.current) return;
    batchLock.current = true;
    setBatchBusy(true);
    setBatchError('');
    try { await action(); }
    catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setBatchError(reason instanceof Error ? reason.message : 'Thao tác batch thất bại.');
      }
    } finally { batchLock.current = false; setBatchBusy(false); }
  };
  const confirmCurrent = (action: () => Promise<void>) => {
    if (batchLock.current || saveInFlight.current || isLoadingProject) return;
    if (useProjectStore.getState().workflow === 'generating') {
      setBatchError('Hãy chờ AI xử lý xong trước khi chuyển project.');
      return;
    }
    if (useProjectStore.getState().hasUnsavedChanges) setPendingAction(() => action);
    else void runBatchTask(action);
  };
  const resolvePending = (save: boolean) => {
    const action = pendingAction;
    if (!action) return;
    void runBatchTask(async () => {
      if (save) {
        await saveCurrentToBatch();
        if (useProjectStore.getState().hasUnsavedChanges) throw new Error('Project đã thay đổi trong khi lưu. Hãy lưu lại trước khi chuyển.');
      }
      setPendingAction(null);
      await action();
    });
  };

  const canvasWorkflow = ['canvas-edit', 'generating', 'ai-review'].includes(state.workflow);
  const isFlatImage = state.imageMode === 'flat';
  const modeLabel = isFlatImage ? 'Ảnh thường' : '360°';
  const switchImageMode = () => {
    const current = useProjectStore.getState();
    const next = current.imageMode === '360' ? 'flat' : '360';
    const label = next === 'flat' ? 'Ảnh thường' : '360°';
    if (current.layers.length > 0 && !confirm(`Đổi sang chế độ ${label}? Các layer hiện có có thể hiển thị sai.`)) return;
    current.setImageMode(next);
  };
  return (
    <div className="app-shell">
      <input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) confirmCurrent(() => openFile(file));
        event.target.value = '';
      }} />
      <input ref={projectInput} hidden type="file" accept=".360project" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) confirmCurrent(() => loadProject(file));
        event.target.value = '';
      }} />

      <header className="top-bar">
        <span className="top-bar-logo"><strong>360</strong><span>ImageStudio</span></span>
        <nav className="top-bar-tabs">
          {isFlatImage ? (
            <button className="top-bar-tab active" disabled>🖼 Ảnh thường</button>
          ) : (
            <>
              <button className={`top-bar-tab ${activeTab === '360' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('360')}>🌐 360 View</button>
              <button className={`top-bar-tab ${activeTab === 'flat' ? 'active' : ''}`} disabled={state.workflow !== 'viewing'} onClick={() => setActiveTab('flat')}>📐 Flat View</button>
            </>
          )}
          <button
            className="top-bar-tab"
            disabled={state.workflow !== 'viewing'}
            title="Chuyển đổi chế độ ảnh 360 / ảnh thường"
            onClick={switchImageMode}
          >
            ⇄ Chế độ: {modeLabel}
          </button>
        </nav>
        <details className="file-menu" ref={fileMenuRef}>
          <summary>☰ File</summary>
          <div className="file-menu-popover">
            <button onClick={() => { closeFileMenu(); imageInput.current?.click(); }}>📂 Open Image</button>
            <button disabled={isLoadingProject} onClick={() => { closeFileMenu(); projectInput.current?.click(); }}>📋 Load Project</button>
            <button disabled={!state.imagePath || isSavingProject} onClick={() => { closeFileMenu(); void saveProject(); }}>
              {isSavingProject ? <><span className="inline-spinner" /> Preparing Project…</> : <>💾 Download Project</>}
            </button>
            <button disabled={!state.imagePath || !committed} onClick={() => { closeFileMenu(); setExportOpen(true); }}>📤 Export Final</button>
            <button disabled={!state.imagePath} onClick={() => { closeFileMenu(); confirmCurrent(async () => { state.reset(); batch.setCurrent(null, ''); }); }}>↻ New</button>
          </div>
        </details>
        {fileName && <span className="top-bar-file"><strong>{fileName}</strong> · {state.imageWidth} × {state.imageHeight} {fileSize ? `· ${formatFileSize(fileSize)}` : ''}</span>}
        <button className="export-final-btn" disabled={!state.imagePath || !committed} onClick={() => setExportOpen(true)}>Export Final</button>
        <button className="logout-btn" onClick={() => confirmCurrent(async () => { await logout(); })}>Đăng xuất</button>
      </header>

      <ErrorBoundary>
        <main className="workspace">
          <Toolbar onExport={() => setExportOpen(true)} onSave={() => void saveProject()} isSaving={isSavingProject} />
          <section className="editor-area">
            {state.workflow === 'empty'
              ? <ImageDropZone onOpenFile={openFile} />
              : canvasWorkflow
                ? <CanvasEditor />
                : isFlatImage ? <FlatView /> : activeTab === '360' ? <Viewer360 /> : <FlatView />}
          </section>
          <RightSidebar tab={rightTab} onTab={setRightTab}
            busy={batchBusy || isSavingProject || isLoadingProject || state.workflow === 'generating'}
            canSave={!!state.imagePath && state.workflow === 'viewing'}
            onSave={() => { setRightTab('batch'); void runBatchTask(saveCurrentToBatch); }}
            onAdd={(files) => void runBatchTask(async () => {
              const errors = await addBatchProjects(files);
              if (errors.length) setBatchError(errors.join('\n'));
            })}
            onEdit={(item) => confirmCurrent(async () => { restoreBatchItem(item); setFileSize(undefined); })}
            onBeforeExport={(action) => {
              if (batch.activeId && state.hasUnsavedChanges) confirmCurrent(action);
              else void runBatchTask(action);
            }} />
        </main>
        <PromptBar />
      </ErrorBoundary>
      {batchError && <div className="batch-error" role="alert">{batchError}<button onClick={() => setBatchError('')}>Đóng</button></div>}
      {pendingAction && <BatchSaveConfirm busy={batchBusy} canSave={state.workflow === 'viewing'}
        onCancel={() => setPendingAction(null)} onContinue={resolvePending} />}
      {batchBusy && <div className="batch-working" role="status"><span className="inline-spinner" /> Đang xử lý batch…</div>}
      <footer className="status-bar">
        <span>{fileName ? `${fileName} — ${state.layers.length} layer(s)` : 'Chưa mở ảnh'}</span>
        <span>{isFlatImage ? '🖼' : '🌐'} {modeLabel} · {state.workflow}</span>
      </footer>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      {isSavingProject && (
        <div className="project-save-progress" role="status" aria-live="polite">
          <span className="inline-spinner" />
          <span><strong>Đang chuẩn bị project…</strong><small>Đang đóng gói ảnh và dữ liệu, vui lòng chờ.</small></span>
        </div>
      )}
      {isLoadingProject && (
        <div className="project-load-overlay" role="status" aria-live="assertive" aria-busy="true">
          <div className="project-load-dialog">
            <span className="inline-spinner" />
            <div>
              <strong>Đang tải project…</strong>
              <small>{loadingProjectName || 'Đang tải lên và giải nén dữ liệu, vui lòng chờ.'}</small>
              <small>Project lớn có thể cần vài phút để xử lý.</small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
