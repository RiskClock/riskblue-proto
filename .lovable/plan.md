

# Configuration Page: Controls Summary + Triaging Prompt Column + Use Triage Prompt in Triage

## Summary

Three changes: (1) collapse the controls column to show "X controls" summary + "Edit" button opening a modal, (2) add a new "Triaging Prompt" column with Google Drive link management (mirroring "Default Prompt"), (3) during triage in AnalysisSection, use the triaging prompt content instead of the default prompt content.

## Database Migration

Add triaging prompt columns to `awp_class_prompts`:

```sql
ALTER TABLE public.awp_class_prompts
  ADD COLUMN triage_drive_file_id text,
  ADD COLUMN triage_drive_file_name text,
  ADD COLUMN triage_drive_file_url text,
  ADD COLUMN triage_drive_file_modified_at timestamptz,
  ADD COLUMN triage_is_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN triage_prompt_content text,
  ADD COLUMN triage_content_updated_at timestamptz;
```

## Changes to `src/pages/Configuration.tsx`

### Controls column — "X controls" + Edit modal

- Replace the inline badge list in `AWPRow` with text: `"N controls"` (e.g. "5 controls", "0 controls")
- Add an "Edit" button next to the text
- New `ControlEditModal` component (Dialog): shows current controls as removable Badge pills (same X-button styling as current inline badges) + the `AddControlPopover` for adding new ones
- Modal has a close button; changes still tracked via existing `pendingChanges` mechanism

### New "Triaging Prompt" column

- Extend `PromptInfo` interface with `triage_*` fields
- Add state: `linkingTriagePrompt`, `triagePromptUrls`, `resolvingTriagePrompt`, `pullingTriageLatest`
- New `renderTriagePromptCell(awp)` — mirrors `renderPromptCell` but reads/writes `triage_drive_file_*` fields
- `handleLinkTriagePrompt` / `handlePullTriageLatest` — mirrors existing prompt link/pull logic but targets `triage_*` columns
- Table header: AWP Class | Default Mitigation Controls | Triaging Prompt | Default Prompt
- Category separator rows: `colSpan={4}`

## Changes to `src/components/analysis/AnalysisSection.tsx`

### Use triaging prompt during triage

Change prompt content resolution to prefer triage-specific content:

```typescript
promptContent: prompt.triage_prompt_content || prompt.prompt_content || null,
```

Ensure `triage_prompt_content` is included in the prompts query select.

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `triage_*` columns to `awp_class_prompts` |
| `src/pages/Configuration.tsx` | "N controls" summary + Edit modal; Triaging Prompt column with link/pull/change UI |
| `src/components/analysis/AnalysisSection.tsx` | Use `triage_prompt_content` over `prompt_content` during triage |

