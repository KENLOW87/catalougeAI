# GEOMETRA Catalogue AI — Handoff State

Last saved: 25 September 2026

`README.md` and `FLOWS.md` were behind this file by one session and have been
brought level: the dashboard and where each export button lives, whole-category
deletion, category routing, the assistant's upload button, the 300 MB limit, and the
`localStorage` line that contradicted the IndexedDB move. The docs and the code now
agree — each statement below was checked against the source, not copied forward.

This file is the current handoff record for continuing development in another agent
such as Claude. Read this file first, then `README.md` and `FLOWS.md`. Do not remove
or redesign existing behaviour unless the client explicitly asks.

**Building the system that will CONTAIN this one?** Read `INTEGRATION.md` instead —
it states the interface, the three things that will bite (browser-only storage, the
exporter loading the editor's own URL, no authentication), the mounting options and
what is still unfinished.

## Current system

The project is in:

`C:\Users\admin\Desktop\RAIHANA - INTERN WORK\CATALOUGE_AI`

The app is under `app/` and runs as:

```powershell
cd "C:\Users\admin\Desktop\RAIHANA - INTERN WORK\CATALOUGE_AI\app"
npm start
```

- Editor: `http://localhost:5173`
- Extraction/export server: `http://localhost:5174`
- Normal known-layout extraction does not need an Anthropic key.
- The AI fallback needs `ANTHROPIC_API_KEY` only for unknown product layouts.

## Implemented features

- Accessories ~ LED template, including standard and featured product structures.
- PVC Marble template with its page split, exception row, and finish variants.
- Default template for the other catalogue families.
- Dashboard with product totals, catalogue counts, page counts, and quality findings.
- Sidebar hidden by default; category controls appear when opening a catalogue.
- Single-category `Download PDF` remains in the editor.
- Combined `Download all as PDF` is on the dashboard only.
- PDF upload and individual image upload.
- Local OCR/rule extraction first; AI fallback only when needed.
- Category routing from page headers and product names/codes.
- Review screen before any import is saved.
- Reconciliation keeps PDF order and inserts missing products in the correct position.
- Names remain exactly as printed in the source catalogue.
- Product numbering is positional and automatically closes gaps.
- Whole non-product pages are preserved as full-page images.
- Assistant panel has an `Upload PDF/image` button.
- Existing products can still be edited, reordered, and individually deleted.
- Whole-category deletion removes the catalogue from the dashboard, category tabs, and
  combined PDF list. The built-in layout definition remains in source for future use.
- IndexedDB is the persistent browser store. Do not reintroduce localStorage for
  product data because catalogue images exceed the browser's localStorage limit.

## Client rules that must remain

- Uploads are the main workflow; do not bring back manual `Add product` or `Add
  featured` as the normal workflow.
- LED standard products use the normal grid; featured products use the multi-finish
  block structure.
- Product names/codes follow the catalogue exactly.
- Black is the default finish when the catalogue does not state another default.
- Bil numbers are assigned by final order, never copied from printed position badges.
- Re-importing must reconcile rather than duplicate.
- If the current catalogue has PV1, PV2, PV4 and the PDF has PV1, PV2, PV3, PV4,
  the result must be PV1, PV2, PV3, PV4; PV4 keeps its existing identity.
- Dimension drawings are never generated; required drawings must be supplied/reviewed.
- Do not silently create a new category. Uncertain routing must remain visible for
  review.
- A user can start with one category, validate it, and later add other categories.

## Latest upload fix

The uploaded PU Stone PDF is approximately 170 MB. A base64 JSON request is about
227 MB, so `server/index.js` now uses a 300 MB JSON request limit. The server was
restarted after this change. The import dialog now reports real non-JSON server errors
instead of showing `Unexpected token '<'`.

## Important files

- `app/src/App.jsx` — dashboard/editor shell, category deletion, export actions.
- `app/src/components/Dashboard.jsx` — dashboard overview and all-catalogue export.
- `app/src/components/IngestDialog.jsx` — PDF/image upload and review/reconciliation.
- `app/src/components/BotPanel.jsx` — assistant, including upload action.
- `app/src/lib/route.js` — safe category routing suggestions.
- `app/src/lib/store.js` — IndexedDB persistence and deleted-category markers.
- `app/server/ingest.mjs` — PDF/image reading, OCR, rule readers, AI fallback.
- `app/server/index.js` — upload/export/API server; upload limit is 300 MB.
- `README.md` — full architecture and client rules.
- `FLOWS.md` — step-by-step operating flows.

## Verification

The production build currently passes:

```powershell
cd app
npm run build
```

The upload UI, PVC, reconciliation, and image-routing checks passed previously.
Some older browser tests directly edit `localStorage`; those tests are stale because
the app now correctly persists catalogue data in IndexedDB. Do not revert IndexedDB
to make those tests pass; update the tests if regression coverage is needed.

## Next likely work

The next requested feature is likely to improve the assistant's autonomous upload
flow. The upload button is already inside the assistant, but it opens the existing
review dialog. Do not bypass review or silently save AI extraction results. Any AI
agent automation must preserve the evidence/review step and category routing.

