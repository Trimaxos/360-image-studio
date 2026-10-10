// In-page yes/no question. The save flow asks things like "overwrite that file?"; window.confirm is not used because
// automation (the review browser) dismisses native dialogs on its own, which would silently cancel the save.
import { create } from 'zustand';

interface ConfirmRequest { message: string; resolve(answer: boolean): void }
interface ConfirmState {
  request: ConfirmRequest | null;
  ask(message: string): Promise<boolean>;
  answer(ok: boolean): void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (message) => new Promise<boolean>((resolve) => {
    get().request?.resolve(false);   // a newer question replaces the older one, which counts as "no"
    set({ request: { message, resolve } });
  }),
  answer: (ok) => {
    const request = get().request;
    set({ request: null });
    request?.resolve(ok);
  },
}));
