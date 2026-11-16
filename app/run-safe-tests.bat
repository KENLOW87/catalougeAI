@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ===================================================================
rem GEOMETRA Catalogue AI - run all SAFE regression tests.
rem Safe = no real OpenAI API calls, no real PDF export to disk.
rem Tests that export a real PDF or need a real OpenAI key are
rem deliberately NOT in this list (see SKIPPED note at the end).
rem Double-click this file to run everything and see PASS/FAIL.
rem ===================================================================

set LOGFILE=%~dp0test-results.log
echo ================================================= > "%LOGFILE%"
echo GEOMETRA Catalogue AI - safe test run >> "%LOGFILE%"
echo %date% %time% >> "%LOGFILE%"
echo ================================================= >> "%LOGFILE%"

set /a PASS=0
set /a FAIL=0
set FAILED_LIST=

for %%T in (
  test-accessories-march-structure.mjs
  test-activity-browser.mjs
  test-activity.mjs
  test-ai-image.mjs
  test-approved-catalogue.mjs
  test-approved-upload-metadata.mjs
  test-association-review-ui.mjs
  test-bot-capabilities.mjs
  test-bot-commands.mjs
  test-bot-interpreter-browser.mjs
  test-bot-interpreter.mjs
  test-bot-upload.mjs
  test-cancel.mjs
  test-dimension-photo.mjs
  test-display-attachment.mjs
  test-display-placement-browser.mjs
  test-display-planner.mjs
  test-export-reimport-guard.mjs
  test-future-source-layouts.mjs
  test-image-association.mjs
  test-image-page-browser.mjs
  test-image-page-position-browser.mjs
  test-image-page-position.mjs
  test-image-page.mjs
  test-image-quality.mjs
  test-image-removal.mjs
  test-import-evidence.mjs
  test-import-photos.mjs
  test-ingest-free.mjs
  test-ingest-geometry.mjs
  test-ingest-ui.mjs
  test-keep-pages.mjs
  test-ocr.mjs
  test-photo-size.mjs
  test-photo-treatment.mjs
  test-product-family-order.mjs
  test-product-layout.mjs
  test-publish.mjs
  test-recognized-source-import.mjs
  test-reconcile.mjs
  test-reflow.mjs
  test-restore-scene-browser.mjs
  test-rules-reader.mjs
  test-source-placement.mjs
  test-spec-engine.mjs
  test-technical-pair-balance.mjs
  test-technical-row-reflow.mjs
  test-unknown-layout.mjs
  test-upload-destination.mjs
  test-view-reload.mjs
  e2e-reimport.mjs
) do (
  echo.
  echo ---- Running %%T ----
  echo. >> "%LOGFILE%"
  echo ---- Running %%T ---- >> "%LOGFILE%"
  node server\%%T >> "%LOGFILE%" 2>&1
  if !errorlevel! equ 0 (
    echo   [PASS] %%T
    set /a PASS+=1
  ) else (
    echo   [FAIL] %%T
    set /a FAIL+=1
    set FAILED_LIST=!FAILED_LIST! %%T
  )
)

echo.
echo =================================================
echo DONE.  Passed: !PASS!   Failed: !FAIL!
echo =================================================
echo.
echo DONE. Passed: !PASS!  Failed: !FAIL! >> "%LOGFILE%"
if not "!FAILED_LIST!"=="" (
  echo Failed tests: !FAILED_LIST!
  echo Failed tests: !FAILED_LIST! >> "%LOGFILE%"
)

echo.
echo Full output saved to: %LOGFILE%
echo.
echo NOTE: tests that export a real PDF or call a real paid AI model
echo are deliberately skipped by this script (e2e.mjs, e2e-pvc.mjs,
echo test-export-all.mjs, test-catalogue-reader.mjs and a few others).
echo Only run those yourself if you really want a real PDF export.
echo.
pause
