
# Status: Plan Not Yet Implemented

The redesign plan was approved multiple times in conversation but the code changes were never actually written to `src/components/analysis/AnalysisSection.tsx`. The file is still at the original architecture (1,095 lines with `abortRef`, `analyzingClass`, `FileAnalysisRow`, per-card layout, risk badges, etc.).

This plan will implement everything agreed upon. One file changes. No DB migrations. No new packages.

---

## What Will Be Implemented

### 1. Stop Button Fix (AbortController)

**Current problem (line 557):** `const abortRef = useRef(false)` is checked only between files. During a 10–60 second `await fetch(...)`, no code runs — clicking Stop sets the flag but nothing happens until the request finishes on its own.

**Fix:** Per-class `AbortController` stored in a ref. `signal: controller.signal` is passed to both `fetch()` calls. Calling `controller.abort()` immediately cancels the in-flight HTTP request via the browser's `AbortError` mechanism.

### 2. State Architecture Changes

**Removed:**
- `analyzingClass: string | null` (line 558)
- `progress: { current, total }` (line 559)
- `fileStatuses: Record<string, string>` (line 560)
- `abortRef: useRef<boolean>` (line 557)
- `FileAnalysisRow` component (lines 107–164)
- `DETECTION_MESSAGES` constant (lines 52–93)
- `getDetectionMessages` function (lines 95–98)

**Added:**
```typescript
const [analyzingClasses, setAnalyzingClasses] = useState<Set<string>>(new Set());
const [classFileStatuses, setClassFileStatuses] = useState<Record<string, Record<string, string>>>({});
const abortControllers = useRef<Record<string, AbortController>>({});
const [rawResultModal, setRawResultModal] = useState<{
  fileName: string; awpClassName: string; resultText: string;
} | null>(null);
const idPrefixMap = useMemo(
  () => Object.fromEntries((awpClasses || []).map(c => [c.name, c.id_prefix])),
  [awpClasses]
);
```

### 3. Updated handleAnalyze / handleStop

`handleAnalyze` updated to:
- Create `new AbortController()` per class, store in `abortControllers.current[className]`
- Pass `signal: controller.signal` to both `fetch()` calls
- On `AbortError`: break loop silently, `finally` cleans up `analyzingClasses`
- Update `classFileStatuses[className][fileId]` per file as it processes

`handleStop(className: string)` replaces the current `handleStop()`:
```typescript
const handleStop = (className: string) => {
  abortControllers.current[className]?.abort();
};
```

`handleAnalyzeAll` added:
```typescript
const handleAnalyzeAll = () => {
  prompts?.forEach(p => handleAnalyze(p));
};
```

Auto-hydrate `useEffect` updated: `analyzingClass` dependency replaced with `analyzingClasses.size`.

### 4. New Component: RawResultModal

A `Dialog` that shows raw AI `result_text` for a `(file, class)` pair. Opened by clicking a count cell in the grid. Shows instance count + scrollable `<pre>` block with the raw text.

### 5. Drawing Analysis Grid (Replaces per-card layout)

A single horizontally-scrollable table. Rows = copied files. Columns = AWP classes.

**Layout:**
```
Drawing Analysis                              [▶ Analyze All]
──────────────────────────────────────────────────────────────
| File Name        | Size  | Status  | ERM  | EVP  | STE  |
|                  |       |         | [▶]  | [⏹]  | [↺]  |
| A2.01-LOWER...   | 481KB | Ready   |  3   |  ◌   |      |
| A2.02-GROUND...  | 517KB | Ready   |      |      |  1   |
```

- File Name column: `sticky left-0 bg-card z-10 min-w-[220px]`, `Tooltip` for full name
- AWP columns: `w-14 text-center`, header shows `idPrefixMap[className]`, `Tooltip` = full name
- Button sub-row per column: Play / Stop+Loader / Re-analyze based on state
- `countForCell(fileId, className)` helper returns: `null` (empty), `"loading"` (spinner), `"failed"` (⚠), or `n` (clickable number → opens `RawResultModal`)

**Analyze All button** in section header: fires all prompts in parallel. Disabled+spinner while `analyzingClasses.size > 0`.

### 6. Analysis Summary — Unified Single Card (Replaces per-card layout)

All AWP classes always shown in one card. Risk badges removed. Per-class states:

- `!summary && !isSummarizing` → "— Not yet analyzed" muted text
- `isSummarizing && !summary` → `Loader2` + "Summarizing…"
- `summary.length === 0` → "None identified"
- `summary.length > 0` → instance table (Display ID / Name / Floor / Area / Eye button)

"Add to Project" button only appears when `summary?.length > 0`.

`InstanceDetailModal` stays at the bottom, completely unchanged.

---

## File Change Summary

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Full rewrite per above — ~400 lines removed (old UI + old state), ~350 lines added (grid + unified summary + abort logic + RawResultModal) |

No other files. No DB changes. No new packages. `RotateCcw` added to lucide-react imports; `useMemo` added to React imports.
