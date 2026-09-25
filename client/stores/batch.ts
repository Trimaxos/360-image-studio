import { create } from 'zustand';
import type { ProjectFile } from '../../shared/types';

export interface BatchItem {
  id: string;
  projectName: string;
  originalName: string;
  project: ProjectFile;
  width: number;
  height: number;
  fileHandle?: FileSystemFileHandle;
}

interface BatchState {
  items: BatchItem[];
  directory: FileSystemDirectoryHandle | null;
  activeId: string | null;
  originalName: string;
  setDirectory(directory: FileSystemDirectoryHandle): void;
  setCurrent(activeId: string | null, originalName: string): void;
  upsert(item: BatchItem): void;
  remove(id: string): void;
}

// Deliberately session-only: never persist directory handles or the queue.
export const useBatchStore = create<BatchState>((set) => ({
  items: [], directory: null, activeId: null, originalName: '',
  setDirectory: (directory) => set({ directory }),
  setCurrent: (activeId, originalName) => set({ activeId, originalName }),
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
