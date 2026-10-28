# GEOMETRA Catalogue AI — Handoff State

Last saved: 28 October 2026 (Asia/Kuala_Lumpur)

## Latest handoff — read before the historical notes below

The user is continuing in Claude and has asked to save everything. No new feature
or redesign is pending. Preserve the working state; wait for the user's next task.
Read **AGENTS.md in full** before making changes. Its current requirements override
older design suggestions in this file, README.md or FLOWS.md. The working tree
contains extensive existing, uncommitted work; do not reset, clean or discard it.
All implementation and documentation changes are saved on disk; this is not a
claim that they have been committed to Git.

### Latest fix: destination-neutral Upload file

- The global dashboard Upload file used to open the remembered Wainscoting
  catalogue and pass its category into a new upload. This is fixed.
- `app/src/App.jsx` stores `importCategoryId` separately from the active viewer
  category. Opening/cancelling upload preserves the dashboard and active category.
  A card's upload explicitly targets that card; generic/bot uploads are neutral.
- `app/src/components/IngestDialog.jsx` sends an `into` category only when
  `targetChosen` is true. Unknown general uploads offer a new catalogue during
  review; confident source recognition still supplies a suggestion. Apply opens
  the imported catalogue. No catalogue renderer, layout or pagination was changed.
- Browser checks passed: `test-upload-destination.mjs`, `test-view-reload.mjs`,
  `test-association-review-ui.mjs`, `test-activity-browser.mjs`. Final build passed.
  These checks used mock uploads/providers, no paid AI calls and no PDF exports.

### Latest feature: durable activity and OpenAI cost monitoring

- Dashboard → **Aktiviti & Kos** opens a separate monitoring panel. Every new
  PDF/image upload and bot instruction is recorded, including local/free actions.
- Server implementation: `app/server/activity.mjs`, installed by `server/index.js`.
  AsyncLocalStorage links nested OpenAI text/vision/image fetches to the root job.
  API: `GET /api/activity?date=YYYY-MM-DD&includeTests=0` and
  `POST /api/activity/events`. CORS permits the activity job/origin headers.
- Durable append-only ledger: ignored `app/data/activity/YYYY-MM-DD.jsonl`.
  Keep these files when deploying/backing up the app. They are not in Git.
- Browser metadata outbox: `catalogue-activity-outbox-v1` in localStorage, with
  idempotent retries after connectivity returns/reload. Catalogue content remains
  in IndexedDB. Never clear either store as part of routine debugging.
- Costs are versioned standard USD estimates based on returned token usage for
  GPT-4o and GPT-image-1.5. Unknown models, missing usage/modality details and
  uncertain failed/cancelled costs stay unknown, not zero. No historical spending
  was fabricated. Other providers' costs are not included in OpenAI totals.
- Ledger stores bounded, redacted metadata and numeric usage, not image/PDF
  payloads, keys or complete provider responses. Automated browser activity is
  labelled test and excluded from the default user report.
- `test-activity.mjs` verifies persistence/restart, concurrent attribution,
  text+image costs on the same job, missing usage, deduplication, secret/payload
  exclusion and Malaysian day boundaries. `test-activity-browser.mjs` verifies
  actual uploads, free/AI bot paths, monitor filters and offline/reload recovery
  using an isolated mock provider and ledger. Both passed.
- A daily **17:30 Asia/Kuala_Lumpur** reminder is already active in the Codex chat:
  automation ID `semak-penggunaan-katalog-harian`. This is an app automation, not
  a scheduler inside this repository. Do not create a duplicate in Claude. It
  reads the local report if available, otherwise reminds the user to open it.

### Preserve the accepted catalogue and chatbot behaviour

- Four ordinary products per row; original WB source rows and complete source
  support bands; shared WB06/CW02/CW03 strip stays together. Full drawings and
  measurements, approved technical pairs and M04/M05 folding galleries stay intact.
- Product/display images remain appropriately beside each other, contained and
  readable. Keep fitted one/two-page reader navigation, reload position and existing
  page counts. Never redesign layout while fixing command handling or monitoring.
- Display/installed images preserve original rectangular scenes and backgrounds.
  Standalone product isolation preserves orientation: no implicit rotation, tilt,
  straightening or restaging. Drawings/full pages are not sent for photo isolation.
- Bot uses shared typed capability/intent resolution with conversation context,
  validated targets, previews and explicit Apply. General instructions are not
  meant to be patched one sentence at a time. Existing image-page moves respect
  requested page numbers; display ownership and source associations must survive.
- Approved-source browser audit passed for 32 source products / 14 fixture pages:
  four-column ordinary rows, complete technical references, WB bands, galleries,
  no missing images or overflow. This is a fixture count, not a claim about the
  user's current edited catalogue. No export or paid AI was used for this audit.

### Runtime and checks

- Workspace: `C:\Users\admin\Desktop\RAIHANA - INTERN WORK\CATALOUGE_AI`.
  Run commands from `app/`. Editor 5173 and API 5174 were reachable after the fixes.
- Server: `node --use-system-ca server/index.js`. Keep system certificate support;
  never disable TLS checks. OpenAI configuration is server-side in ignored
  `app/.env`; never print, copy into documentation or commit keys.
- Do not stop unrelated processes. Only restart an identified catalogue API after
  server changes. Preserve user data and test in isolated browser profiles.
- Build: `npm run build` (passes; existing large-bundle warning).
- Run checks relevant to the next change. Some older regression scripts export
  PDFs or optionally call real models. Do not run those when the user requests no
  export/no OpenAI usage. Recent checks named above are mocked and safe.

## Historical handoff from 25 September 2026

The remaining notes describe the older system and may be superseded by the
current implementation and AGENTS.md, especially AI configuration and layout.

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

