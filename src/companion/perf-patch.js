/**
 * perf-patch.js — Node.js 22+ User Timing compatibility patch for Lighthouse.
 *
 * In Node 22+, performance.measure() throws a fatal SyntaxError DOMException
 * if a start or end mark is missing or cleared before measure() is called.
 * This patch intercepts missing marks, sets a fallback mark, and prevents crashes.
 */
import v8 from 'node:v8';
import vm from 'node:vm';

// global.gc() is normally undefined unless Node was started with --expose-gc, which nothing
// in this project's launch paths does — meaning the "null the LHR out, then call gc()"
// cleanup after each audit has always silently no-op'd (`typeof global.gc === 'function'`
// was always false), leaving V8 to reclaim a completed audit's 150MB+ raw trace/LHR data on
// its own schedule instead of promptly. v8.setFlagsFromString can expose gc() at runtime
// without needing that startup flag, so this makes the existing cleanup calls actually work.
let _gc = null;
export function forceGC() {
  if (_gc === null) {
    try {
      v8.setFlagsFromString('--expose_gc');
      _gc = vm.runInNewContext('gc');
      v8.setFlagsFromString('--no-expose_gc');
    } catch {
      _gc = () => {};
    }
  }
  try { _gc(); } catch {}
}

if (typeof globalThis.performance !== 'undefined' && typeof globalThis.performance.measure === 'function') {
  const origMeasure = globalThis.performance.measure.bind(globalThis.performance);
  globalThis.performance.measure = function (name, startMark, endMark) {
    try {
      return origMeasure(name, startMark, endMark);
    } catch (err) {
      if (err?.name === 'SyntaxError' || (typeof err?.message === 'string' && err.message.includes('performance mark has not been set'))) {
        try {
          if (typeof startMark === 'string') {
            globalThis.performance.mark(startMark);
          }
          if (typeof endMark === 'string') {
            globalThis.performance.mark(endMark);
          }
          return origMeasure(name, startMark, endMark);
        } catch {
          return null;
        }
      }
      throw err;
    }
  };
}
