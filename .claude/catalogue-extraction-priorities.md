# Catalogue extraction priorities

User instruction (14 October 2026): the existing flow/UI is good and must not be disturbed. Future work should focus only on improving product extraction.

Current priorities:

1. If a product image already has a light/clean background, do not aggressively remove or flatten that background. The background-removal step must preserve the product silhouette and surface detail; SW01 is a known example of the failure mode.
2. Product-code OCR is still unreliable. Improve it with layout-aware OCR, character-confusion repair, and confidence/consistency checks so uncertain codes are not silently saved as exact values.
3. Preserve all extraction behavior that already passes for existing catalogues. Make narrow, test-backed changes and compare against the baseline before committing.

Implementation note: SW01 refers to the browser photo-upload background-removal path in `app/src/lib/bgremove.js`, not only the PDF crop path. A light-border check must bypass segmentation and keep the original image.

Do not rebuild the flow or add manual layout-teaching steps just to support a new PDF. Prefer automatic layout detection and safe fallback behavior.

Known Wainscoting, Cornering & Mirror layout gaps: pages 3-5 have readers, but page
6 is Installation, page 7 is Wave Crystal Brick, page 8 is a Mirror page, page 9 is
the M04/M05 mirror-card layout, and page 10 is the Half Moon Mirror feature layout.
These need dedicated code/name/size readers; re-importing cannot fix them while they
fall through to whole-page fallback.

## Baseline preservation rule

User instruction (15 October 2026): the current flow, UI, jobs, storage, routing,
background handling, local readers, OpenAI fallback, review/apply behavior, and
anything currently working are the accepted baseline. Future requests must change
only the specific feature or bug named by the user. Do not refactor, redesign, or
replace working behavior as a side effect. Make narrow changes, run the relevant
tests/build, and compare against the baseline before reporting completion.
