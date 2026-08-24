// Pure label-placement module. No React, no DOM — safe to run in a Web
// Worker or on the main thread (export capture path).
//
// Exposes a single entry point: `runPlacement(input)` returning the placed
// labels for all circle/rect annotations on a page. The implementation uses
// rbush for O(log N + k) obstacle queries; see OverlayLayer.tsx history for
// the O(N²) baseline this replaced.

import RBush from "rbush";

// ---- Public types ---------------------------------------------------------

export interface CircleInput {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  label?: string;
  isDot?: boolean;
  /**
   * Optional true text width in px (Canvas measureText) for the label at the
   * MAX font size. When provided, overrides the `charPx * length` estimate so
   * the reservation matches the actual rendered pill — critical for wide
   * glyphs (@, M, W, digits) that the heuristic underestimates.
   */
  measuredWidthPx?: number;
}

export interface RectInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label?: string;
  measuredWidthPx?: number;
}

export interface PlacementInput {
  pageSize: { width: number; height: number };
  /** Optional page-space rectangle that every generated label must fit inside. */
  bounds?: { x: number; y: number; width: number; height: number };
  circles: CircleInput[];
  rects: RectInput[];
  fontPx: number;
  padX: number;
  labelH: number;
  gap: number;
  charPx: number;
  /**
   * Footprint scale of the labels relative to the on-screen baseline (the
   * export renders pills at 1.5x). Candidate ring distances are multiplied by
   * it so the escape room scales with the label size.
   */
  scale?: number;
  /**
   * Circle ids suppressed by the viewer's density LOD. They are skipped by
   * candidate generation / optimization entirely (and produce no placed
   * label), but remain obstacles so surviving labels avoid drawing over them.
   */
  lodHiddenIds?: string[];
  /** When provided, only these circle ids receive newly generated labels. */
  placementTargetIds?: string[];
  /** Existing viewer labels that must remain fixed and act as obstacles. */
  fixedLabels?: Array<{ x: number; y: number; w: number; h: number }>;
  /**
   * Viewer-only soft cap on leader length (page px). Beyond it the placement
   * cost grows quadratically so labels stay near their anchors instead of
   * being dragged into the crowded middle of the viewport. Exports leave it
   * undefined to keep the previous linear cost.
   */
  leaderSoftCap?: number;
  /**
   * Placement engine. `"legacy"` (default) is the randomized greedy optimizer
   * used by the export/capture paths. `"cluster"` is the viewer's
   * cluster-first radial allocator.
   */
  strategy?: "legacy" | "cluster";
  /** Cluster proximity threshold in page px (cluster strategy). */
  clusterProximity?: number;
  /** Previous frame's label rects, used as an anti-jitter seed. */
  previousLabels?: Array<{ id: string; x: number; y: number; w: number; h: number }>;

}



export interface LabelCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  leader: number;
}

export interface PlacedLabel extends LabelCandidate {
  id: string;
  color: string;
  text: string;
  kind: "circle" | "rect";
}

interface CircleInfo {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  label?: string;
}
interface RectInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  hard?: boolean;
}
interface Anchor {
  cx: number;
  cy: number;
}

// ---- Penalty constants ----------------------------------------------------

const OVERLAP_PENALTY = 1_000_000;
const CIRCLE_PENALTY = 100_000;
const RECT_PENALTY = 50_000;
const LEADER_CROSS_PENALTY = 80_000;
const LABEL_ON_LEADER_PENALTY = 900_000;

// ---- Geometry helpers -----------------------------------------------------

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

function clampCand(
  lx: number,
  ly: number,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bounds: { x: number; y: number; width: number; height: number },
): LabelCandidate {
  const minX = bounds.x + 2;
  const minY = bounds.y + 2;
  const maxX = Math.max(minX, bounds.x + bounds.width - w - 2);
  const maxY = Math.max(minY, bounds.y + bounds.height - h - 2);
  const cx = Math.max(minX, Math.min(maxX, lx));
  const cy = Math.max(minY, Math.min(maxY, ly));
  return { x: cx, y: cy, w, h, ax, ay, leader: 0 };
}

function generateCircleCandidates(
  c: CircleInfo,
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { x: number; y: number; width: number; height: number },
  ringScale = 1,
): LabelCandidate[] {
  const directions = 32;
  const out: LabelCandidate[] = [];
  const fallback: LabelCandidate[] = [];
  // Ring distances (page CSS px) added to the circle radius. They are scaled
  // by `ringScale` so the search space grows in step with the label
  // footprint — otherwise an export (labels 1.5x bigger on a larger page)
  // has proportionally far less room to escape than the on-screen viewer.
  const ringDistances = [20, 50, 100, 180].map((d) => d * ringScale);
  for (let ring = 0; ring < ringDistances.length; ring++) {
    const dist = c.r + gap + ringDistances[ring];

    for (let i = 0; i < directions; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / directions;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const labelCx = c.cx + cos * dist;
      const labelCy = c.cy + sin * dist;
      let lx = labelCx - labelW / 2;
      let ly = labelCy - labelH / 2;
      const minX = bounds.x + 2;
      const minY = bounds.y + 2;
      const maxX = Math.max(minX, bounds.x + bounds.width - labelW - 2);
      const maxY = Math.max(minY, bounds.y + bounds.height - labelH - 2);
      lx = Math.max(minX, Math.min(maxX, lx));
      ly = Math.max(minY, Math.min(maxY, ly));
      const ax = c.cx + cos * c.r;
      const ay = c.cy + sin * c.r;
      const ex = Math.max(lx, Math.min(c.cx, lx + labelW));
      const ey = Math.max(ly, Math.min(c.cy, ly + labelH));
      const leader = Math.hypot(ex - ax, ey - ay);
      const cand = { x: lx, y: ly, w: labelW, h: labelH, ax, ay, leader };
      if (rectIntersectsCircle(cand, c)) {
        fallback.push(cand);
      } else {
        out.push(cand);
      }
    }
  }
  return out.length > 0 ? out : fallback;
}

function generateRectCandidates(
  r: { x: number; y: number; w: number; h: number },
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { x: number; y: number; width: number; height: number },
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const rings = 3;
  const ax = r.x;
  const ay = r.y;
  for (let ring = 0; ring < rings; ring++) {
    const off = gap + 2 + ring * 6;
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

// ---- rbush entries --------------------------------------------------------

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

// ---- Cost + optimizer -----------------------------------------------------

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
  leaderSoftCap?: number,
): number {
  const self = anchors[selfIdx];
  const ownerId = ownerIds[selfIdx];
  const labelCx = cand.x + cand.w / 2;
  const labelCy = cand.y + cand.h / 2;
  const horizontalOffset = self ? Math.abs(labelCx - self.cx) : 0;
  const dy = self ? labelCy - self.cy : 0;
  const dx = self ? labelCx - self.cx : 0;
  const belowPenalty = Math.max(0, dy) * 1.5;
  const rightPenalty = Math.max(0, dx) * 0.75;
  let cost = cand.leader + horizontalOffset * 0.5 + belowPenalty + rightPenalty;
  // Soft quadratic cap on leader length (viewer only). Past the threshold the
  // cost grows fast, so a distant anchor prefers a nearer slot over dragging a
  // long line into the crowded middle of the viewport.
  if (leaderSoftCap && cand.leader > leaderSoftCap) {
    const over = (cand.leader - leaderSoftCap) / 40;
    cost += over * over * 1000;
  }


  // Safety buffer: inflate the candidate's footprint by 6px on every side
  // (12px total) when checking label-to-label overlaps. This forces the
  // optimizer to leave breathing room between neighbors.
  const SAFETY = 6;
  const inflated = {
    x: cand.x - SAFETY,
    y: cand.y - SAFETY,
    w: cand.w + SAFETY * 2,
    h: cand.h + SAFETY * 2,
  };
  const candBBox = bboxOfRect(inflated);

  const labelHits = labelIdx.search(candBBox);
  for (const lh of labelHits) {
    if (lh.idx === selfIdx) continue;
    if (rectsOverlap(inflated, positions[lh.idx])) cost += OVERLAP_PENALTY;
  }

  const circleHits = circleIdx.search(candBBox);
  for (const ch of circleHits) {
    if (ch.c.id === ownerId) continue;
    if (rectIntersectsCircle(cand, ch.c)) cost += CIRCLE_PENALTY;
  }

  const rectHits = rectIdx.search(candBBox);
  for (const rh of rectHits) {
    if (rectsOverlap(cand, rh.r)) {
      cost += rh.r.hard ? OVERLAP_PENALTY : RECT_PENALTY;
    }
  }

  if (self && ownerId) {
    const leaderHits = leaderIdx.search(candBBox);
    for (const lh of leaderHits) {
      if (lh.idx === selfIdx) continue;
      if (rectIntersectsSegment(cand, { x: lh.ax, y: lh.ay }, { x: lh.bx, y: lh.by })) {
        cost += LABEL_ON_LEADER_PENALTY;
      }
    }
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
    if (!ownerIds[i]) continue;
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
  leaderSoftCap?: number,
): LabelCandidate[] {
  const circleIdx = new RBush<CircleEntry>();
  circleIdx.load(circles.map((c) => ({ ...bboxOfCircle(c), c })));
  const rectIdx = new RBush<RectEntry>();
  rectIdx.load(rects.map((r) => ({ ...bboxOfRect(r), r })));

  const runOnce = (seed: LabelCandidate[]): { positions: LabelCandidate[]; totalCost: number } => {
    const positions = seed.slice();
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

    const N = positions.length;
    const maxIters = Math.min(6, N > 80 ? 4 : N > 40 ? 6 : N > 20 ? 6 : 6);
    for (let iter = 0; iter < maxIters; iter++) {
      let improved = false;
      const order = positions.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const i of order) {
        labelIdx.remove(labelEntries[i]);
        const oldLeader = leaderEntries[i];
        if (oldLeader) leaderIdx.remove(oldLeader);

        let bestCand = positions[i];
        let bestCost = candidateCost(bestCand, i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds, leaderSoftCap);
        for (const cand of candidatesPerLabel[i]) {
          const cost = candidateCost(cand, i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds, leaderSoftCap);
          if (cost < bestCost - 0.01) {
            bestCost = cost;
            bestCand = cand;
          }
        }
        if (bestCand !== positions[i]) {
          positions[i] = bestCand;
          improved = true;
        }

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
      total += candidateCost(positions[i], i, positions, circleIdx, rectIdx, labelIdx, leaderIdx, anchors, ownerIds, leaderSoftCap);
    }
    return { positions, totalCost: total };
  };

  const seedShort = candidatesPerLabel.map(
    (cands) => cands.reduce((best, c) => (c.leader < best.leader ? c : best), cands[0]),
  );
  const startedAt = Date.now();
  const timeBudgetMs = 1500;
  let best = runOnce(seedShort);

  const N = candidatesPerLabel.length;
  const extraSeeds = Math.max(2, N > 60 ? 2 : N > 30 ? 2 : 3);
  for (let r = 0; r < extraSeeds; r++) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    const seed = candidatesPerLabel.map(
      (cands) => cands[Math.floor(rand() * cands.length)],
    );
    const attempt = runOnce(seed);
    if (attempt.totalCost < best.totalCost) best = attempt;
  }
  const positions = best.positions;

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

// ---- Residual overlap separation -----------------------------------------

/**
 * Relaxation pass that nudges overlapping label pills apart along their axis
 * of least penetration. Rect (docked bbox) labels and any retained/fixed
 * labels from the viewer's pan cache are immovable; circle labels move and
 * their leader anchors stay attached to the circle. A final repair loop pushes
 * pills off foreign annotation dots.
 */
function separateResidualOverlaps(
  labels: PlacedLabel[],
  bounds: { x: number; y: number; width: number; height: number },
  opts?: {
    fixedLabels?: Array<{ x: number; y: number; w: number; h: number }>;
    circles?: CircleInfo[];
    pad?: number;
  },
): void {
  const pad = opts?.pad ?? 6;
  interface Box { x: number; y: number; w: number; h: number }
  const fixed: Box[] = (opts?.fixedLabels ?? []).map((r) => ({ ...r }));
  // Movable circle pills first, then the immovable set (rect labels + fixed).
  const boxes: Box[] = [...labels, ...fixed];
  const movable = [
    ...labels.map((l) => l.kind === "circle"),
    ...fixed.map(() => false),
  ];
  if (boxes.length < 2 && !(opts?.circles?.length)) return;

  const clamp = (l: Box) => {
    const minX = bounds.x + 2;
    const minY = bounds.y + 2;
    const maxX = Math.max(minX, bounds.x + bounds.width - l.w - 2);
    const maxY = Math.max(minY, bounds.y + bounds.height - l.h - 2);
    l.x = Math.max(minX, Math.min(maxX, l.x));
    l.y = Math.max(minY, Math.min(maxY, l.y));
  };

  const circles = opts?.circles ?? [];
  const circleIdx = new RBush<CircleEntry>();
  if (circles.length > 0) {
    circleIdx.load(circles.map((c) => ({ ...bboxOfCircle(c), c })));
  }

  // Push a pill off any foreign annotation dot it covers, along the axis from
  // the dot centre to the pill centre.
  const repairDots = (l: PlacedLabel, gap: number): boolean => {
    if (circles.length === 0) return false;
    let touched = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const box = { x: l.x - gap, y: l.y - gap, w: l.w + gap * 2, h: l.h + gap * 2 };
      const hits = circleIdx
        .search(bboxOfRect(box))
        .filter((ch) => ch.c.id !== l.id && rectIntersectsCircle(box, ch.c));
      if (hits.length === 0) break;
      const c = hits[0].c;
      let vx = l.x + l.w / 2 - c.cx;
      let vy = l.y + l.h / 2 - c.cy;
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      const half = Math.abs(vx) * (l.w / 2 + gap) + Math.abs(vy) * (l.h / 2 + gap);
      const need = c.r + half - len + 1;
      if (need <= 0) break;
      l.x += vx * need;
      l.y += vy * need;
      clamp(l);
      touched = true;
    }
    return touched;
  };

  // Interleaved relaxation. The padded phase aims for the breathing room the
  // optimizer reserves; the final unpadded phase guarantees a strictly
  // non-overlapping layout even when the dense case can't reach the padding.
  const PADDED_PASSES = 30;
  const TOTAL_PASSES = 60;
  for (let pass = 0; pass < TOTAL_PASSES; pass++) {
    const gap = pass < PADDED_PASSES ? pad : 0;
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!movable[i] && !movable[j]) continue;
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const bothMove = movable[i] && movable[j];
        const shareA = movable[i] ? (bothMove ? 0.5 : 1) : 0;
        const shareB = movable[j] ? (bothMove ? 0.5 : 1) : 0;
        const push = 1.02;
        if (ox <= oy) {
          const dir = a.x + a.w / 2 <= b.x + b.w / 2 ? -1 : 1;
          a.x += dir * ox * shareA * push;
          b.x -= dir * ox * shareB * push;
        } else {
          const dir = a.y + a.h / 2 <= b.y + b.h / 2 ? -1 : 1;
          a.y += dir * oy * shareA * push;
          b.y -= dir * oy * shareB * push;
        }
        if (movable[i]) clamp(a);
        if (movable[j]) clamp(b);
      }
    }
    // Dot repair runs inside the loop so a pill pushed onto a dot gets moved
    // off it, and the next label pass re-resolves any overlap that creates.
    for (const l of labels) {
      if (l.kind !== "circle") continue;
      if (repairDots(l, gap)) moved = true;
    }
    if (!moved) break;
  }

  // Last resort: a pill still overlapping after relaxation is stuck in a local
  // minimum (a cycle of mutual pushes). Relocate it with an outward spiral
  // search around its anchor, taking the nearest slot that is free of other
  // pills and of foreign dots.
  const overlapsAnything = (self: number, x: number, y: number): boolean => {
    const a = { x, y, w: boxes[self].w, h: boxes[self].h };
    for (let k = 0; k < boxes.length; k++) {
      if (k === self) continue;
      const b = boxes[k];
      if (
        Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
        Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)
      ) {
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l.kind !== "circle") continue;
    if (!overlapsAnything(i, l.x, l.y)) continue;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let ring = 1; ring <= 14 && !best; ring++) {
      const dist = ring * 18;
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const cx = l.ax + Math.cos(ang) * dist - l.w / 2;
        const cy = l.ay + Math.sin(ang) * dist - l.h / 2;
        const nx = Math.max(bounds.x + 2, Math.min(bounds.x + bounds.width - l.w - 2, cx));
        const ny = Math.max(bounds.y + 2, Math.min(bounds.y + bounds.height - l.h - 2, cy));
        if (overlapsAnything(i, nx, ny)) continue;
        const probe = { ...l, x: nx, y: ny } as PlacedLabel;
        if (circles.length > 0) {
          const box = { x: nx, y: ny, w: l.w, h: l.h };
          const onDot = circleIdx
            .search(bboxOfRect(box))
            .some((ch) => ch.c.id !== l.id && rectIntersectsCircle(box, ch.c));
          if (onDot) continue;
        }
        const d = Math.hypot(nx + l.w / 2 - l.ax, ny + l.h / 2 - l.ay);
        if (d < bestD) {
          bestD = d;
          best = { x: probe.x, y: probe.y };
        }
      }
      if (best) break;
    }
    if (best) {
      l.x = best.x;
      l.y = best.y;
    }
  }




  // Refresh leader lengths from the final positions.
  for (const l of labels) {
    const ex = Math.max(l.x, Math.min(l.ax, l.x + l.w));
    const ey = Math.max(l.y, Math.min(l.ay, l.y + l.h));
    l.leader = Math.hypot(ex - l.ax, ey - l.ay);
  }
}

// ---- Cluster-first radial layout (viewer strategy) ------------------------
//
// Proactive spatial allocation instead of randomized greedy relaxation:
//   1. anchors are grouped into proximity clusters (rbush),
//   2. clusters are processed largest-first,
//   3. members of a cluster fan out radially from the cluster centroid in
//      angular order, so leader lines never cross each other,
//   4. isolated anchors get the nearest free directional slot,
//   5. a label with no collision-free slot is suppressed (its dot is drawn
//      opaque by the viewer instead).

/** Cluster proximity in page px, used when the caller doesn't supply one. */
const CLUSTER_DEFAULT_PROXIMITY = 60;
/** Radial ring step as a multiple of the label height. */
const RADIAL_STEP_FACTOR = 1.15;
const RADIAL_MAX_STEPS = 16;
/** Angular wiggle (degrees) allowed around a member's own centroid ray. */
const RADIAL_ANGLE_OFFSETS_DEG = [0, 4, -4, 8, -8, 14, -14, 22, -22];
/** Minimum angular separation (degrees) between consecutive cluster members. */
const MIN_ANGULAR_GAP_DEG = 2;
const ISOLATED_RING_STEPS = 10;
const ISOLATED_DIRECTIONS_DEG = [0, -90, 180, 90, -45, 45, -135, 135];
/** Weight of the "distance moved from the previous frame" term. */
const INERTIA_WEIGHT = 0.6;
/** A previous position is only replaced when the new one is this much cheaper. */
const HYSTERESIS_RATIO = 0.25;
/** Breathing room reserved between label pills. */
const LABEL_SAFETY_PAD = 4;

export interface PlacementResult {
  placed: PlacedLabel[];
  /** Ids whose label had no collision-free slot and was dropped. */
  suppressedIds: string[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ClusterTarget {
  id: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  text: string;
  w: number;
  h: number;
}

function runClusterPlacement(input: PlacementInput): PlacementResult {
  const { pageSize, fontPx, padX, labelH, gap, charPx } = input;
  const bounds = input.bounds ?? { x: 0, y: 0, width: pageSize.width, height: pageSize.height };
  const proximity =
    input.clusterProximity && input.clusterProximity > 0
      ? input.clusterProximity
      : CLUSTER_DEFAULT_PROXIMITY;

  const placementTargets = input.placementTargetIds
    ? new Set(input.placementTargetIds)
    : null;
  const labeled = input.circles.filter(
    (c) => !!c.label && !c.isDot && (!placementTargets || placementTargets.has(c.id)),
  );
  if (labeled.length === 0) return { placed: [], suppressedIds: [] };

  const lineH = Math.round(fontPx * 1.25);
  const heightFor = (text: string) => {
    const lines = text.split("\n").length;
    return lines <= 1 ? labelH : labelH + (lines - 1) * lineH;
  };
  const widthFor = (text: string, measured?: number) => {
    if (typeof measured === "number" && measured > 0) {
      return Math.ceil(measured) + padX * 2 + 4;
    }
    const longest = text.split("\n").reduce((m, s) => Math.max(m, s.length), 0);
    return Math.ceil(longest * charPx) + padX * 2 + 4;
  };

  const targets: ClusterTarget[] = labeled.map((c) => ({
    id: c.id,
    cx: c.cx,
    cy: c.cy,
    r: c.r,
    color: c.color,
    text: c.label!,
    w: widthFor(c.label!, c.measuredWidthPx),
    h: heightFor(c.label!),
  }));

  // ---- Obstacle indexes
  const hardIdx = new RBush<RectEntry>();
  hardIdx.load([
    ...input.rects.map((r) => ({
      ...bboxOfRect(r),
      r: { x: r.x, y: r.y, w: r.w, h: r.h, hard: true } as RectInfo,
    })),
    ...(input.fixedLabels ?? []).map((r) => ({
      ...bboxOfRect(r),
      r: { x: r.x, y: r.y, w: r.w, h: r.h, hard: true } as RectInfo,
    })),
  ]);
  const circleIdx = new RBush<CircleEntry>();
  circleIdx.load(
    input.circles.map((c) => ({
      ...bboxOfCircle(c),
      c: { id: c.id, cx: c.cx, cy: c.cy, r: c.r, color: c.color, label: c.label },
    })),
  );

  const placedIdx = new RBush<BBoxEntry>();
  const leaderIdx = new RBush<LeaderEntry>();
  let leaderSeq = 0;

  const prev = new Map<string, Box>();
  for (const p of input.previousLabels ?? []) {
    prev.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h });
  }

  const fitsBounds = (b: Box) =>
    b.x >= bounds.x + 1 &&
    b.y >= bounds.y + 1 &&
    b.x + b.w <= bounds.x + bounds.width - 1 &&
    b.y + b.h <= bounds.y + bounds.height - 1;

  const hitsHardOrLabel = (b: Box) => {
    const pad = LABEL_SAFETY_PAD;
    const inflated = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    for (const e of placedIdx.search(bboxOfRect(inflated))) {
      const other = { x: e.minX, y: e.minY, w: e.maxX - e.minX, h: e.maxY - e.minY };
      if (rectsOverlap(inflated, other, 0)) return true;
    }
    for (const e of hardIdx.search(bboxOfRect(b))) {
      if (rectsOverlap(b, e.r, 0)) return true;
    }
    return false;
  };

  const hitsDot = (b: Box, ownerId: string) => {
    for (const e of circleIdx.search(bboxOfRect(b))) {
      if (e.c.id === ownerId) continue;
      if (rectIntersectsCircle(b, e.c)) return true;
    }
    return false;
  };

  const leaderCrosses = (ax: number, ay: number, bx: number, by: number) => {
    for (const e of leaderIdx.search(bboxOfSegment(ax, ay, bx, by))) {
      if (segmentsIntersect({ x: ax, y: ay }, { x: bx, y: by }, { x: e.ax, y: e.ay }, { x: e.bx, y: e.by })) {
        return true;
      }
    }
    return false;
  };

  const out: PlacedLabel[] = [];
  const suppressed: string[] = [];

  const commit = (t: ClusterTarget, b: Box) => {
    const dirX = b.x + b.w / 2 - t.cx;
    const dirY = b.y + b.h / 2 - t.cy;
    const len = Math.hypot(dirX, dirY) || 1;
    const ax = t.cx + (dirX / len) * t.r;
    const ay = t.cy + (dirY / len) * t.r;
    const ex = Math.max(b.x, Math.min(t.cx, b.x + b.w));
    const ey = Math.max(b.y, Math.min(t.cy, b.y + b.h));
    out.push({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      ax,
      ay,
      leader: Math.hypot(ex - ax, ey - ay),
      id: t.id,
      color: t.color,
      text: t.text,
      kind: "circle",
    });
    placedIdx.insert(bboxOfRect(b));
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    leaderIdx.insert({
      ...bboxOfSegment(t.cx, t.cy, bx, by),
      idx: leaderSeq++,
      ax: t.cx,
      ay: t.cy,
      bx,
      by,
    });
  };

  /**
   * Cost of a candidate box for a target: leader length plus an inertia term
   * pulling it toward the position it held in the previous frame.
   */
  const costOf = (t: ClusterTarget, b: Box) => {
    const ex = Math.max(b.x, Math.min(t.cx, b.x + b.w));
    const ey = Math.max(b.y, Math.min(t.cy, b.y + b.h));
    let cost = Math.hypot(ex - t.cx, ey - t.cy);
    const p = prev.get(t.id);
    if (p) {
      const moved = Math.hypot(b.x + b.w / 2 - (p.x + p.w / 2), b.y + b.h / 2 - (p.y + p.h / 2));
      cost += moved * INERTIA_WEIGHT;
    }
    return cost;
  };

  /** Tier 0 = clear of everything, tier 1 = only overlaps foreign dots. */
  const tierOf = (t: ClusterTarget, b: Box): 0 | 1 | -1 => {
    if (!fitsBounds(b)) return -1;
    if (hitsHardOrLabel(b)) return -1;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const crosses = leaderCrosses(t.cx, t.cy, bx, by);
    const onDot = hitsDot(b, t.id);
    if (crosses) return -1;
    return onDot ? 1 : 0;
  };

  // ---- Pass 0: retain still-valid previous positions (anti-jitter).
  const remaining: ClusterTarget[] = [];
  for (const t of targets) {
    const p = prev.get(t.id);
    if (!p || Math.abs(p.w - t.w) > 1 || Math.abs(p.h - t.h) > 1) {
      remaining.push(t);
      continue;
    }
    if (tierOf(t, p) === 0) {
      commit(t, p);
    } else {
      remaining.push(t);
    }
  }

  // ---- Cluster the remaining anchors (connected components within `proximity`).
  const anchorIdx = new RBush<BBoxEntry & { i: number }>();
  anchorIdx.load(
    remaining.map((t, i) => ({ minX: t.cx, minY: t.cy, maxX: t.cx, maxY: t.cy, i })),
  );
  const seen = new Array<boolean>(remaining.length).fill(false);
  const clusters: ClusterTarget[][] = [];
  for (let i = 0; i < remaining.length; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    const queue = [i];
    const members: ClusterTarget[] = [];
    while (queue.length > 0) {
      const k = queue.pop()!;
      const t = remaining[k];
      members.push(t);
      const near = anchorIdx.search({
        minX: t.cx - proximity,
        minY: t.cy - proximity,
        maxX: t.cx + proximity,
        maxY: t.cy + proximity,
      });
      for (const n of near) {
        if (seen[n.i]) continue;
        seen[n.i] = true;
        queue.push(n.i);
      }
    }
    clusters.push(members);
  }
  // A single huge blob would push every label onto one enormous ring, most of
  // which falls outside the viewport. Split oversized clusters along their
  // longer axis (median) until each fan stays local.
  const splitOversized = (members: ClusterTarget[]): ClusterTarget[][] => {
    if (members.length <= MAX_CLUSTER_SIZE) return [members];
    const xs = members.map((m) => m.cx);
    const ys = members.map((m) => m.cy);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const sorted = members
      .slice()
      .sort((a, b) => (spanX >= spanY ? a.cx - b.cx : a.cy - b.cy));
    const mid = Math.floor(sorted.length / 2);
    return [
      ...splitOversized(sorted.slice(0, mid)),
      ...splitOversized(sorted.slice(mid)),
    ];
  };
  const splitClusters = clusters.flatMap(splitOversized);
  clusters.length = 0;
  clusters.push(...splitClusters);
  clusters.sort((a, b) => b.length - a.length);


  const boxAt = (t: ClusterTarget, cx: number, cy: number): Box => ({
    x: cx - t.w / 2,
    y: cy - t.h / 2,
    w: t.w,
    h: t.h,
  });

  /**
   * Pick the cheapest acceptable candidate, preferring tier 0. Scans ring by
   * ring and stops at the first ring that yields anything, so labels stay as
   * close to their anchor as the free space allows.
   */
  const chooseByRings = (
    t: ClusterTarget,
    ringCandidates: () => Generator<Box[], void, unknown>,
  ): Box | null => {
    let fallback: { b: Box; cost: number } | null = null;
    for (const ring of ringCandidates()) {
      let best: { b: Box; cost: number } | null = null;
      for (const b of ring) {
        const tier = tierOf(t, b);
        if (tier === -1) continue;
        const cost = costOf(t, b);
        if (tier === 0) {
          if (!best || cost < best.cost) best = { b, cost };
        } else if (!fallback || cost < fallback.cost) {
          fallback = { b, cost };
        }
      }
      if (best) return best.b;
    }
    return fallback ? fallback.b : null;
  };

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  for (const members of clusters) {
    if (members.length === 1) {
      const t = members[0];
      const step = Math.max(6, t.h * RADIAL_STEP_FACTOR);
      const chosen = chooseByRings(t, function* () {
        for (let k = 1; k <= ISOLATED_RING_STEPS; k++) {
          const dist = t.r + gap + step * k;
          const ring: Box[] = [];
          for (const degrees of ISOLATED_DIRECTIONS_DEG) {
            const a = toRad(degrees);
            ring.push(boxAt(t, t.cx + Math.cos(a) * dist, t.cy + Math.sin(a) * dist));
          }
          yield ring;
        }
      });
      if (chosen) commit(t, chosen);
      else suppressed.push(t.id);
      continue;
    }

    // Cluster centroid + radius.
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      sx += m.cx;
      sy += m.cy;
    }
    const ccx = sx / members.length;
    const ccy = sy / members.length;
    let radius = 0;
    for (const m of members) {
      radius = Math.max(radius, Math.hypot(m.cx - ccx, m.cy - ccy) + m.r);
    }

    // Angular order around the centroid keeps leader lines from crossing.
    const withAngle = members
      .map((t) => ({ t, angle: Math.atan2(t.cy - ccy, t.cx - ccx) }))
      .sort((a, b) => a.angle - b.angle);

    const minGap = toRad(MIN_ANGULAR_GAP_DEG);
    let lastAngle = -Infinity;
    for (let i = 0; i < withAngle.length; i++) {
      const { t, angle } = withAngle[i];
      const nextRaw = i + 1 < withAngle.length ? withAngle[i + 1].angle : Infinity;
      const lowerBound = lastAngle === -Infinity ? -Infinity : lastAngle + minGap;
      const angles = RADIAL_ANGLE_OFFSETS_DEG.map((d) => angle + toRad(d)).filter(
        (a) => a >= lowerBound && (nextRaw === Infinity || a <= nextRaw + minGap),
      );
      if (angles.length === 0) angles.push(Math.max(angle, lowerBound === -Infinity ? angle : lowerBound));

      const step = Math.max(6, t.h * RADIAL_STEP_FACTOR);
      const baseDist = Math.max(radius + gap, Math.hypot(t.cx - ccx, t.cy - ccy) + t.r + gap);
      let usedAngle: number | null = null;
      const chosen = chooseByRings(t, function* () {
        for (let k = 0; k <= RADIAL_MAX_STEPS; k++) {
          const dist = baseDist + step * (k + 0.6);
          const ring: Box[] = [];
          for (const a of angles) {
            ring.push(boxAt(t, ccx + Math.cos(a) * dist, ccy + Math.sin(a) * dist));
          }
          yield ring;
        }
      });
      if (chosen) {
        commit(t, chosen);
        usedAngle = Math.atan2(chosen.y + chosen.h / 2 - ccy, chosen.x + chosen.w / 2 - ccx);
      } else {
        suppressed.push(t.id);
      }
      if (usedAngle !== null) lastAngle = Math.max(usedAngle, angle);
    }
  }

  return { placed: out, suppressedIds: suppressed };
}


// ---- Public entry point ---------------------------------------------------


/** Detailed entry point: adds the suppressed-id list the viewer needs. */
export function runPlacementDetailed(input: PlacementInput): PlacementResult {
  if (input.strategy === "cluster") return runClusterPlacement(input);
  return { placed: runLegacyPlacement(input), suppressedIds: [] };
}

export function runPlacement(input: PlacementInput): PlacedLabel[] {
  return runPlacementDetailed(input).placed;
}

function runLegacyPlacement(input: PlacementInput): PlacedLabel[] {

  const { pageSize, fontPx, padX, labelH, gap, charPx } = input;
  const bounds = input.bounds ?? { x: 0, y: 0, width: pageSize.width, height: pageSize.height };
  const ringScale = Math.max(1, input.scale ?? 1);

  const lodHidden = new Set(input.lodHiddenIds ?? []);
  const placementTargets = input.placementTargetIds
    ? new Set(input.placementTargetIds)
    : null;
  const labeledCircles = input.circles.filter(
    (c) =>
      !!c.label &&
      !c.isDot &&
      !lodHidden.has(c.id) &&
      (!placementTargets || placementTargets.has(c.id)),
  );

  const labeledRects = input.rects.filter((r) => !!r.label);
  if (labeledCircles.length === 0 && labeledRects.length === 0) return [];

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

  const lineH = Math.round(fontPx * 1.25);
  const heightFor = (text: string) => {
    const lines = text.split("\n").length;
    return lines <= 1 ? labelH : labelH + (lines - 1) * lineH;
  };
  const widthFor = (text: string, measured?: number) => {
    if (typeof measured === "number" && measured > 0) {
      return Math.ceil(measured) + padX * 2 + 4;
    }
    const longest = text.split("\n").reduce((m, s) => Math.max(m, s.length), 0);
    return Math.ceil(longest * charPx) + padX * 2 + 4;
  };

  const rectFootprints: RectInfo[] = [
    ...input.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    ...(input.fixedLabels ?? []).map((r) => ({ ...r, hard: true })),
  ];
  const allCircles: CircleInfo[] = input.circles.map((c) => ({
    id: c.id, cx: c.cx, cy: c.cy, r: c.r, color: c.color, label: c.label,
  }));

  // ---- Pass 1: rect labels
  const rectItems = labeledRects.map((r) => ({
    id: r.id, color: r.color, text: r.label!,
    anchor: { cx: r.x, cy: r.y } as Anchor,
    width: widthFor(r.label!, r.measuredWidthPx), height: heightFor(r.label!),
  }));
  const rectCands: LabelCandidate[][] = rectItems.map((it, i) =>
    generateRectCandidates(labeledRects[i], it.width, it.height, gap, bounds),
  );
  const rectAnchors = rectItems.map((it) => it.anchor);
  const rectOwners = rectItems.map(() => null as string | null);
  const rectPositions =
    rectItems.length > 0
      ? optimizePlacements(rectCands, [], rectFootprints, rectAnchors, rectOwners, rand)
      : [];

  // ---- Pass 2: circle labels
  const circleItems = labeledCircles.map((c) => ({
    id: c.id, color: c.color, text: c.label!,
    anchor: { cx: c.cx, cy: c.cy } as Anchor,
    width: widthFor(c.label!, c.measuredWidthPx), height: heightFor(c.label!),
  }));
  const circleCands: LabelCandidate[][] = circleItems.map((it, i) =>
    generateCircleCandidates(
      { id: labeledCircles[i].id, cx: labeledCircles[i].cx, cy: labeledCircles[i].cy, r: labeledCircles[i].r, color: labeledCircles[i].color },
      it.width, it.height, gap, bounds, ringScale,
    ),
  );

  const circleAnchors = circleItems.map((it) => it.anchor);
  const circleOwners = circleItems.map((it) => it.id);
  const rectObstaclesForCircles: RectInfo[] = [
    ...rectFootprints,
    ...rectPositions.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
  ];
  const circlePositions =
    circleItems.length > 0
      ? optimizePlacements(circleCands, allCircles, rectObstaclesForCircles, circleAnchors, circleOwners, rand, input.leaderSoftCap)
      : [];

  const out: PlacedLabel[] = [];
  for (let i = 0; i < circleItems.length; i++) {
    out.push({
      ...circlePositions[i],
      id: circleItems[i].id, color: circleItems[i].color,
      text: circleItems[i].text, kind: "circle",
    });
  }
  for (let i = 0; i < rectItems.length; i++) {
    out.push({
      ...rectPositions[i],
      id: rectItems[i].id, color: rectItems[i].color,
      text: rectItems[i].text, kind: "rect",
    });
  }
  // Final safety pass: the optimizer can settle for an overlapping placement
  // when a dense cluster exhausts its candidates. Push circle labels apart so
  // no pill ever covers another (docked rect labels stay fixed).
  separateResidualOverlaps(out, bounds, {
    fixedLabels: input.fixedLabels,
    circles: allCircles,
  });

  return out;
}
