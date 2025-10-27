// Module worker that runs ALD calls off the main thread
import { initWasm } from '../core/wasm-adapter.js';

let api = null;
let ready = null;

async function ensureReady(baseUrl){
  if (api) return api;
  if (!ready){ ready = (async ()=> { api = await initWasm(baseUrl || '../wasm/'); return api; })(); }
  return ready;
}

self.onmessage = async (ev) => {
  const { id, cmd, args } = ev.data || {};
  try {
    if (cmd === 'init'){
      await ensureReady(args?.baseUrl);
      postMessage({ id, ok:true, result:true });
      return;
    }
    await ensureReady(args?.baseUrl);
    let res;
    switch (cmd){
      case 'aldNewContext': res = await api.aldNewContext(args[0]); break;
      case 'aldCloseContext': res = await api.aldCloseContext(args[0]); break;
      case 'aldInsertCandidate': res = await api.aldInsertCandidate(args[0], args[1], args[2]); break;
      case 'aldGetBucketsSummary': res = await api.aldGetBucketsSummary(args[0]); break;
      case 'aldSelectBaseCtx': res = await api.aldSelectBaseCtx(args[0], args[1], args[2]); break;
      case 'aldMutate': res = await api.aldMutate(args[0], args[1], args[2]); break;
      case 'solverAnalyze': res = await api.solverAnalyze(args[0], args[1]); break;
      default: throw new Error('unknown_cmd:'+cmd);
    }
    postMessage({ id, ok:true, result: res });
  } catch (e){
    postMessage({ id, ok:false, error: String(e?.message || e) });
  }
};
