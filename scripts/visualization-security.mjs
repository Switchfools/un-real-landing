// Applied to the trusted, bundled worker only. The Studio page keeps its strict
// script-src 'self'; no browser eval or inline scripts are enabled anywhere.
export const visualizationWorkerCsp = "default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
