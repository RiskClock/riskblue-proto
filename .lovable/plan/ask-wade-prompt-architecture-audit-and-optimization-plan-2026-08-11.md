# Ask Wade - prompt architecture audit and optimization plan

## Audit findings (verified in code)

### 1. Context and system prompt placement

- The threat report context is built **entirely on the client**, in `buildWadeContext` (`src/pages/WorkbenchProjectDetail.tsx:8210`). It reuses React state already loaded for the Threat Report modal: expanded detections, per-class/per-level counts, floor-plan/unit plan pages, spatial hierarchy, enabled classes and report spaces.
- `AskWadePanel` calls `buildContext()` on **every send** and puts the result in the request body alongside the full message list. The `ask-wade` edge function never fetches report data itself; it only validates the caller, checks project access, reads the configured model and prompt from `app_settings`, then forwards.
- There is **no system role**. The function assembles Gemini `contents` as: a synthetic first `user` turn containing `Instructions: <prompt>` plus `PROJECT CONTEXT JSON`, then a hardcoded `model` acknowledgement, then the conversation. Gemini's `systemInstruction` config field is not used.
- The context is **not re-attached to each user message**; it appears once, at the front of the request. But since it is re-sent from the client on each turn and rebuilt from live state, any grid edit between turns changes the prefix.

### 2. Prompt caching

Not configured anywhere. No `cachedContent`, no explicit `ai.caches.create`, no provider cache directives. Gemini implicit caching can only apply when the leading tokens are byte-identical between requests, which is not guaranteed today because the context is regenerated client-side each turn (key order is stable, but any annotation/level edit changes it).

### 3. Conversation history

No sliding window. `AskWadePanel` loads the entire persisted `wade_chat_messages` history for the project on mount and sends **all** turns on every request. History is per project, not per session, so it grows without bound across days and users. The edge function does no trimming either.

### 4. Payload size

Detections dominate: ~9 fields per row, roughly 25-35 tokens each as minified JSON.

- Median project (~370 annotations): ~12-15k tokens of context.
- Largest projects (1000+ annotations): ~30-40k tokens per request.
- System prompt itself is small (~250-350 tokens); hierarchy/plan pages add ~1-3k.
- Every follow-up question re-pays that full cost, plus the growing transcript.

## Proposed changes

1. **Move context assembly to the edge function.** Client sends only `projectId` and the question; the function loads detections, hierarchy and plan pages under the caller's RLS. This makes the prefix deterministic and server-controlled, and shrinks the request body.
2. **Use a real system instruction.** Put the Wade prompt in Gemini `config.systemInstruction` and keep the project context as the first cached user turn, removing the fake model acknowledgement.
3. **Enable caching.** Create an explicit Gemini cached content entry keyed by `projectId` + a content hash of the context (short TTL, e.g. 15 minutes), reused across turns and invalidated when the hash changes. Fall back to plain inline context when caching is unavailable for the configured model.
4. **Trim the context.** Send aggregates first (counts by class/level/page) and cap the raw detections array; when a project exceeds the cap, send per-level/per-class rollups plus detections for the levels referenced in the question rather than the whole set.
5. **Add a sliding window.** Keep the last ~10 turns in the request (full history still shown in the UI and stored in `wade_chat_messages`), so token growth is bounded.
6. **Report cost.** Log context token estimate and cache hit/miss per request so the effect is measurable in function logs.

## Technical scope

- `supabase/functions/ask-wade/index.ts` - context loading, system instruction, cached content, history window, logging.
- `src/components/workbench/AskWadePanel.tsx` - stop sending context, send last N turns only.
- `src/pages/WorkbenchProjectDetail.tsx` - remove/retire `buildWadeContext` and the `buildContext` prop.

No schema changes required.
