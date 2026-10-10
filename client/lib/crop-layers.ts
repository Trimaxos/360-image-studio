// Turns the marks (plus the automatic nadir) into draft crop layers, one server render at a time.
import { compileMark, nadirMark, VIEWPORT, type CropMark } from '../../shared/crop-plan';
import type { SelectionDraft } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { api } from './api';

export interface CropLayerOutcome {
  /** Absent for the automatic nadir crop. */
  markId?: string;
  name: string;
  error?: string;
}

interface Input {
  imagePath: string;
  panorama: { width: number; height: number };
  marks: CropMark[];
  includeNadir: boolean;
  onProgress?: (done: number, total: number) => void;
}

const imageChanged = (imagePath: string) => useProjectStore.getState().imagePath !== imagePath;
const SWITCHED = 'Đã mở ảnh khác nên bỏ qua.';

async function createOne(input: Input, mark: CropMark): Promise<CropLayerOutcome> {
  const markId = mark.kind === 'nadir' ? undefined : mark.id;
  try {
    if (imageChanged(input.imagePath)) throw new Error(SWITCHED);
    const spec = compileMark(mark, { panorama: input.panorama });
    // Exactly what Apply Rect sends (RectSelectionOverlay), so the tile is the one the app would have cut.
    const result = await api.image.perspectiveRender({
      imagePath: input.imagePath,
      layers: [],
      viewPose: spec.pose,
      viewport: VIEWPORT,
      rect: spec.rect,
      mode: 'free-select',
      scaleFactor: 1,
      alignToModel: false,
    });
    if (imageChanged(input.imagePath)) throw new Error(SWITCHED);
    const selection: SelectionDraft = {
      sourceView: '360',
      mode: 'free-select',
      rect: result.rect ?? spec.rect,
      viewport: { ...VIEWPORT },
      tileCoords: { x: 0, y: 0, w: result.width, h: result.height },
      viewPose: spec.pose,
      prompt: spec.prompt,
    };
    useProjectStore.getState().addDraftLayer(selection, result.resultImageId, result.width, result.height, spec.name);
    return { markId, name: spec.name };
  } catch (error) {
    return { markId, name: mark.name, error: error instanceof Error ? error.message : 'Không tạo được layer.' };
  }
}

/** Sequential on purpose: every render unpacks the 10000x5000 original on the server. */
export async function createCropLayers(input: Input): Promise<CropLayerOutcome[]> {
  const queue = input.includeNadir ? [nadirMark(), ...input.marks] : input.marks;
  const outcomes: CropLayerOutcome[] = [];
  for (const mark of queue) {
    outcomes.push(await createOne(input, mark));
    input.onProgress?.(outcomes.length, queue.length);
  }
  return outcomes;
}

let lastRunId = 0;

/**
 * The whole "Tạo layer crop" run for the open image. Its progress and failures live in the store, not in the panel,
 * so closing the tab neither loses them nor lets a second click start the same crops again. Boxes that became layers
 * are dropped; the ones that failed stay for another run.
 */
export async function runCropLayers(includeNadir: boolean): Promise<CropLayerOutcome[]> {
  const start = useProjectStore.getState();
  const { imagePath, imageWidth, imageHeight, marks } = start;
  const total = marks.length + (includeNadir ? 1 : 0);
  if (!imagePath || start.marksRun || total === 0) return [];

  const id = ++lastRunId;
  // False once another image replaced this run (opening an image clears it): a late run must not touch what is there now.
  const isCurrent = () => useProjectStore.getState().marksRun?.id === id;
  start.setMarksFailures([]);
  start.setMarksRun({ id, done: 0, total });

  let outcomes: CropLayerOutcome[] = [];
  try {
    outcomes = await createCropLayers({
      imagePath,
      panorama: { width: imageWidth, height: imageHeight },
      marks,
      includeNadir,
      onProgress: (done) => { if (isCurrent()) useProjectStore.getState().setMarksRun({ id, done, total }); },
    });
  } finally {
    if (isCurrent()) {
      const state = useProjectStore.getState();
      for (const outcome of outcomes) if (outcome.markId && !outcome.error) state.removeMark(outcome.markId);
      state.setMarksFailures(outcomes.filter((outcome) => outcome.error).map((outcome) => `${outcome.name}: ${outcome.error}`));
      state.setMarksRun(null);
    }
  }
  return outcomes;
}
