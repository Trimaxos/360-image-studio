import { create } from 'zustand';
import type { ProjectFile } from '../../shared/types';
import type { ProjectFileSource } from '../lib/project-save';

export interface BatchItem {
  id: string;
  projectName: string;
  originalName: string;
  project: ProjectFile;
  width: number;
  height: number;
  fileHandle?: FileSystemFileHandle;
  /** The file the project was read from, when it came without a handle (to find and overwrite it on Save). */
  sourceFile?: { name: string; size: number; lastModified: number };
}

interface BatchState {
  items: BatchItem[];
  directory: FileSystemDirectoryHandle | null;
  activeId: string | null;
  originalName: string;
  /** The .360project the open project was read from or last saved to; null for a project never saved. */
  currentFile: ProjectFileSource | null;
  setDirectory(directory: FileSystemDirectoryHandle): void;
  setCurrent(activeId: string | null, originalName: string): void;
  setCurrentFile(file: ProjectFileSource | null): void;
  upsert(item: BatchItem): void;
  remove(id: string): void;
}

// Deliberately session-only: never persist directory handles or the queue.
export const useBatchStore = create<BatchState>((set) => ({
  items: [], directory: null, activeId: null, originalName: '', currentFile: null,
  setDirectory: (directory) => set({ directory }),
  setCurrent: (activeId, originalName) => set({ activeId, originalName }),
  setCurrentFile: (currentFile) => set({ currentFile }),
  upsert: (item) => set((state) => ({
    items: state.items.some((entry) => entry.id === item.id)
      ? state.items.map((entry) => entry.id === item.id ? item : entry)
      : [...state.items, item],
  })),
  remove: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  })),
}));
