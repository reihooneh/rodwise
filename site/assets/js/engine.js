// The page's side of the worker: one request at a time per call, answered by id.
let worker = null;
let next = 1;
const waiting = new Map();

function get() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const w = waiting.get(ev.data.id);
    if (!w) return;
    waiting.delete(ev.data.id);
    if (ev.data.ok) w.resolve(ev.data);
    else w.reject(new Error(ev.data.error));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'the model stopped'));
    waiting.clear();
  };
  return worker;
}

export function ask(op, data = {}) {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    get().postMessage({ id, op, ...data });
  });
}
