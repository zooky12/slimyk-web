// ui/auto.js
// Legacy entry shim: forward to the WASM-backed auto creator.
// This keeps all auto features going through web/core/wasm-adapter.js
// (directly or via the ALD worker), avoiding the old JS prototype engine.

import { setupAutoLiteUI } from './auto-lite.js';

export function setupAutoUI(api) {
  return setupAutoLiteUI(api);
}

export default setupAutoUI;

