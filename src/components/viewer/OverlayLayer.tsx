import { CSSProperties, PointerEvent as ReactPointerEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import RBush from "rbush";
import type { NormalizedOverlay } from "./viewerGeometry";
import { readableTextOn } from "@/lib/awpColor";


interface OverlayLayerProps {
  overlays: NormalizedOverlay[];
  /** Page CSS size at scale = 1 (the size the surface img is rendered at). */
  pageSize: { width: number; height: number };
  hoveredId?: string | null;
  /** Current viewport zoom scale. Labels divide by this to stay constant on-screen. */
  viewScale?: number;
  defaultColor?: string;
  /** When provided, clicking an overlay invokes this with its id. */
  onOverlayClick?: (id: string) => void;
  /**
   * When provided, dot overlays become draggable. Fires on pointer-up with
   * the new normalized (0..1) position. A pointer-up with no significant
   * movement still routes through onOverlayClick.
   */
  onOverlayDrag?: (id: string, nx: number, ny: number) => void;
  /**
   * Multiplier applied to circle diameters, label font/padding, leader
   * stroke width, and rect border widths. Used by the export capture path
   * to render chunkier overlays that read well in downloaded PDFs. Defaults
   * to 1 so the on-screen viewer is unaffected.
   */
  exportScale?: number;
  /**
   * When true, the label-placement optimizer runs synchronously during
   * render (via useMemo). Used by the offscreen export capture, which
   * rasterizes on the next rAF and can't wait for a deferred setState.
   * When false (default), placement runs asynchronously in a microtask so
   * mounting the viewer with many annotations doesn't block the main thread.
   */
  syncPlacement?: boolean;
  /**
   * Fired whenever the async placement pass starts (true) or finishes
   * (false). Consumers can use this to render a loading affordance on
   * side panels that let the user mutate annotations.
   */
  onPlacingChange?: (isPlacing: boolean) => void;
}

const MIN_CIRCLE_DIAMETER_CSS = 24;

// Label sizing in unscaled page CSS px. These scale naturally with the page
// transform, so markers/labels grow when zooming in and shrink when zooming out.
// Sizes are 30% smaller than the previous baseline (font 11 → 8, pad 6 → 4, h 18 → 13).
const LABEL_FONT_PX = 8;
const LABEL_PAD_X = 4;
const LABEL_H = 13;
const LABEL_GAP = 0;
const LABEL_OPACITY = 0.7;

function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("hsl(") && trimmed.endsWith(")")) {
    return trimmed.replace(/\)$/, ` / ${alpha})`);
  }
  if (trimmed.startsWith("rgb(") && trimmed.endsWith(")")) {
    return trimmed.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`);
  }
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const normalized =
      hex.length === 3
        ? hex.split("").map((c) => `${c}${c}`).join("")
        : hex.length === 6
          ? hex
          : null;
    if (normalized) {
      const value = Number.parseInt(normalized, 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return trimmed;
}

interface CircleInfo {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  label?: string;
  hovered: boolean;
  /** Dot variant: filled disc, no border, no label. */
  isDot?: boolean;
}

interface LabelCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number; // anchor x on target edge (for leader - circles only)
  ay: number; // anchor y on target edge
  leader: number; // base leader length (0 for rects → no leader)
}

interface PlacedLabel extends LabelCandidate {
  id: string;
  color: string;
  text: string;
  kind: "circle" | "rect";
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 1,
): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function rectIntersectsCircle(
  rect: { x: number; y: number; w: number; h: number },
  c: { cx: number; cy: number; r: number },
): boolean {
  const closestX = Math.max(rect.x, Math.min(c.cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(c.cy, rect.y + rect.h));
  const dx = c.cx - closestX;
  const dy = c.cy - closestY;
  return dx * dx + dy * dy < c.r * c.r;
}

/**
 * Generate candidate label positions around a circle: 24 directions × 4 rings.
 */
function generateCircleCandidates(
  c: CircleInfo,
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { width: number; height: number },
): LabelCandidate[] {
  const directions = 48;
  const rings = 10;
  const out: LabelCandidate[] = [];
  const fallback: LabelCandidate[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const dist = c.r + gap + ring * Math.max(6, labelH * 0.6);
    for (let i = 0; i < directions; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / directions;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const labelCx = c.cx + cos * dist;
      const labelCy = c.cy + sin * dist;
      let lx = labelCx - labelW / 2;
      let ly = labelCy - labelH / 2;
      lx = Math.max(2, Math.min(bounds.width - labelW - 2, lx));
      ly = Math.max(2, Math.min(bounds.height - labelH - 2, ly));
      const ax = c.cx + cos * c.r;
      const ay = c.cy + sin * c.r;
      const ex = Math.max(lx, Math.min(c.cx, lx + labelW));
      const ey = Math.max(ly, Math.min(c.cy, ly + labelH));
      const leader = Math.hypot(ex - ax, ey - ay);
      const cand = { x: lx, y: ly, w: labelW, h: labelH, ax, ay, leader };
      // Clamping to bounds can push the label back on top of its own anchor
      // circle (when the circle sits near a page edge). Drop those candidates
      // so the optimizer never chooses a position that overlaps its own dot.
      if (rectIntersectsCircle(cand, c)) {
        fallback.push(cand);
      } else {
        out.push(cand);
      }
    }
  }
  // If every position was rejected (very tight corner), fall back to the
  // least-bad clamped candidates rather than returning an empty list.
  return out.length > 0 ? out : fallback;
}


/**
 * Generate candidate positions around a rectangle (floor-plan bbox).
 * Positions: outside each edge (above/below/left/right) at 3 alignments
 * (start / center / end), plus 3 gap rings. No leader is drawn for rects.
 */
function generateRectCandidates(
  r: { x: number; y: number; w: number; h: number },
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { width: number; height: number },
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const rings = 3;
  const ax = r.x; // anchor unused for rects (leader=0)
  const ay = r.y;
  for (let ring = 0; ring < rings; ring++) {
    const off = gap + 2 + ring * 6;
    // Above the rect (preferred)
    for (const align of ["start", "center", "end"] as const) {
      const lx =
        align === "start"
          ? r.x
          : align === "center"
            ? r.x + r.w / 2 - labelW / 2
            : r.x + r.w - labelW;
      const ly = r.y - labelH - off;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Left of the rect (preferred)
    for (const align of ["start", "center", "end"] as const) {
      const lx = r.x - labelW - off;
      const ly =
        align === "start"
          ? r.y
          : align === "center"
            ? r.y + r.h / 2 - labelH / 2
            : r.y + r.h - labelH;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Right of the rect
    for (const align of ["start", "center", "end"] as const) {
      const lx = r.x + r.w + off;
      const ly =
        align === "start"
          ? r.y
          : align === "center"
            ? r.y + r.h / 2 - labelH / 2
            : r.y + r.h - labelH;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
    // Below the rect
    for (const align of ["start", "center", "end"] as const) {
      const lx =
        align === "start"
          ? r.x
          : align === "center"
            ? r.x + r.w / 2 - labelW / 2
            : r.x + r.w - labelW;
      const ly = r.y + r.h + off;
      out.push(clampCand(lx, ly, labelW, labelH, ax, ay, bounds));
    }
  }
  return out;
}

function clampCand(
  lx: number,
  ly: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bounds: { width: number; height: number },
): LabelCandidate {
  const cx = Math.max(2, Math.min(bounds.width - w - 2, lx));
  const cy = Math.max(2, Math.min(bounds.height - h - 2, ly));
  return { x: cx, y: cy, w, h, ax, ay, leader: 0 };
}

const OVERLAP_PENALTY = 100_000;
const CIRCLE_PENALTY = 100_000;
const RECT_PENALTY = 50_000;
const LEADER_CROSS_PENALTY = 80_000;
const LABEL_ON_LEADER_PENALTY = 90_000;

interface RectInfo {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anchor {
  cx: number;
  cy: number;
}

// --- geometry helpers for leader-line collision -----------------------------

function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

function rectIntersectsSegment(
  rect: { x: number; y: number; w: number; h: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): boolean {
  const inside = (p: { x: number; y: number }) =>
    p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  if (inside(p1) || inside(p2)) return true;
  const tl = { x: rect.x, y: rect.y };
  const tr = { x: rect.x + rect.w, y: rect.y };
  const bl = { x: rect.x, y: rect.y + rect.h };
  const br = { x: rect.x + rect.w, y: rect.y + rect.h };
  return (
    segmentsIntersect(p1, p2, tl, tr) ||
    segmentsIntersect(p1, p2, tr, br) ||
    segmentsIntersect(p1, p2, br, bl) ||
    segmentsIntersect(p1, p2, bl, tl)
  );
}

function leaderEndpoints(
  rect: LabelCandidate,
  anchor: Anchor,
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  return {
    a: { x: anchor.cx, y: anchor.cy },
    b: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
  };
}


// ---- Spatial indexing (rbush) ---------------------------------------------
//
// The naive optimizer was O(N²) per candidate because every cost lookup
// walked all N labels/circles/rects/leaders. With hundreds of annotations
// this dominates mount time. rbush gives us log-time bbox queries; we then
// run the precise geometric test only on returned candidates.

type BBoxEntry = { minX: number; minY: number; maxX: number; maxY: number };
type CircleEntry = BBoxEntry & { c: CircleInfo };
type RectEntry = BBoxEntry & { r: RectInfo };
type LabelEntry = BBoxEntry & { idx: number };
type LeaderEntry = BBoxEntry & { idx: number; ax: number; ay: number; bx: number; by: number };

function bboxOfRect(r: { x: number; y: number; w: number; h: number }): BBoxEntry {
  return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
}
function bboxOfCircle(c: CircleInfo): BBoxEntry {
  return { minX: c.cx - c.r, minY: c.cy - c.r, maxX: c.cx + c.r, maxY: c.cy + c.r };
}
function bboxOfSegment(ax: number, ay: number, bx: number, by: number): BBoxEntry {
  return {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  };
}

function candidateCost(
  cand: LabelCandidate,
  selfIdx: number,
  positions: LabelCandidate[],
  circleIdx: RBush<CircleEntry>,
  rectIdx: RBush<RectEntry>,
  labelIdx: RBush<LabelEntry>,
  leaderIdx: RBush<LeaderEntry>,
  anchors: Anchor[],
  ownerIds: (string | null)[],
): number {
  const self = anchors[selfIdx];
  const ownerId = ownerIds[selfIdx];
  const labelCx = cand.x + cand.w / 2;
  const labelCy = cand.y + cand.h / 2;
  const horizontalOffset = self ? Math.abs(labelCx - self.cx) : 0;
  // Bias: prefer above and left of the anchor.
  const dy = self ? labelCy - self.cy : 0;
  const dx = self ? labelCx - self.cx : 0;
  const belowPenalty = Math.max(0, dy) * 1.5;
  const rightPenalty = Math.max(0, dx) * 0.75;
  let cost = cand.leader + horizontalOffset * 0.5 + belowPenalty + rightPenalty;

  const candBBox = bboxOfRect(cand);

  // Label-label overlap
  const labelHits = labelIdx.search(candBBox);
  for (const lh of labelHits) {
    if (lh.idx === selfIdx) continue;
    if (rectsOverlap(cand, positions[lh.idx])) cost += OVERLAP_PENALTY;
  }

  // Label-circle overlap (skip owner circle)
  const circleHits = circleIdx.search(candBBox);
  for (const ch of circleHits) {
    if (ch.c.id === ownerId) continue;
    if (rectIntersectsCircle(cand, ch.c)) cost += CIRCLE_PENALTY;
  }

  // Label-rect overlap
  const rectHits = rectIdx.search(candBBox);
  for (const rh of rectHits) {
    if (rectsOverlap(cand, rh.r)) cost += RECT_PENALTY;
  }

  // Leader-line collision penalties (circle-owned labels only).
  if (self && ownerId) {
    // (a) label rect sitting across another annotation's leader
    const leaderHits = leaderIdx.search(candBBox);
    for (const lh of leaderHits) {
      if (lh.idx === selfIdx) continue;
      if (rectIntersectsSegment(cand, { x: lh.ax, y: lh.ay }, { x: lh.bx, y: lh.by })) {
        cost += LABEL_ON_LEADER_PENALTY;
      }
    }
    // (b) this candidate's own leader crossing another leader
    const myA = { x: self.cx, y: self.cy };
    const myB = { x: labelCx, y: labelCy };
    const myLeaderBBox = bboxOfSegment(myA.x, myA.y, myB.x, myB.y);
    const myLeaderHits = leaderIdx.search(myLeaderBBox);
    for (const lh of myLeaderHits) {
      if (lh.idx === selfIdx) continue;
      if (segmentsIntersect(myA, myB, { x: lh.ax, y: lh.ay }, { x: lh.bx, y: lh.by })) {
        cost += LEADER_CROSS_PENALTY;
      }
    }
  }
  return cost;
}

/** Small deterministic PRNG so the optimizer produces stable layouts. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLabelIdx(positions: LabelCandidate[]): RBush<LabelEntry> {
  const idx = new RBush<LabelEntry>();
  const items: LabelEntry[] = positions.map((p, i) => ({ ...bboxOfRect(p), idx: i }));
  idx.load(items);
  return idx;
}
function buildLeaderIdx(
  positions: LabelCandidate[],
  anchors: Anchor[],
  ownerIds: (string | null)[],
): RBush<LeaderEntry> {
  const idx = new RBush<LeaderEntry>();
  const items: LeaderEntry[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (!ownerIds[i]) continue; // rects have no leader
    const a = anchors[i];
    if (!a) continue;
    const p = positions[i];
    const bx = p.x + p.w / 2;
    const by = p.y + p.h / 2;
    items.push({ ...bboxOfSegment(a.cx, a.cy, bx, by), idx: i, ax: a.cx, ay: a.cy, bx, by });
  }
  idx.load(items);
  return idx;
}

function optimizePlacements(
  candidatesPerLabel: LabelCandidate[][],
  circles: CircleInfo[],
  rects: RectInfo[],
  anchors: Anchor[],
  ownerIds: (string | null)[],
  rand: () => number,
): LabelCandidate[] {
  // Static indexes (rebuilt once per run — circles and rects never move).
  const circleIdx = new RBush<CircleEntry>();
  circleIdx.load(circles.map((c) => ({ ...bboxOfCircle(c), c })));
  const rectIdx = new RBush<RectEntry>();
  rectIdx.load(rects.map((r) => ({ ...bboxOfRect(r), r })));

  const runOnce = (seed: LabelCandidate[]): { positions: LabelCandidate[]; totalCost: number } => {
    const positions = seed.slice();
    // Dynamic indexes — rebuilt after each full sweep, plus incrementally
    // updated when a label swaps position within a sweep.
    let labelIdx = buildLabelIdx(positions);
    let leaderIdx = buildLeaderIdx(positions, anchors, ownerIds);
    const labelEntries: LabelEntry[] = positions.map((p, i) => ({ ...bboxOfRect(p), idx: i }));
    const leaderEntries: (LeaderEntry | null)[] = positions.map((p, i) => {
      if (!ownerIds[i]) return null;
      const a = anchors[i];
      if (!a) return null;
      const bx = p.x + p.w / 2;
      const by = p.y + p.h / 2;
      return { ...bboxOfSegment(a.cx, a.cy, bx, by), idx: i, ax: a.cx, ay: a.cy, bx, by };
    });

    const maxIters = 20;
    for (let iter = 0; iter < maxIters; iter++) {
      let improved = false;
      const order = positions.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const i of order) {
        // Remove self from dynamic indexes so cand costs don't collide with
        // this label's own current placement.
        labelIdx.remove(labelEntries[i]);
        const oldLeader = leaderEntries[i];
        if (oldLeader) leaderIdx.remove(oldLeader);

        let bestCand = positions[i];
        let bestCost = candidateCost(bestCand, i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds);
        for (const cand of candidatesPerLabel[i]) {
          const cost = candidateCost(cand, i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds);
          if (cost < bestCost - 0.01) {
            bestCost = cost;
            bestCand = cand;
          }
        }
        if (bestCand !== positions[i]) {
          positions[i] = bestCand;
          improved = true;
        }

        // Re-insert with (possibly new) position.
        const newLabelEntry: LabelEntry = { ...bboxOfRect(positions[i]), idx: i };
        labelEntries[i] = newLabelEntry;
        labelIdx.insert(newLabelEntry);
        if (ownerIds[i] && anchors[i]) {
          const a = anchors[i];
          const p = positions[i];
          const bx = p.x + p.w / 2;
          const by = p.y + p.h / 2;
          const newLeader: LeaderEntry = { ...bboxOfSegment(a.cx, a.cy, bx, by), idx: i, ax: a.cx, ay: a.cy, bx, by };
          leaderEntries[i] = newLeader;
          leaderIdx.insert(newLeader);
        }
      }
      if (!improved) break;
      // Fully rebuild after each sweep to keep the tree balanced.
      labelIdx = buildLabelIdx(positions);
      leaderIdx = buildLeaderIdx(positions, anchors, ownerIds);
      for (let k = 0; k < positions.length; k++) {
        labelEntries[k] = { ...bboxOfRect(positions[k]), idx: k };
        if (ownerIds[k] && anchors[k]) {
          const a = anchors[k];
          const p = positions[k];
          const bx = p.x + p.w / 2;
          const by = p.y + p.h / 2;
          leaderEntries[k] = { ...bboxOfSegment(a.cx, a.cy, bx, by), idx: k, ax: a.cx, ay: a.cy, bx, by };
        } else {
          leaderEntries[k] = null;
        }
      }
    }

    let total = 0;
    for (let i = 0; i < positions.length; i++) {
      total += candidateCost(positions[i], i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds);
    }
    return { positions, totalCost: total };
  };

  const seedShort = candidatesPerLabel.map(
    (cands) => cands.reduce((best, c) => (c.leader < best.leader ? c : best), cands[0]),
  );
  let best = runOnce(seedShort);

  for (let r = 0; r < 3; r++) {
    const seed = candidatesPerLabel.map(
      (cands) => cands[Math.floor(rand() * cands.length)],
    );
    const attempt = runOnce(seed);
    if (attempt.totalCost < best.totalCost) best = attempt;
  }
  const positions = best.positions;

  // Final cleanup: nudge any label still overlapping a non-owner circle to
  // the shortest-leader alternative that doesn't overlap. Uses the static
  // circleIdx built above for O(log N + k) lookups.
  for (let i = 0; i < positions.length; i++) {
    const ownerId = ownerIds[i];
    const hits = (cand: LabelCandidate) => {
      const box = bboxOfRect(cand);
      const near = circleIdx.search(box);
      for (const ch of near) {
        if (ch.c.id === ownerId) continue;
        if (rectIntersectsCircle(cand, ch.c)) return true;
      }
      return false;
    };
    if (!hits(positions[i])) continue;
    let bestC: LabelCandidate | null = null;
    for (const cand of candidatesPerLabel[i]) {
      if (hits(cand)) continue;
      if (!bestC || cand.leader < bestC.leader) bestC = cand;
    }
    if (bestC) positions[i] = bestC;
  }
  return positions;
}




export const OverlayLayer = ({
  overlays,
  pageSize,
  hoveredId,
  viewScale = 1,
  defaultColor = "hsl(var(--destructive))",
  onOverlayClick,
  onOverlayDrag,
  exportScale = 1,
  syncPlacement = false,
  onPlacingChange,
}: OverlayLayerProps) => {
  const [drag, setDrag] = useState<null | {
    id: string;
    startClientX: number;
    startClientY: number;
    dx: number;
    dy: number;
    moved: boolean;
  }>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const onPlacingChangeRef = useRef(onPlacingChange);
  onPlacingChangeRef.current = onPlacingChange;

  const circles: CircleInfo[] = useMemo(() => {
    return overlays
      .filter((o) => (o.shape ?? "circle") !== "rect")
      .map((o) => {
        const color = o.color ?? defaultColor;
        const cx = (o.rect.nx + o.rect.nw / 2) * pageSize.width;
        const cy = (o.rect.ny + o.rect.nh / 2) * pageSize.height;
        const bboxSidePx = Math.max(
          o.rect.nw * pageSize.width,
          o.rect.nh * pageSize.height,
        );
        const isDot = o.variant === "dot";
        // Detection annotation circles are intentionally small (30% of the
        // previous size, then bumped 30% larger on request) so they don't
        // obscure the drawing. Unit-marker dots keep their original size.
        // `exportScale` bumps everything larger for downloaded PDFs.
        const baseDiameter = isDot
          ? Math.max(10, MIN_CIRCLE_DIAMETER_CSS * 0.55)
          : Math.max(MIN_CIRCLE_DIAMETER_CSS, bboxSidePx * 1.5) * 0.39;
        const diameter = baseDiameter * exportScale;

        return {
          id: o.id,
          cx,
          cy,
          r: diameter / 2,
          color,
          label: isDot ? undefined : o.label,
          // NOTE: `hovered` is intentionally not included here — recomputed
          // per-render in the JSX map so hover changes don't invalidate this
          // memo (which would rebuild every derived structure downstream).
          hovered: false,
          isDot,
        };
      });
  }, [overlays, pageSize.width, pageSize.height, defaultColor, exportScale]);

  const rects = useMemo(() => {
    return overlays
      .filter((o) => o.shape === "rect")
      .map((o) => ({
        id: o.id,
        x: o.rect.px?.x ?? o.rect.nx * pageSize.width,
        y: o.rect.px?.y ?? o.rect.ny * pageSize.height,
        w: Math.max(1, o.rect.px?.w ?? o.rect.nw * pageSize.width),
        h: Math.max(1, o.rect.px?.h ?? o.rect.nh * pageSize.height),
        color: o.color ?? defaultColor,
        label: o.label,
      }));
  }, [overlays, pageSize.width, pageSize.height, defaultColor]);


  const rectFootprints: RectInfo[] = useMemo(
    () => rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    [rects],
  );

  const fontPx = LABEL_FONT_PX * exportScale;
  const padX = LABEL_PAD_X * exportScale;
  const labelH = LABEL_H * exportScale;
  const gap = LABEL_GAP * exportScale;
  // Slightly generous per-character width so clamped labels near the page
  // edge don't visually spill past their computed rect.
  const charPx = fontPx * 0.72;

  // Layout keys omit hover/drag state so the placement optimizer doesn't
  // recompute (and reshuffle labels) on every hover or pan.
  const circleLayoutKey = useMemo(
    () =>
      circles
        .map((c) => `${c.id}:${Math.round(c.cx)}:${Math.round(c.cy)}:${Math.round(c.r)}:${c.label ?? ""}`)
        .join("|"),
    [circles],
  );
  const rectLayoutKey = useMemo(
    () =>
      rects
        .map((r) => `${r.id}:${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}:${Math.round(r.h)}:${r.label ?? ""}`)
        .join("|"),
    [rects],
  );


  // The label-placement optimizer is O(candidates * obstacles) and dominates
  // mount time for pages with dozens of annotations. Extract the whole pass
  // into a plain function so we can invoke it either synchronously (export
  // capture) or deferred to a microtask (interactive viewer) without
  // blocking paint.
  const runPlacement = (): PlacedLabel[] => {
    const labeledCircles = circles.filter((c) => !!c.label);
    const labeledRects = rects.filter((r) => !!r.label);
    if (labeledCircles.length === 0 && labeledRects.length === 0) return [];

    // Deterministic seed so identical inputs yield identical layouts (no
    // reshuffling as the user pans/zooms or hovers).
    const seedKey = [
      Math.round(pageSize.width),
      Math.round(pageSize.height),
      labeledCircles.length,
      labeledRects.length,
      ...labeledCircles.slice(0, 24).map((c) => `${c.id}:${Math.round(c.cx)}:${Math.round(c.cy)}`),
      ...labeledRects.slice(0, 24).map((r) => `${r.id}:${Math.round(r.x)}:${Math.round(r.y)}`),
    ].join("|");
    let h = 2166136261;
    for (let i = 0; i < seedKey.length; i++) {
      h ^= seedKey.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = mulberry32(h);

    // ---- Pass 1: place bbox (rect) labels first, treating them as fixed
    // obstacles for the circle-label pass.
    const lineH = Math.round(fontPx * 1.25);
    const heightFor = (text: string) => {
      const lines = text.split("\n").length;
      return lines <= 1 ? labelH : labelH + (lines - 1) * lineH;
    };
    const widthFor = (text: string) => {
      const longest = text.split("\n").reduce((m, s) => Math.max(m, s.length), 0);
      return Math.ceil(longest * charPx) + padX * 2 + 4;
    };

    const rectItems = labeledRects.map((r) => ({
      id: r.id,
      color: r.color,
      text: r.label!,
      anchor: { cx: r.x, cy: r.y } as Anchor,
      width: widthFor(r.label!),
      height: heightFor(r.label!),
    }));
    const rectCands: LabelCandidate[][] = rectItems.map((it, i) =>
      generateRectCandidates(labeledRects[i], it.width, it.height, gap, pageSize),
    );
    const rectAnchors = rectItems.map((it) => it.anchor);
    const rectOwners = rectItems.map(() => null as string | null);
    const rectPositions =
      rectItems.length > 0
        ? optimizePlacements(rectCands, [], rectFootprints, rectAnchors, rectOwners, rand)
        : [];

    // ---- Pass 2: place circle labels, with rect footprints AND the just-
    // placed rect labels as fixed obstacles.
    const circleItems = labeledCircles.map((c) => ({
      id: c.id,
      color: c.color,
      text: c.label!,
      anchor: { cx: c.cx, cy: c.cy } as Anchor,
      width: widthFor(c.label!),
      height: heightFor(c.label!),
    }));
    const circleCands: LabelCandidate[][] = circleItems.map((it, i) =>
      generateCircleCandidates(labeledCircles[i], it.width, it.height, gap, pageSize),
    );
    const circleAnchors = circleItems.map((it) => it.anchor);
    const circleOwners = circleItems.map((it) => it.id);
    const rectObstaclesForCircles: RectInfo[] = [
      ...rectFootprints,
      ...rectPositions.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ];
    const circlePositions =
      circleItems.length > 0
        ? optimizePlacements(circleCands, circles, rectObstaclesForCircles, circleAnchors, circleOwners, rand)
        : [];

    const out: PlacedLabel[] = [];
    for (let i = 0; i < circleItems.length; i++) {
      out.push({
        ...circlePositions[i],
        id: circleItems[i].id,
        color: circleItems[i].color,
        text: circleItems[i].text,
        kind: "circle",
      });
    }
    for (let i = 0; i < rectItems.length; i++) {
      out.push({
        ...rectPositions[i],
        id: rectItems[i].id,
        color: rectItems[i].color,
        text: rectItems[i].text,
        kind: "rect",
      });
    }
    return out;
  };

  // Synchronous branch — used by offscreen export capture, which rasterizes
  // on the next animation frame and can't wait for a deferred setState.
  const syncPlaced = useMemo(
    () => (syncPlacement ? runPlacement() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncPlacement, circleLayoutKey, rectLayoutKey, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx],
  );

  // Async branch — defers the heavy optimizer pass out of the render tick so
  // opening a viewer with many annotations doesn't block paint.
  const [asyncPlaced, setAsyncPlaced] = useState<PlacedLabel[]>([]);
  useEffect(() => {
    if (syncPlacement) return;
    const hasLabels =
      circles.some((c) => !!c.label) || rects.some((r) => !!r.label);
    if (!hasLabels) {
      setAsyncPlaced([]);
      onPlacingChangeRef.current?.(false);
      return;
    }
    onPlacingChangeRef.current?.(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      const result = runPlacement();
      setAsyncPlaced(result);
      onPlacingChangeRef.current?.(false);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPlacement, circleLayoutKey, rectLayoutKey, pageSize.width, pageSize.height, fontPx, padX, labelH, gap, charPx]);

  // On unmount, ensure the parent's "placing" flag doesn't stay stuck on.
  useEffect(() => {
    return () => {
      onPlacingChangeRef.current?.(false);
    };
  }, []);

  const placedLabels: PlacedLabel[] = syncPlacement ? (syncPlaced ?? []) : asyncPlaced;



  return (
    <div
      data-overlay-root
      className="pointer-events-none absolute inset-0"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      {/* Leader lines (SVG, behind circles). Rect labels get no leader. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={pageSize.width}
        height={pageSize.height}
        style={{ overflow: "visible" }}
      >
        {placedLabels.filter((p) => p.kind === "circle").map((p, idx) => {
          const labelCx = p.x + p.w / 2;
          const labelCy = p.y + p.h / 2;
          // Always resolve anchor from the live circle by id — never trust
          // p.ax/p.ay if the corresponding circle has moved since the layout
          // was memoized, and never draw a leader to a phantom (0,0) anchor
          // if the circle is missing (skip instead).
          const c = circles.find((c) => c.id === p.id);
          if (!c) return null;
          const ax = c.cx;
          const ay = c.cy;
          const dx = labelCx - ax;
          const dy = labelCy - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          // Start the leader on the circle's edge (radius offset toward label).
          const x1 = ax + ux * c.r;
          const y1 = ay + uy * c.r;
          // Terminate the leader at the label rectangle's edge (not its
          // center), so a label sitting close to its circle still shows a
          // visible connector rather than a stub buried under the label.
          const halfW = p.w / 2;
          const halfH = p.h / 2;
          const tX = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
          const tY = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
          const tEdge = Math.min(tX, tY);
          const x2 = labelCx - ux * tEdge;
          const y2 = labelCy - uy * tEdge;
          const leaderLen = Math.hypot(x2 - x1, y2 - y1);
          if (leaderLen < 0.5) return null;
          if (import.meta.env.DEV) {
            const off =
              x1 < -2 || y1 < -2 || x1 > pageSize.width + 2 || y1 > pageSize.height + 2;
            if (off) {
              // eslint-disable-next-line no-console
              console.warn("[OverlayLayer] leader anchor off-page", {
                id: p.id,
                text: p.text,
                circle: { cx: c.cx, cy: c.cy, r: c.r },
                pAxAy: { ax: p.ax, ay: p.ay },
                pageSize,
                x1, y1, x2, y2,
              });
            }
          }
          return (
            <line
              key={`leader-${p.id}-${idx}`}
              data-export-kind="leader"
              data-color={p.color}
              data-opacity={LABEL_OPACITY}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={p.color}
              strokeWidth={1.5 * exportScale}
              opacity={LABEL_OPACITY}
            />
          );
        })}
      </svg>

      {circles.map((c) => {
        const isDragging = drag?.id === c.id;
        return (
          <CircleOverlay
            key={c.id}
            c={c}
            hovered={hoveredId === c.id}
            exportScale={exportScale}
            clickable={!!onOverlayClick}
            draggable={!!onOverlayDrag}
            isDragging={isDragging}
            dragDx={isDragging ? drag!.dx : 0}
            dragDy={isDragging ? drag!.dy : 0}
            viewScale={viewScale}
            pageWidth={pageSize.width}
            pageHeight={pageSize.height}
            dragRef={dragRef}
            setDrag={setDrag}
            onOverlayClick={onOverlayClick}
            onOverlayDrag={onOverlayDrag}
          />
        );
      })}


      {/* Rectangle overlays - outline only. Labels are placed by the optimizer below. */}
      {rects.map((r) => (
        <RectOverlay
          key={r.id}
          r={r}
          hovered={hoveredId === r.id}
          exportScale={exportScale}
        />
      ))}



      {/* Labels (above circles & rects). Positions chosen by the optimizer. */}
      {placedLabels.map((p) => (
        <div
          key={`label-${p.id}`}
          data-export-kind="label"
          data-color={p.color}
          data-text-color={readableTextOn(p.color)}
          data-x={p.x}
          data-y={p.y}
          data-w={p.w}
          data-h={p.h}
          data-font-px={fontPx}
          data-opacity={LABEL_OPACITY}
          className="absolute font-bold pointer-events-none text-center"
          style={{
            left: p.x,
            top: p.y,
            width: p.w,
            height: p.h,
            lineHeight: `${Math.round(fontPx * 1.25)}px`,
            fontSize: fontPx,
            paddingLeft: padX,
            paddingRight: padX,
            paddingTop: Math.max(0, (p.h - Math.round(fontPx * 1.25) * p.text.split("\n").length) / 2),
            boxSizing: "border-box",
            borderRadius: 3,
            backgroundColor: p.color,
            color: readableTextOn(p.color),
            opacity: LABEL_OPACITY,
            whiteSpace: "pre",
          }}
        >
          {p.text}
        </div>
      ))}

    </div>
  );
};
