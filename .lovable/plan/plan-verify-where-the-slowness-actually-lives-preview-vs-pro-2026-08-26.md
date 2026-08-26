# Plan: Verify where the slowness actually lives (preview vs production)

## Answers to your questions (confirmed in code)

1. **Threat Report label placement** — the Threat Report uses the same **cluster-first radial placement** engine as the interactive drawing modal. The report mounts a real `DrawingViewer` offscreen (`threatReportPageCapture.ts`), lets the cluster/radial optimizer place labels, then rasterizes the placed DOM pixel-for-pixel. The only path still using the old legacy greedy placer is the vector-PDF overlay export (`overlayOnlyCapture.ts`, `syncPlacement: true`).

2. **"Test environment" slowness** — very likely yes. The preview URL (`id-preview--...lovable.app`) runs the Vite **dev server**: unminified modules, on-demand compilation, no bundling/preloading. The published site (`app.riskblue.com`) serves the optimized production build. Dev-mode first load is always dramatically slower, so measuring in preview overstates the problem your users would feel.

## What I confirmed

- Preview runs dev-mode Vite; published URL serves a minified production bundle (standard platform behavior).
- Recent optimizations (route-level code splitting, RPC-based project list, pagination) reduce production bundle size and round trips, but the dev server compiles routes on demand, which masks these gains in preview.

## Steps

1. **Measure both environments cold (incognito-equivalent)** with an automated browser:
   - Preview URL `/projects` and `/workbench`: time-to-content, request count, total transferred.
   - Published URL (`app.riskblue.com`) same routes: same metrics.
2. **Compare** the numbers and report which environment is actually slow.
3. **If production is also slow**, continue with the remaining optimization levers:
   - Preload hints for the LCP-critical chunks in `index.html`.
   - Further bundle trimming (heavy libs like `recharts`, `docx`, `pdfjs-dist` behind dynamic imports where still eagerly pulled).
   - React Query cache tuning so returning visits skip redundant header/profile/credits fetches.
4. **If only the preview is slow**, no code change is needed — the guidance is to judge performance on the published site, and optionally publish the current optimized build so production gets the improvements already merged.

## Expected result

- A clear, measured answer to "is the app actually slow for users, or is it just the test environment?"
- A concrete follow-up list only if production load times are genuinely poor.
