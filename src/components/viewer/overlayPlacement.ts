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
}

export interface RectInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label?: string;
}

export interface PlacementInput {
  pageSize: { width: number; height: number };
  circles: CircleInput[];
  rects: RectInput[];
  fontPx: number;
  padX: number;
  labelH: number;
  gap: number;
  charPx: number;
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
}
interface Anchor {
  cx: number;
  cy: number;
}

// ---- Penalty constants ----------------------------------------------------

const OVERLAP_PENALTY = 100_000;
const CIRCLE_PENALTY = 100_000;
const RECT_PENALTY = 50_000;
const LEADER_CROSS_PENALTY = 80_000;
const LABEL_ON_LEADER_PENALTY = 90_000;

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
  bounds: { width: number; height: number },
): LabelCandidate {
  const cx = Math.max(2, Math.min(bounds.width - w - 2, lx));
  const cy = Math.max(2, Math.min(bounds.height - h - 2, ly));
  return { x: cx, y: cy, w, h, ax, ay, leader: 0 };
}

function generateCircleCandidates(
  c: CircleInfo,
  labelW: number,
  labelH: number,
  gap: number,
  bounds: { width: number; height: number },
): LabelCandidate[] {
  const directions = 24;
  const rings = 5;
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
  bounds: { width: number; height: number },
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

  const candBBox = bboxOfRect(cand);

  const labelHits = labelIdx.search(candBBox);
  for (const lh of labelHits) {
    if (lh.idx === selfIdx) continue;
    if (rectsOverlap(cand, positions[lh.idx])) cost += OVERLAP_PENALTY;
  }

  const circleHits = circleIdx.search(candBBox);
  for (const ch of circleHits) {
    if (ch.c.id === ownerId) continue;
    if (rectIntersectsCircle(cand, ch.c)) cost += CIRCLE_PENALTY;
  }

  const rectHits = rectIdx.search(candBBox);
  for (const rh of rectHits) {
    if (rectsOverlap(cand, rh.r)) cost += RECT_PENALTY;
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

    const maxIters = 20;
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

// ---- Public entry point ---------------------------------------------------

export function runPlacement(input: PlacementInput): PlacedLabel[] {
  const { pageSize, fontPx, padX, labelH, gap, charPx } = input;
  const labeledCircles = input.circles.filter((c) => !!c.label && !c.isDot);
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
  const widthFor = (text: string) => {
    const longest = text.split("\n").reduce((m, s) => Math.max(m, s.length), 0);
    return Math.ceil(longest * charPx) + padX * 2 + 4;
  };

  const rectFootprints: RectInfo[] = input.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const allCircles: CircleInfo[] = input.circles.map((c) => ({
    id: c.id, cx: c.cx, cy: c.cy, r: c.r, color: c.color, label: c.label,
  }));

  // ---- Pass 1: rect labels
  const rectItems = labeledRects.map((r) => ({
    id: r.id, color: r.color, text: r.label!,
    anchor: { cx: r.x, cy: r.y } as Anchor,
    width: widthFor(r.label!), height: heightFor(r.label!),
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

  // ---- Pass 2: circle labels
  const circleItems = labeledCircles.map((c) => ({
    id: c.id, color: c.color, text: c.label!,
    anchor: { cx: c.cx, cy: c.cy } as Anchor,
    width: widthFor(c.label!), height: heightFor(c.label!),
  }));
  const circleCands: LabelCandidate[][] = circleItems.map((it, i) =>
    generateCircleCandidates(
      { id: labeledCircles[i].id, cx: labeledCircles[i].cx, cy: labeledCircles[i].cy, r: labeledCircles[i].r, color: labeledCircles[i].color },
      it.width, it.height, gap, pageSize,
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
      ? optimizePlacements(circleCands, allCircles, rectObstaclesForCircles, circleAnchors, circleOwners, rand)
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
  return out;
}
