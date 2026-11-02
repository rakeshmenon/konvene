// RNNoise (a small neural network) removes steady and sudden noise from the microphone: fans, keyboards, traffic.
// It runs here, in an AudioWorklet, from files bundled with the extension. Nothing is fetched from the web.
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
export class RnnoiseReducer {
  url;
  wasm = null;
  loadedContexts = new WeakSet();
  constructor(url = (p) => chrome.runtime.getURL(p)) {
    this.url = url;
  }
  async create(context) {
    try {
      this.wasm ??= loadRnnoise({ url: this.url("vendor/rnnoise/rnnoise.wasm"), simdUrl: this.url("vendor/rnnoise/rnnoise_simd.wasm") });
      const wasmBinary = await this.wasm;
      if (!this.loadedContexts.has(context)) {
        await context.audioWorklet.addModule(this.url("vendor/rnnoise/rnnoiseWorklet.js"));
        this.loadedContexts.add(context);
      }
      const node = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
      return {
        node,
        dispose: () => {
          try {
            node.disconnect();
            node.destroy();
          } catch {
            /* already gone */
          }
        },
      };
    } catch (e) {
      // The recording still works without it. The mic keeps the browser's own noise control.
      console.warn("RNNoise is not available, recording without it", e);
      this.wasm = null;
      return null;
    }
  }
}
