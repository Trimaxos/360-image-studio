/** Auto mode (?auto=1) is for the browser automation: it adds menu items that skip file dialogs. Manual use never sees them. */
export function isAutoMode(search: string = window.location.search): boolean {
  return new URLSearchParams(search).has('auto');
}
