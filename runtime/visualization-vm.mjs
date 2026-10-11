import { limits, validateFrame } from '../site/scripts/visualization-schema.js';

// The guest is a separate QuickJS heap in WASM, not a browser eval/Function.
// No host objects, callbacks, module loader, network, DOM or message APIs enter it.
export function createVisualizationVM(QuickJS, code) {
  if (typeof code !== 'string' || code.length > limits.code) throw new Error('Visualization code exceeds its limit.');
  const runtime = QuickJS.newRuntime(); runtime.setMemoryLimit(limits.memory); runtime.setMaxStackSize(256 * 1024);
  let deadline = performance.now() + limits.executionMs;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const vm = runtime.newContext(); let render;
  const unwrap = result => {
    if (result.error) { result.error.dispose(); throw new Error('Visualization stopped: invalid code or execution/memory limit reached.'); }
    return result.value;
  };
  try {
    // Capture JSON before guest code can replace it. The wrapper crosses the
    // boundary using strings only; rendering never receives live guest objects.
    const wrapper = unwrap(vm.evalCode('(function(fn) { const parse = JSON.parse, stringify = JSON.stringify; return function(input) { return stringify(fn(parse(input))); }; })'));
    try {
      const guest = unwrap(vm.evalCode(`(function() { "use strict";\n${code}\n; if (typeof render !== "function") throw new Error("Define render(input)"); return render; })()`));
      try { render = unwrap(vm.callFunction(wrapper, vm.undefined, guest)); }
      finally { guest.dispose(); }
    } finally { wrapper.dispose(); }
  } catch (error) { vm.dispose(); runtime.dispose(); throw error; }
  return {
    draw(input) {
      deadline = performance.now() + limits.executionMs;
      const encoded = JSON.stringify(input);
      if (encoded.length > 8000) throw new Error('Visualization input is too large.');
      const arg = vm.newString(encoded); let result;
      try {
        result = unwrap(vm.callFunction(render, vm.undefined, arg));
        if (vm.typeof(result) !== 'string') throw new Error('render(input) must return a drawing.');
        const output = vm.getString(result);
        if (output.length > limits.output) throw new Error('The visualization output is too large.');
        return validateFrame(JSON.parse(output));
      } finally { result?.dispose(); arg.dispose(); }
    },
    dispose() { render.dispose(); vm.dispose(); runtime.dispose(); },
  };
}
