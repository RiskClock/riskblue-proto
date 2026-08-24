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
  const TOTAL_PASSES = 120;
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


  // Refresh leader lengths from the final positions.
  for (const l of labels) {
    const ex = Math.max(l.x, Math.min(l.ax, l.x + l.w));
    const ey = Math.max(l.y, Math.min(l.ay, l.y + l.h));
    l.leader = Math.hypot(ex - l.ax, ey - l.ay);
  }
}


// ---- Public entry point ---------------------------------------------------


export function runPlacement(input: PlacementInput): PlacedLabel[] {
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
