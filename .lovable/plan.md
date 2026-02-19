

# Fix: Custom Drawings Missing from PDF Export

## Root Cause

In `src/components/reports/WaterRiskReport.tsx` (line 576), the drawing lookup only uses the **static mapper**:

```typescript
const drawingUrl = getDrawingImage(location.id);
```

It never checks `location.drawingUrl` (the custom drawing uploaded by the user and stored in the database). So even though drawings load fine in the `LocationDetailsModal` (which does check `drawingUrl`), the PDF report ignores them entirely.

Additionally, custom drawings are now stored as **storage paths** (per the earlier fix), which require async signed URL resolution -- but `WaterRiskReport` is a synchronous React component that can't call `createSignedUrl` inline.

## Fix

### Step 1: Pre-resolve drawing URLs before rendering the report

In `src/components/wizard/WaterMitigationGuidelinesStep.tsx`, before rendering `WaterRiskReport`, iterate through `analysisItems` and resolve any storage-path `drawingUrl` values into signed URLs. Pass the resolved items to the report.

This happens in both `handleExportPDF` and `handleExportToProcore` -- extract a shared helper that:
1. Clones the `analysisItems` array
2. For each item with a `drawingUrl`, calls `resolveDrawingUrl` to get a signed URL
3. Passes the resolved items to `WaterRiskReport`

### Step 2: Update `WaterRiskReport` to use custom drawings

In `src/components/reports/WaterRiskReport.tsx` (line 576), update the drawing lookup to check `location.drawingUrl` first, then fall back to `getDrawingImage(location.id)`:

```typescript
const drawingUrl = location.drawingUrl || getDrawingImage(location.id);
```

Since the URLs are already pre-resolved to signed URLs in Step 1, this works synchronously.

## Files Changed

| File | Change |
|---|---|
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Add `resolveDrawingUrl` helper; pre-resolve `drawingUrl` on analysis items before rendering the report (in both PDF and Procore export flows) |
| `src/components/reports/WaterRiskReport.tsx` | Line 576: check `location.drawingUrl` before falling back to static mapper |
