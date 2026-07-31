export type WorkflowState =
  | 'empty'
  | 'viewing'
  | 'rect-select'
  | 'canvas-edit'
  | 'generating'
  | 'ai-review';

export type WorkflowEvent =
  | 'OPEN_IMAGE'
  | 'EDIT_HERE'
  | 'APPLY_RECT'
  | 'GENERATE'
  | 'GENERATED'
  | 'BACK'
  | 'RESET';

export interface WorkflowPermissions {
  camera: boolean;
  viewControls: boolean;
  rect: boolean;
  brush: boolean;
  lasso: boolean;
  eraser: boolean;
  undo: boolean;
  ai: boolean;
}

export function transitionWorkflow(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  const transitions: Partial<Record<WorkflowState, Partial<Record<WorkflowEvent, WorkflowState>>>> = {
    empty: { OPEN_IMAGE: 'viewing' },
    viewing: { EDIT_HERE: 'rect-select', RESET: 'empty' },
    'rect-select': { APPLY_RECT: 'canvas-edit', BACK: 'viewing', RESET: 'empty' },
    'canvas-edit': { GENERATE: 'generating', BACK: 'viewing', RESET: 'empty' },
    generating: { GENERATED: 'ai-review', RESET: 'empty' },
    'ai-review': { GENERATE: 'generating', BACK: 'viewing', RESET: 'empty' },
  };
  return transitions[state]?.[event] ?? state;
}

export function permissionsFor(state: WorkflowState): WorkflowPermissions {
  return {
    camera: state === 'viewing',
    viewControls: state === 'viewing',
    rect: state === 'rect-select',
    brush: state === 'canvas-edit' || state === 'ai-review',
    lasso: state === 'canvas-edit' || state === 'ai-review',
    eraser: state === 'canvas-edit' || state === 'ai-review',
    undo: state === 'canvas-edit' || state === 'ai-review',
    ai: state === 'canvas-edit' || state === 'ai-review',
  };
}
