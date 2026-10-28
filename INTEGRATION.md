# Catalogue AI — brief for the host system

**Read this if you are building the parent system that will contain Catalogue AI as
one of its functions.** For how Catalogue AI works internally, read `README.md`; for
its operating flows, `FLOWS.md`; for where development stands, `HANDOFF.md`.

Catalogue AI turns printed product-catalogue PDFs into editable data and exports a
PDF that matches the original design. It is currently a standalone app. This file
says exactly what it needs in order to live inside something else.

---

## 1. What it is, physically

Two processes:

| Part | What | Port (standalone) |
| --- | --- | --- |
| **Editor** | A Vite + React single-page app (`app/src`) | 5173 |
| **Server** | Express: extraction, export, assistant (`app/server/index.js`) | 5174 |

```bash
cd app && npm install && npm start     # runs both
```

### It is not self-contained — it needs these on the machine

| Needs | Used for | Fails without it |
| --- | --- | --- |
| **poppler** — `pdftoppm`, `pdfinfo`, `pdfseparate`, `pdfunite` | rendering PDF pages to images | all PDF import |
| **Chrome or Edge** (a real binary) | `puppeteer-core` drives it to print | all PDF export |
| Node (ES modules) | both processes | everything |

npm dependencies are small: `tesseract.js` (OCR, WASM — no system install),
`pngjs`, `jpeg-js`, `@anthropic-ai/sdk`, React. `express` and `puppeteer-core` are
currently in devDependencies and **must move to dependencies** when this is deployed
as part of something else.

`ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) is **optional**, gated behind
`CATALOGUE_ENABLE_AI_FALLBACK=1`. Everything normal — reading known layouts,
quality checks, the assistant's local commands and rule-answerable questions —
runs locally with no key and no cost. A key is only used for a layout no local
reader recognises, and for the assistant's free-form wording (`/api/interpret`,
see §2) — questions AND commands typed in a way the local parser does not
recognise. Both endpoints pick the same provider the same way: OpenAI if
`OPENAI_API_KEY` is set, Anthropic otherwise. The key lives on the **server
only**, set once for the whole deployment — never per user, never sent to or
stored in the browser.

---

## 2. The whole interface

Five HTTP endpoints. There is nothing else — no sockets, no background jobs, no
database.

| Method | Path | Body | Answers |
| --- | --- | --- | --- |
| `POST` | `/api/ingest` | `{ pdf: base64, into: categoryId }` | **NDJSON stream** (see below) |
| `POST` | `/api/ingest-image` | `{ image: base64, mime, into }` | one JSON result |
| `POST` | `/api/export` | `{ products, category }` or `{ catalogues: [...] }` | `application/pdf` |
| `POST` | `/api/interpret` | `{ text, summary, hasAttachment, findingTitles }` | `{ kind: "command"\|"answer"\|"clarify", text }` |
| `GET` | `/api/ingest/status` | — | `{ ready, localReaders, aiFallback }` |

### `/api/ingest` streams, and its result arrives in parts

```
{"progress":"Rendering page 2 of 9 at 400 DPI…"}
{"progress":"…","heartbeat":true}          every 10s, so the connection stays open
{"part":"<256KB of JSON>","i":0,"total":50}
{"part":"…","i":1,"total":50}
{"assembled":50}                            now join the parts and JSON.parse
```

**Do not "simplify" this into one JSON response.** Both halves were forced by real
failures:

- **The heartbeat**: rendering a 9-page PDF at 400 DPI is minutes of silence, and
  clients abandoned the request mid-import (`UND_ERR_BODY_TIMEOUT`) while the server
  was still working correctly.
- **The parts**: the result carries every cut image, so it reaches ~12 MB. As one
  line it arrived instantly direct from the server and *never arrived at all*
  through a dev proxy — truncated mid-line, leaving the UI waiting forever on work
  that had finished.

Whatever sits between the browser and this server must pass a long-running chunked
response through untouched. If your gateway buffers responses, **this will hang**,
and it will hang silently.

### Uploads are big

A real catalogue PDF reached **170 MB**; base64 in JSON makes that ~227 MB. The
server sets `express.json({ limit: '300mb' })`. Any proxy, gateway or ingress in
front of it needs a matching body limit, or uploads fail with an HTML error page.

---

## 3. The three things that will actually bite you

### 3.1 Storage is in the browser — this is the real blocker

Products, cut images, page headers and answered quality checks live in the viewer's
**IndexedDB** (`app/src/lib/store.js`), under keys `catalogue.<id>`, `chrome.<id>`,
`accepted.<id>`, `deleted.<id>`.

That means today the system is **single-user, single-browser**. Nothing is on a
server. Clear the site data and the catalogues are gone.

If the host system has accounts — and if it has logins, it does — **this must be
replaced with server-side storage before integration is meaningful.** `store.js` is
deliberately the only module that touches persistence, so the swap is contained:
keep its function signatures (`loadAll`, `saveCatalogue`, `saveChrome`,
`saveAccepted`, `removeCatalogue`, `markCategoryDeleted`) and re-implement the
bodies against your database.

> Do not go back to `localStorage`. It caps the origin at ~5 MB, and catalogue
> images blew past that once already — 23 imported products were silently destroyed.
> The story is in `README.md` §13.

### 3.2 The exporter loads the editor's own URL

Export works by pointing headless Chrome at the editor with `?print=1`, so the PDF
is rendered by the very same React components as the screen. There is no second
renderer, and that is what guarantees the export matches what was edited.

```js
await page.goto(`${APP_URL}/?print=1`)     // APP_URL env, default http://localhost:5173
```

So when the editor is mounted somewhere else — say `https://host/catalogue` — you
must set `APP_URL` to that exact URL, and `?print=1` must still reach the app there.
If the host requires a login, **the headless browser must be able to reach that URL
too**: either allow it through, or give the exporter a token. An export that silently
returns a login page is the most likely integration failure.

### 3.3 There is no authentication or tenancy

The five endpoints are open, and nothing in the system knows who a user is. The host
must supply auth in front of the server, and — once storage moves server-side — a
tenant/user key must be threaded through `store.js` and the endpoints.

---

## 4. How to mount it — three options

| | How | Best when | Cost |
| --- | --- | --- | --- |
| **A. Separate service + iframe** | Run both processes as their own service; the parent embeds the editor in an iframe and proxies `/api/*` | The parent is not React, or you want the poppler/Chrome dependencies isolated | Lowest. Auth at the proxy. Iframe sizing and download handling need care |
| **B. Route inside the parent React app** *(recommended for a React host)* | Import `App.jsx` (or `Dashboard`/`Catalogue` directly) as a route; the parent's backend proxies `/api/*` to the Catalogue server | The parent is React and you want one navigation, one shell | Medium. Share the router and styles; keep `template.css` scoped — it defines the printed page |
| **C. Merge into the parent codebase** | Move components and endpoints into the parent | The catalogue UI must use the parent's design system | Highest, and you inherit the print CSS carefully or exports drift |

For any option, `src/lib/api.js` already does the right thing: it returns plain paths
so calls are same-origin, and only in standalone dev does it point at port 5174.

**Keep the printed page isolated whichever you choose.** `src/styles/template.css`
is the actual catalogue page — it is used by both the editor and the export. If the
parent's global CSS reaches it, the exported PDF changes. `editor.css` is the only
stylesheet that may be restyled freely.

---

## 5. Rules the host must not break

These came from the client and from real failures. Breaking them regresses the
product, not just the code.

- **Uploading is the main workflow.** Products get in by uploading a PDF or an image.
  Manual entry is for corrections.
- **Never bypass the review step.** Every import — AI-assisted or not — is shown for
  review before anything is saved. The assistant's upload button opens the same
  review dialog: a faster way in, never a way round.
- **Never route a category silently.** A confident match goes to an existing family;
  anything less stays put and says so. Categories are not invented.
- **Product names and codes are printed exactly as the catalogue prints them.** They
  are the code. Never normalise spacing or spelling.
- **Numbering is positional**, computed over final order — never copied from the
  printed badge.
- **Dimension drawings are never generated.** They carry real measurements.
- **Re-importing reconciles, it does not append.**
- **Non-product pages (cover, application spread, close-ups, installation steps) are
  kept whole** and printed as-is.

---

## 6. Before integrating — what is not finished

| | Why it matters to the host |
| --- | --- |
| **Server-side storage** | §3.1 — the blocker. Multi-user is impossible without it |
| **Authentication / tenancy** | §3.3 — the host must provide it, and storage must carry the user key |
| ~~No cancel while a PDF is being read~~ | **Done.** Cancel aborts the request; the server watches the *response* closing and stops between pages, freeing the OCR worker (`npm run test:cancel`) |
| **The AI reader path has never run** | No API key has been used on this machine; local readers are proven, the fallback is not |
| **Only two bespoke templates** | LED and PVC Marble reproduce their original designs; every other family prints on the default template. A new exact design still needs a template written |

---

## 7. Checking it works after mounting

```bash
cd app
npm run test:keep-pages   # detail pages kept whole, codes intact
npm run test:export-all   # combined export — page counts must add up
npm run test:bot-upload   # upload through the assistant, in a real browser
npm run test:reconcile    # re-import merges rather than duplicates
```

Then prove the two integration-specific paths by hand, because no test can know your
hosting:

1. **Import a real multi-page PDF through the host's UI** and watch the progress
   stream. If it stalls on "Reading…" while the server log says it finished, your
   gateway is buffering the response — see §2.
2. **Export a PDF** and open it. If it comes back as a login page or blank, the
   headless browser could not reach `APP_URL?print=1` — see §3.2.

Verify through the endpoint the host actually serves, not in isolation. In-process
tests passed for hours here while the real upload was broken over HTTP.
