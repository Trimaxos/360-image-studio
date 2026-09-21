// Canvas 2D is not implemented by jsdom, so tests that exercise the mask
// editor install a minimal no-op stub good enough for image loading/redraw.
export function stubCanvas2d(dom: any) {
  const proto = dom.window.HTMLCanvasElement.prototype;
  proto.getContext = function () {
    if (!this.__ctx) {
      this.__ctx = {
        fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        clearRect() {}, fillRect() {}, drawImage() {}, beginPath() {}, arc() {},
        fill() {}, save() {}, restore() {}, strokeRect() {}, setLineDash() {},
        moveTo() {}, lineTo() {}, stroke() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(Math.max(4, width * height * 4)),
        }),
        putImageData() {},
      };
    }
    return this.__ctx;
  };
  proto.toDataURL = () => 'data:image/png;base64,c3R1Yg==';
  const elementProto = dom.window.Element.prototype;
  elementProto.setPointerCapture = () => {};
  elementProto.releasePointerCapture = () => {};
}

export interface FakeImageInfo { width: number; height: number; delayMs?: number }

export function installFakeImage(globalObject: any, resolve: (src: string) => FakeImageInfo) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    naturalWidth = 1;
    naturalHeight = 1;
    set src(value: string) {
      const info = resolve(value);
      this.naturalWidth = info.width;
      this.naturalHeight = info.height;
      const fire = () => queueMicrotask(() => this.onload?.());
      if (info.delayMs && info.delayMs > 0) setTimeout(fire, info.delayMs);
      else fire();
    }
  }
  globalObject.Image = FakeImage;
}
