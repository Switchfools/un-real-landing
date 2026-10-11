import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmBinary from '@jitl/quickjs-wasmfile-release-sync/wasm';
import { createVisualizationVM } from './visualization-vm.mjs';

// Bundled WASM: no runtime fetch, imports, CDN, cookies, or connection needed.
const ready = newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary, wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }) }));
ready.then(() => self.postMessage({ ready: true })).catch(() => { self.postMessage({ error: 'Interactive mode could not load.' }); self.close(); });
let vm;
self.onmessage = async event => {
  const { id, code, input } = event.data;
  try {
    if (!vm) vm = createVisualizationVM(await ready, code);
    self.postMessage({ id, frame: vm.draw(input) });
  } catch {
    self.postMessage({ id, error: 'This visualization stopped because its code or drawing exceeded the allowed limits. You can reset it.' });
    self.close();
  }
};
