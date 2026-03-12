const AUTH_DEBUG_NS = 'WASEL_AUTH_DEBUG';

function normalizeError(error) {
  if (!error) return null;
  return {
    name: error.name || null,
    message: error.message || String(error),
    status: error.status || error.code || null,
    stack: error.stack || null,
  };
}

function pushDebugEvent(level, code, payload) {
  try {
    const event = {
      ts: new Date().toISOString(),
      level,
      code,
      payload,
    };
    const list = Array.isArray(window.__WASEL_AUTH_DEBUG) ? window.__WASEL_AUTH_DEBUG : [];
    list.push(event);
    window.__WASEL_AUTH_DEBUG = list.slice(-200);
  } catch {
    // noop
  }
}

export function authTrace(code, payload = {}) {
  pushDebugEvent('trace', code, payload);
  console.log(`[${AUTH_DEBUG_NS}][${code}]`, payload);
}

export function authWarn(code, payload = {}) {
  pushDebugEvent('warn', code, payload);
  console.warn(`[${AUTH_DEBUG_NS}][${code}]`, payload);
}

export function authError(code, error, payload = {}) {
  const normalized = normalizeError(error);
  const merged = { ...payload, error: normalized };
  pushDebugEvent('error', code, merged);
  console.error(`[${AUTH_DEBUG_NS}][${code}]`, merged);
}

export function exposeAuthDebugHelpers() {
  try {
    window.printWaselAuthDebug = () => {
      const list = Array.isArray(window.__WASEL_AUTH_DEBUG) ? window.__WASEL_AUTH_DEBUG : [];
      console.log(`[${AUTH_DEBUG_NS}][DUMP]`, list);
      return list;
    };
  } catch {
    // noop
  }
}
