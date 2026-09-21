export function setupDom(dom: any) {
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  g.HTMLImageElement = dom.window.HTMLImageElement;
  g.Image = dom.window.Image;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.Event = dom.window.Event;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  g.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout engine; components still measure on mount.
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
