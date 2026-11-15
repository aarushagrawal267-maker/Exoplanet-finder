# Exoplanet Finder — web UI

React 18 + TypeScript (strict) + Vite, styled with Tailwind CSS 3.4 and the **Observatory Night**
design system. Talks to the FastAPI backend under `/api`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on <http://localhost:5173> (strict port). `/api` is proxied to `http://localhost:8000`; override with `VITE_API_URL`. When the backend is down the proxy answers `502 {code: "backend_unreachable"}`, which the UI reports as "the analysis server is not responding". |
| `npm run build` | Type-check, then production build to `dist/`. |
| `npm run preview` | Serve the production build on :4173 (same `/api` proxy). |
| `npm test` | Vitest unit/component tests (jsdom). |
| `npm run test:e2e` | Playwright smoke tests (desktop 1440×900 and mobile 390×844); starts the dev server if none is running. Set `PW_CHROMIUM_PATH` to use a specific Chromium. |
| `npm run lint` / `npm run typecheck` | `tsc --noEmit` for the app and for the Node-side configs. |
| `npm run gen:api` | Regenerate the typed API schema: dumps `create_app().openapi()` with the repository virtualenv's Python (`.venv/bin/python`, or `.venv\Scripts\python.exe` on Windows; override with `EXOFINDER_PYTHON`) — no server needed — to `src/api/openapi.json`, then runs `openapi-typescript` → `src/api/schema.d.ts`. Both files are committed; run it after any backend schema change and let the compiler point at the pages to update. |

Environment variables: `VITE_API_URL` (backend origin for the proxy and the "API docs" link),
`VITE_API_BASE` (API path, default `/api`), `VITE_API_DOCS_URL`.

## Layout

```
src/
  api/            fetch client (ApiError), useSSE hook, API types
    schema.d.ts   GENERATED OpenAPI types (npm run gen:api); schemas.ts gives them short names
    endpoints/    typed fetchers + TanStack Query hooks per API area (catalog, targets, lightcurves,
                  uploads, analysis, predictions, models, jobs, settings, docs, system, …)
  components/
    brand/        transit motif: mark, loader, orbit art, hero schematic, nav icon
    ui/           primitives (Button, Card, Readout, ProvenanceChip, ClassBadge, DataTable, …)
    charts/       Plotly (lazy, WebGL) light-curve charts + Recharts metric charts, shared theme
    science/      VerdictPanel, QualityReport, ProvenanceTable, LightCurveViewer, StarSignalPicker,
                  UploadFlow, EphemerisChooser, ModelPicker, Markdown + TeX (research docs)
    jobs/         JobProgress (SSE with polling fallback), DownloadLightCurve, ElapsedProgress
    layout/       AppShell, Sidebar, TopBar, CommandPalette, JobTray, navigation model
  pages/<Name>/   one directory per route (page + its tests); pages/_shared holds cross-page helpers
  demo/           SYNTHETIC data for the /design preview only
  lib/            formatters (format.ts), display binning, hooks
  styles/         tokens.ts (single source of truth), global CSS, self-hosted fonts
```

## Design system

Open **`/design`** to see every primitive and chart. Everything there uses clearly-labelled
synthetic demo data ("Demo data — for UI preview only"); no real page imports `src/demo`.

- **Tokens** live in `src/styles/tokens.ts` and feed both Tailwind (`tailwind.config.ts`) and the
  chart themes: `void` / `space` / `surface` / `surface-raised` / `hairline` backgrounds,
  `text-primary/secondary/muted` ink, `cosmic` (primary, focus), `nebula` (AI/model elements),
  `signal-planet` (class 1), `signal-fp` (class 0), `signal-uncertain`, `warn`, `danger`.
- **Type**: Inter Tight for UI, JetBrains Mono with tabular numerals for every number (`.num`),
  Instrument Serif italic for titles (`.font-display`), 11 px mono `.eyebrow` labels. Scale
  12/13/14/16/20/28/40 px (`text-xs … text-2xl`, plus `text-2xs`).
- **Contrast**: body text uses primary/secondary ink (≥ 6.8:1 on every surface). `text-muted`
  (≈ 3.1–3.8:1) is reserved for placeholders, decoration and disabled states; form-control borders
  use it so control boundaries meet the 3:1 non-text requirement.
- **Charts**: model comparison colours (`MODEL_PALETTE`) were validated for colour-vision
  deficiency on the surface colour and are always paired with a dash pattern and legend label;
  bar charts use the matching texture (`patternFill`: flat / hatched / dotted / ticked).
  Class colours are never reused for arbitrary series.
- **Honesty in the UI**: values carry a `ProvenanceChip` (catalogue / measured / estimate / model /
  manual); classes always show icon + text; every verdict shows "Research lead — not a confirmed
  discovery"; fixture-model output gets a dedicated banner.
- **Responsive**: the sidebar tightens on short viewports (`short:` = max-height 820 px) so all
  destinations fit at 1024×768; charts adapt to their *container* (model views stack below 560 px,
  the Plotly mode bar is hidden on touch screens).
- **Motion**: 150–250 ms ease-out, disabled under `prefers-reduced-motion`. The starfield/plate-grid
  atmosphere (`.atmosphere`) is only used on hero and empty states.

## Testing

- **Unit / component (Vitest + Testing Library)**: pages are rendered with `renderPage` and a
  route-table `fetch` mock (`src/test/api.tsx`); responses come from `src/test/fixtures.ts`, which
  is typed against the generated OpenAPI schema so fixtures cannot drift from the backend. Plotly
  is replaced by a stub in page tests (charts are exercised in Playwright).
- **End-to-end (Playwright)**: `e2e/smoke.spec.ts` (every route renders, shell behaviour),
  `e2e/science-pages.spec.ts` (science pages against a **real** backend; destructive actions are only
  opened and cancelled) and `e2e/detect-fixtures.spec.ts` (Planet Detection outcomes with the API
  intercepted by the test fixtures). Against a running stack:
  `E2E_BASE_URL=http://127.0.0.1:5175 npx playwright test`.

