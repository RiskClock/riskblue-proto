// Web Worker wrapper around the pure `runPlacement` module. Vite bundles
// this via `new Worker(new URL(...), { type: "module" })` in the client.
//
// Protocol:
//   IN:  { requestId: number, input: PlacementInput }
//   OUT: { requestId: number, placed: PlacedLabel[] }
//        { requestId: number, error: string }
//
// The client sends the newest request only and ignores replies whose id is
// stale, so we don't need cancellation on the worker side.

import { runPlacement, type PlacementInput, type PlacedLabel } from "./overlayPlacement";

interface Req {
  requestId: number;
  input: PlacementInput;
}
interface OkRes {
  requestId: number;
  placed: PlacedLabel[];
}
interface ErrRes {
  requestId: number;
  error: string;
}

self.addEventListener("message", (ev: MessageEvent<Req>) => {
  const { requestId, input } = ev.data;
  try {
    const placed = runPlacement(input);
    const ok: OkRes = { requestId, placed };
    (self as unknown as Worker).postMessage(ok);
  } catch (e) {
    const err: ErrRes = {
      requestId,
      error: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(err);
  }
});

export {}; // ensure module scope
