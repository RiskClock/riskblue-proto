// Singleton client for the overlay-placement Web Worker.
//
// Usage from React:
//
//   useEffect(() => {
//     const ticket = requestPlacement(input, (placed) => setPlaced(placed));
//     return () => ticket.cancel();
//   }, [inputDeps]);
//
// Cancellation is cheap: the client tags every request with a monotonically
// increasing id and drops any reply whose id doesn't match a live ticket.
// Callbacks fire only for the most recent uncancelled request from that
// ticket's perspective.
//
// Fallback: if `Worker` is unavailable (SSR, tests, very old browsers), we
// call `runPlacement` synchronously on the main thread so behavior is
// preserved. Callers can also bypass the worker entirely via `runPlacement`
// (used by the offscreen export capture path).

import { runPlacement, type PlacementInput, type PlacedLabel } from "./overlayPlacement";

interface PendingCallback {
  onDone: (placed: PlacedLabel[]) => void;
  onError?: (err: Error) => void;
  cancelled: boolean;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingCallback>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(
      new URL("./overlayPlacement.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.addEventListener("message", (ev: MessageEvent) => {
      const data = ev.data as
        | { requestId: number; placed: PlacedLabel[] }
        | { requestId: number; error: string };
      const cb = pending.get(data.requestId);
      if (!cb) return;
      pending.delete(data.requestId);
      if (cb.cancelled) return;
      if ("error" in data) {
        cb.onError?.(new Error(data.error));
      } else {
        cb.onDone(data.placed);
      }
    });
    worker.addEventListener("error", (ev) => {
      // Fail every pending request so callers can recover / show state.
      const err = new Error(ev.message || "overlayPlacement worker error");
      for (const [, cb] of pending) {
        if (cb.cancelled) continue;
        cb.onError?.(err);
      }
      pending.clear();
    });
    return worker;
  } catch (e) {
    // Some environments (older Safari, sandboxed iframes) will fail here.
    // Log once and fall through to the sync path.
    // eslint-disable-next-line no-console
    console.warn("[overlayPlacement] worker unavailable, using main thread", e);
    worker = null;
    return null;
  }
}

export interface PlacementTicket {
  cancel: () => void;
}

export function requestPlacement(
  input: PlacementInput,
  onDone: (placed: PlacedLabel[]) => void,
  onError?: (err: Error) => void,
): PlacementTicket {
  const w = getWorker();
  if (!w) {
    // Sync fallback — still deferred to a microtask so the caller can
    // register cancellation before we invoke the callback.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        onDone(runPlacement(input));
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    });
    return { cancel: () => { cancelled = true; } };
  }

  const requestId = nextRequestId++;
  const cb: PendingCallback = { onDone, onError, cancelled: false };
  pending.set(requestId, cb);
  w.postMessage({ requestId, input });
  return {
    cancel: () => {
      cb.cancelled = true;
      pending.delete(requestId);
    },
  };
}

// Re-exported for the sync export-capture path.
export { runPlacement };
export type { PlacementInput, PlacedLabel };
