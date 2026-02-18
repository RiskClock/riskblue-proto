
# OpenAI File ID Caching — Final Approved Plan

All adjustments from PRD v2 incorporated. Nothing is ambiguous or left to interpretation.

---

## Changes Overview

Two files change. No frontend files change. No other edge functions change.

| File | Type of change |
|---|---|
| `supabase/migrations/YYYYMMDD_openai_file_cache.sql` | Add 4 columns to `analysis_request_files` |
| `supabase/functions/analyze-drawings/index.ts` | Add `shouldReuseFile` helper; structured invalid-file detection; `expires_after` on upload; capture `expires_at`; remove cleanup DELETE |

---

## 1. Database Migration

Four nullable columns added to `analysis_request_files`. No existing rows are affected (all default to NULL = "no cache yet, upload fresh").

```sql
ALTER TABLE public.analysis_request_files
  ADD COLUMN openai_file_id          text,
  ADD COLUMN openai_file_uploaded_at timestamptz,
  ADD COLUMN openai_file_expires_at  timestamptz,
  ADD COLUMN openai_file_status      text;
```

Column semantics:

- `openai_file_id` — cached OpenAI file ID (e.g. `file-abc123`); NULL = no cache
- `openai_file_uploaded_at` — timestamp of last successful upload to OpenAI; local TTL anchor
- `openai_file_expires_at` — OpenAI's own expiry value (Unix seconds converted to timestamptz), stored when returned by the upload response; NULL if not provided
- `openai_file_status` — `'active'` or `'invalid'` only; expiry is computed on-the-fly, never written as a status value

---

## 2. Edge Function — `analyze-drawings/index.ts`

### Helper: `shouldReuseFile(fileRecord)`

Reuse the cached file ID only when ALL conditions pass (adj. 1 & 2 from PRD v2):

```
REUSE when:
  openai_file_id is not null
  AND openai_file_status != 'invalid'
  AND openai_file_uploaded_at > now() - interval '71 hours 45 minutes'
  AND (openai_file_expires_at IS NULL
       OR openai_file_expires_at > now() + interval '15 minutes')
```

A file is stale when `openai_file_uploaded_at <= now() - 71h45m`.
The 15-minute safety buffer also applies to `openai_file_expires_at` to prevent using a file that would expire mid-batch.

### Upload path (when not reusing)

```
1. Download from storage bucket (unchanged)
2. POST multipart to /v1/files:
     purpose = "assistants"            ← unchanged (adj. 5)
     expires_after[anchor] = "created_at"
     expires_after[seconds] = 259200   ← 3 days
3. Parse upload response:
     openaiFileId   = uploadResult.id
     openaiExpiresAt = uploadResult.expires_at  (Unix sec → ISO, may be null)
4. UPDATE analysis_request_files:
     openai_file_id          = openaiFileId
     openai_file_uploaded_at = now()
     openai_file_expires_at  = openaiExpiresAt (null if not in response)
     openai_file_status      = 'active'
```

### Responses API call

No change to the payload shape. The `input[0].content[0].file_id` field accepts both freshly-uploaded and previously-cached file IDs identically.

### Invalid-file error detection (adj. 3 from PRD v2)

Single unified predicate — no substring matching, no sole reliance on param string:

```typescript
const isFileInvalid =
  (httpStatus === 400 || httpStatus === 404) &&
  (
    parsedError?.error?.code === "file_not_found" ||
    parsedError?.error?.code === "invalid_value"  ||
    parsedError?.error?.param === "input[0].content[0].file_id"
  );
```

Behavior:

- **If `isFileInvalid`**: set `openai_file_status = 'invalid'` on the file row; set `analysis_results.status = 'failed'`, `error_message = 'Cached OpenAI file was rejected — re-analyze to re-upload'`
- **429 / 5xx / all other errors**: set `analysis_results.status = 'failed'` with raw error; leave `openai_file_status` unchanged (cache remains intact for retry)

### Cleanup block — removed

The `DELETE /v1/files/:id` call at the end of every run is removed.

Wording in code comments (adj. 4 from PRD v2):

> "We no longer delete OpenAI files after each run. We attempt to reuse cached file IDs until our local TTL or the OpenAI expires_at value indicates a re-upload is needed. OpenAI retention is not guaranteed by this code."

---

## No RLS Changes Needed

`analysis_request_files` already has an internal-user-only UPDATE policy. The edge function uses the service role key, which bypasses RLS entirely.
