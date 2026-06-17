## 1 — Badge colors + label format

**File:** `src/pages/WorkbenchProjectDetail.tsx` (per-page sub-row in second table)

Rebuild page-row badges so each badge matches its source plan's bounding-box color and uses the same label format level/unit plans use elsewhere:

- For each plan on the page render a single badge:
  - `label = floorPlanDisplayLabel(plan)` (reference_id → floors → plan_id)
  - background/border = `awpClassColor(plan.type)` (same color the bbox uses)
  - text color = `readableTextOn(color)`
- Drop the separate floor / reference_id badge tracks.
- Append a small secondary `{N} units` pill after each **level** plan badge when `referenced_unit_ids.length > 0` (clickable — see #3).

## 2 — Remove "Floors" section in the drawing-modal floor-plan card

**File:** `src/components/wizard/FileViewerModal.tsx` → `FloorPlansPanel`

Delete the `isLevel && (… Floors …)` block. Leave bbox label, type, Referenced-in (units) and Units (levels) sections intact.

## 3 — Units → count + edit modal

**Where:**
- `FloorPlansPanel` (drawing modal): replace the per-unit Badge list with `Badge: "{N} units"` + pencil button.
- `WorkbenchProjectDetail` page-row: the new `{N} units` pill after each level badge from #1.

Both buttons open a new `EditLevelUnitsModal` (added to `src/components/wizard/`):
- Props: `levelPlan`, `allUnitPlans`, current units, `onSave(units)`.
- UI: list of current unit refs with `X` remove + an "Add unit" combobox sourced from `allUnitPlans` filtered to those not already added.
- Persistence: reuses existing `onSaveFloorPlanOverride(planId, { floors, units })` writing to `floor_plan_overrides` JSONB on `analysis_request_sheets`.

The workbench page-row needs an `onEditLevelUnits(plan, page)` callback wired up; it already has `floorPlansByFile` and a `saveFloorPlanOverride` helper.

## 4 — Gemini explicit context cache + Identify Risk Elements

### 4a. Schema migration

Add two columns to `analysis_request_files`:
- `gemini_cache_id text`
- `gemini_cache_expires_at timestamptz`

No RLS changes — table already has policies.

### 4b. `supabase/functions/survey-pages/index.ts`

Switch to `npm:@google/genai`. After uploading the PDF to the Files API:

1. **Create a sterile, multi-purpose cache** — pass only the PDF blob. **Do not** put the survey prompt or any agent instructions inside the cache so downstream agents (Risk Elements, Kitchen, etc.) can reuse the same cache id without contamination.

   ```ts
   const cache = await ai.caches.create({
     model: 'gemini-3.5-flash',
     config: {
       displayName: `sheet-analysis-${fileId}`,
       contents: [{ role: 'user', parts: [{ fileData: { fileUri: uri, mimeType } }] }],
       ttl: '7200s',   // 2 hours
     },
   });
   ```

2. **Run the survey call** passing the survey system prompt at *execution* time via `config.systemInstruction`, and reference the sterile cache via `config.cachedContent`:

   ```ts
   await ai.models.generateContent({
     model: 'gemini-3.5-flash',
     contents: [{ role: 'user', parts: [{ text: 'Process this file layout structure.' }] }],
     config: {
       cachedContent: cache.name,
       systemInstruction: SURVEY_PAGES_PROMPT,
     },
   });
   ```

3. Persist `{ gemini_cache_id: cache.name, gemini_cache_expires_at: now + 2h }` on the `analysis_request_files` row alongside the existing `survey_raw_response` update.

If `caches.create` fails (Gemini requires the cached prefix to exceed its minimum token count for the model), fall back to a direct non-cached call and leave the cache columns null.

### 4c. New edge function `supabase/functions/identify-risk-elements/index.ts`

Input: `{ analysisRequestId, fileId, awpClassNames: string[] }` — the classes currently enabled in the workbench column toggles.

Per invocation:
1. Load file row → read `gemini_cache_id`, `gemini_cache_expires_at`.
2. If missing/expired, rebuild the sterile cache using the same helper as 4b (re-download PDF, re-upload to Files API, `caches.create` with only the PDF blob, update row).
3. Load `awp_class_prompts.prompt_text` for each requested class.
4. Fan out in parallel — one `ai.models.generateContent` per class, passing the class prompt as `config.systemInstruction` and the sterile cache id as `config.cachedContent`. User part is a short generic kicker like `"Identify all risk elements per the system instruction."`.
5. Persist raw text per class into `analysis_results` keyed by `(analysis_request_id, file_id, awp_class_name, kind='risk_elements')`.

Return `202 { started: true }` and use `EdgeRuntime.waitUntil` like survey-pages.

### 4d. Client wiring

`src/pages/WorkbenchProjectDetail.tsx`:
- Existing "Identify Risk Elements" button → loop uploaded files, invoke `identify-risk-elements` for each with the currently enabled `enabledCols` class list. Toast on dispatch; do not block UI.

## Technical notes

- `@google/genai` works in Deno via `npm:@google/genai`: `import { GoogleGenAI } from 'npm:@google/genai'; const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });`
- Model id stays `gemini-3.5-flash` everywhere — `caches.create` and `generateContent` must use the same model id.
- `gemini_cache_expires_at` is informational only; the SDK call relies on the cache name still being valid server-side.

## Out of scope (this turn)

- Where per-class risk-element results render in the UI — we just persist them. Confirm afterwards if you want a column/row treatment.