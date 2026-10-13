# GEOMETRA — Catalogue AI

Turns a printed product catalogue into editable data, lets an admin add / edit /
delete / reorder products in a layout that reflows automatically, and exports a PDF
matching the original catalogue template.

**Bespoke templates built:** `Accessories ~ LED` (page 1) and `PVC Marble` (pages
2–3) of `ACCECORIES - PVC MARBLE.pdf`. Every other family prints on the default
template (§7).

The app opens on the **dashboard** — every product family with its counts and any
outstanding quality findings. Opening one shows the editor and its sidebar;
**uploading a PDF or an image is the main way products get in.**

```bash
cd app
npm install
npm start          # editor on :5173, export server on :5174
```

Open <http://localhost:5173>. No API key is needed for normal use.

---

## 1. The brief

From the client's hand-drawn storyboards:

```
provide current catalogue in PDF  ──▶  AI agent scans column of product image,
       (image, text, column)              text for each page

every column can be edited              middle item deleted →
current item = 10, when company          product moves back
has new item, total will change              [storyboard 2]
      [storyboard 1]                              │
                                                  ▼
                                    the catalogue page can be downloaded
                                    as PDF same as design that we edited
```

In one line: **PDF in → products as data → admin edits in a reflowing grid → PDF out
in the same design.**

---

## 2. The client's rules — confirmed, do not re-litigate

Settled with the client, who said explicitly they would not repeat them.

### Two product types (LED category)

| | |
| --- | --- |
| **Type A — standard** | One product, one finish. Sits in the 6-across grid strip. Badge, name, colour, `Length : 3000mm`, photo, dimension drawing. |
| **Type B — featured** | One product in *several* finishes, full width. The colour line under the name is the **default finish**; the finishes are a list. |

### Reflow

1. A new **Type A** product wraps to a new row *directly underneath* the existing
   row, on the same page.
2. As Type A rows grow, the **Type B** block is **pushed onto a following page**.
3. A new Type B product goes onto a further page using the same structure as #7.

Type A flows first and fills pages top-down; Type B blocks always follow.

### Numbering (*bil no.*)

**Positional.** Computed over the final flow order, never stored on the product.
Badges always read 1, 2, 3 … with no gaps.

> Adding two standard products makes them #7 and #8 and renumbers Led-08 from #7
> to **#9**. You never see 8 and 9 sitting above a 7.

### The alternating tint is positional too

Odd slots are tinted. A product moving from slot 3 to slot 2 must **lose** its tint.
This is why assets are stored on a pure white ground and composited with
`mix-blend-mode: multiply`.

### Names are verbatim

The catalogue really does contain `Led -160`, `Led - 508`, `Led -15`,
`Corner Led 601` with inconsistent spacing. **Never normalise them.** There is no
separate product code — the name *is* the code.

Names are **not unique**: PVC Marble has `L Profile` twice, told apart only by the
dimension drawing. Anything matching by name must cope with that.

### Dimension drawings are never generated

They carry real millimetre measurements; a wrong number is a real-world problem, not
a cosmetic one. Existing ones were cropped from the source PDF. Adding a product
**requires** the admin to upload one, and Save stays disabled until they do.

### Page furniture is locked

The header banner, the 6-photo lifestyle gallery and the 4 footer feature icons are
template, page 1 only. Admins edit products, not decoration.

---

## 3. The source files

- **No text layer.** `pdftotext` returns 3 bytes. The PDF was made by
  "Microsoft: Print To PDF", which rasterised everything. All text comes from OCR.
- **Product photos *are* recoverable** as embedded JPEGs. Dimension drawings are
  not — they must be cut from a page render.
- **The layout is hand-positioned, not a grid.** Measured column pitch on page 1:
  31.9, 34.0, 35.1, 35.6, 37.2 mm. A reflowing catalogue cannot use hand-placed
  slots, so the template imposes an even 6-column grid. **The rebuilt page is very
  slightly more regular than the original** — disclosed and accepted.
- **Rows drift vertically too.** Badge→name measured 8.3 / 8.7 / 11.1 / 9.4 mm down
  one page. Nothing may assume a fixed offset.
- Whether the **original design file** exists (InDesign / Illustrator / Canva /
  PowerPoint) is still unanswered. It would give real text and exact fonts.

---

## 4. How the system fits together

```
                 ┌──────────────── reading ────────────────┐
  catalogue PDF ─┤ detect layout → OCR + geometry → review  ├─▶ products (data)
                 └──────────────────────────────────────────┘          │
                                                                       ▼
                                                          ┌─── editor (screen) ───┐
                                                          │  add / edit / delete  │
                                                          │  reorder / reflow     │
                                                          └───────────┬───────────┘
                                                                      ▼
                                                       headless Chrome ─▶ PDF out
```

**The editor and the PDF export mount the same React components and the same
stylesheet.** That is what guarantees the export matches what was edited. There is
no second renderer that can drift. Never add one.

### Download PDF, and Download all as PDF

Two buttons, **one exporter**. `/api/export` takes a LIST of catalogues; a single
download is simply a list of one, so the combined file cannot differ from the
individual ones. Chrome prints the whole list in a single pass — there is no PDF
merging step, and no second code path to keep in sync.

```
POST /api/export  { products, category }      one catalogue  (unchanged)
POST /api/export  { catalogues: [ { category, products, chrome }, … ] }
```

**Download all as PDF** collects every catalogue that has products, in the order the
families are published, and returns `GEOMETRA-Catalogue.pdf`. It shows how many
catalogues that is, and is disabled when none has any.

The two live in different places, deliberately:

| Button | Where | Why |
| --- | --- | --- |
| **Download PDF** | the editor sidebar | it exports the one catalogue you have open |
| **Download all as PDF** | the **dashboard** only | it is about every catalogue, so it belongs where you can see them all |

One rule makes it work:

```css
.cat-page { page-break-after: always; }
.cat-doc:last-child .cat-page:last-child { page-break-after: auto; }
```

Per-document `:last-child` would let the next catalogue's first page share a sheet
with the previous one's last. `npm run test:export-all` guards exactly that — it
exports each catalogue alone, exports them together, and requires the combined page
count to be the **sum**, so nothing is lost or merged at a boundary.

### Files

| Path | Does |
| --- | --- |
| `src/App.jsx` | Shell: dashboard/editor switch, category tabs, product list, import, export, whole-category deletion |
| `src/components/Dashboard.jsx` | The landing view: every family, its counts and findings, and **Download all as PDF** |
| `src/components/Catalogue.jsx` | Dispatches to the right page template |
| `src/components/LedPage.jsx` | The LED grid template |
| `src/components/PvcPage.jsx` | The PVC Marble stacked-row template |
| `src/components/DefaultPage.jsx` | The default page for a family with no bespoke template |
| `src/components/ProductDialog.jsx` | Add/edit, schema-driven from the category |
| `src/components/IngestDialog.jsx` | Import from PDF + the reconcile review |
| `src/components/BotPanel.jsx` | The assistant: the corner bubble and its chat window |
| `src/lib/qc.js` | The quality checks — plain rules, no AI |
| `src/lib/ask.js` | Answering from the data, and the text-only summary for the API |
| `src/lib/commands.js` | Turning an instruction into an action or a proposal |
| `src/lib/route.js` | Which catalogue an upload belongs to — suggested, never decided |
| `src/lib/store.js` | IndexedDB: catalogues, page headers, answered checks, deleted-category markers |
| `src/lib/categories/parents.js` | The 13 product families and which catalogues they hold |
| `src/lib/categories/default.js` | Builds a catalogue for a family that has no template |
| `src/lib/categories/index.js` | Category registry: template, reflow, fields, seed |
| `src/lib/geometry.js` | Page measurements, LED |
| `src/lib/paginate.js` | LED reflow + positional tint |
| `src/lib/categories/pvc.js` | PVC geometry, reflow, seed |
| `src/lib/reconcile.js` | Merging an import against what is already there |
| `src/styles/template.css` | The printed page. Used by editor **and** export |
| `src/styles/editor.css` | Editor chrome only. Never reaches the PDF |

---

## 5. Categories

A category owns its **template**, its **reflow rules** and its **product shape**.
Everything else is shared: positional numbering, the editor, the dialogs, export.

Categories sit under **13 product families** (`src/lib/categories/parents.js`) —
Accessories, Acoustic Panel, PVC Marble Sheet, and the rest. The **dashboard** lists
them all and is where a family is chosen; sub-catalogue tabs appear only when a
family has more than one. A family holds no products of its own **unless it has no
sub-catalogue**, in which case it is itself the catalogue and its id doubles as the
category id. See §7.

**Deleting a whole catalogue** empties it and removes it from the dashboard, the
tabs and the combined export. The layout definition stays in source — a deleted
catalogue is empty, not unbuilt, so re-importing brings it straight back.

### Accessories ~ LED

Grid. Measured off page 1 at 400 DPI by scanning for content bands:

```
header        0.0 –  27.5 mm
gallery      27.5 – 164.1
type A strip 165.7 – 220.9   badge 165.7, name 171.3, colour 176.0,
                             length 179.1, panel 182.8
type B block 225.8 – 271.8
footer       275.1 – 288.4
```

Page 1 was 1 mm too short for two Type A rows, so the panel was tightened from
38.1 mm to **37.0 mm** (row 54.1 mm) to honour the client's rule that new standard
products sit underneath the existing row. Imperceptible in print.

### PVC Marble

Full-width rows, one product per row, separated by a gold rule.

```
header (first page)   0 – 35 mm   blue band, Edge Display, 收边条展示, PVC MARBLE banner
header (continuation) 0 – 35 mm   banner only, no Edge Display title
row height            58 mm       100 mm when the row carries an exception
```

Product 6 carries an **exception**: its White finish is only made in another size,
so it has its own photo, its own drawing and the printed note
`(This size only for White Color)`.

> **No clean horizontal cut exists between the PVC header and product 1.** The
> header's right-hand text (铝合金装饰条) runs to 34.1 mm while product 1's badge
> starts at 32.6 mm in the *left* column — they sit side by side. The chrome is cut
> at 35 mm with the badge region painted out (`server/extract-pvc-chrome.mjs`).

---

## 6. Reading a PDF — cheapest reader first

| | Runs | Cost | Handles |
| --- | --- | --- | --- |
| **Named layouts** | on this machine | free, no key | LED, PVC Marble — measured layouts |
| **Photo grid** | on this machine | free, no key | any grid of photos with captions |
| **AI reader** | Anthropic API | ~2–5¢ / page | anything the first two cannot |

`server/readers/index.mjs` runs **two rounds**: every named layout first, then the
fallback ones. A spec carrying `fallback: true` only runs when nothing specific
matched — otherwise a generic reader would win races against the layout that was
measured for the page.

A page only reaches the API when no local reader recognises it, or one recognises it
but the read comes back incomplete. **Adding more pages of an existing catalogue
costs nothing.**

### A page carrying no products is KEPT, not skipped

**A catalogue is not only its product tables.** The cover, the *Wide Range of
Application* spread, the close-up detail pages and the installation steps are all
part of the document the client publishes. A page with nothing to extract is taken
whole — one full-page picture that holds its place in the flow and prints back out
exactly as printed. There is nothing to reflow inside it and nothing to get wrong.

```
page 1  cover                 -> kept whole    [PAGE] 380 KB
page 2  room photos           -> kept whole    [PAGE] 480 KB
page 3  Product Series grid   -> 8 products
```

A kept page carries no badge and **does not consume a product number**, so inserting
a cover cannot renumber the catalogue. It is stored as JPEG: an A4 page as PNG runs
to several megabytes, as JPEG to a few hundred kilobytes.

This went through two wrong answers before the right one. First such a page was
**fatal** — the import died on page 1 and never reached the products. Then it was
**skipped** — which silently threw away the front page of every catalogue. The
client's correction was the point of the whole system: *"the details (not product),
close up image, will be extract too."*

An import now fails only if a PDF yields nothing at all — not one product, not one
page worth keeping.

### A layout must deliver the fields it declares

Matching a page is not the same as reading it. The PVC Marble layout matched the
catalogue's **cover** — one full-page photograph — and read a product off it:

```json
{ "name": "NN 7", "size": "", "series": "",
  "drawing": true, "variants": [{ "name": "" }, { "name": "" }, { "name": "H" }] }
```

A name test alone lets that through: `NN 7` is four characters. Assets do not help
either — a full-page photo crops "successfully". What gives it away is that **every
other field the layout promised came back empty**.

So `ruleReadIsUsable(result, spec)` requires both:

1. at least 60 % of products carry a name of 2+ characters, **and**
2. at least one product fills half or more of the layout's declared `text` fields.

One good product is enough — pages have their oddities — but a layout that fills
nothing beyond a name did not match that page, and the page falls through to the
next reader. A layout declaring fewer than two text fields is exempt, so a catalogue
with nothing but a code still imports.

Measured: **14 LED/PVC products in ~31 s**, and **23 marble-sheet products** through
the photo grid — both with no key and no API call.

### Photo grid — the reader for a catalogue nobody measured

Named layouts key off a coloured badge. A catalogue that has no badge needs a
different handle, so `photo-grid` anchors on **shape**: it finds the photo blocks
themselves (`anchor.type: 'blocks'`), clusters their left edges into columns and
their top edges into rows, and infers the grid.

Three guards, each earned:

- `minSizeMm: 25` and `maxWidthFrac: 0.5` — a page banner is a block too, and
  without a width ceiling the header became product 1.
- `minFill: 0.62` — line art and rules are blocks; a photo is solid.
- `repair: 'code'` with an A–Z0–9 whitelist on the name — sheet codes are the one
  field where OCR confusion (`PV0O3`) is mechanically fixable, and `repairCode` uses
  a **lazy** prefix match so it does not swallow the letter it needs to repair.

Fields hang off `from: 'blockBottom'`, and `w: 0` / `h: 0` mean *inherit the block's
own size* — the grid is the measurement, so nothing is hard-coded to one catalogue.

The page header above the first block is cropped and carried through as `chrome`
(§7), which is how the printed page keeps the catalogue's real title and size line.

### A layout is DATA, not code

`server/readers/spec.mjs` is one engine driving every layout.
`server/readers/specs.mjs` holds the built-ins as specs. A spec is only:

1. **An anchor** — the mark that starts each product, found either by **colour**
   (LED's cyan badge, PVC's gold badge) or by **shape** (`type: 'blocks'`, the photo
   grid).
2. **Field boxes in millimetres relative to that anchor** — so a layout measured on
   a 150 DPI preview reads a 400 DPI page correctly.

```js
{
  id, title, category, inkCut,          // inkCut: 185 black line art, 210 gold
  fallback: true,                       // optional: only run if nothing else matched
  anchor: { rgb, tolerance, arrangement: 'row'|'column',
            scanWidthMm, minSizeMm, maxSizeMm, minFill,
            type: 'blocks', maxWidthFrac },   // shape-based instead of colour
  kinds: [                              // optional: several product kinds per layout
    { id, when: { minAnchorsInBand }, fields: [...] },
  ],
  fields: [                             // or a single set
    { key, type: 'text'|'photo'|'lineart'|'finishes',
      box: { x, y, w, h },              // mm, anchor-relative; w:0/h:0 = the block's own
      from: 'blockBottom',              // measure from under the photo, not the anchor
      line: 1|2|3,                      // text: which line inside the box
      labelBox, leftoverKey,            // finishes: where the labels are
      repair: 'size'|'length'|'code', vocab },
  ],
}
```

### OCR reads characters; geometry supplies the meaning

Free OCR (`tesseract.js`, WASM, no system install) never decides what anything *is*.
Geometry finds the products first and hands OCR a crop whose meaning is already
settled. `server/readers/vocab.mjs` then repairs the read:

- Finish names are a **controlled vocabulary**, so `Rose Gol`, `Golc`, `Blo` snap to
  the real values.
- **Product names are never snapped** — they must stay verbatim, so the raw read
  stands. Only trailing 1–2 letter bleed is trimmed (`Silver Co` → `Silver`).

### What the reader refuses to guess

- `9'5"` and `9'6"` are near-identical glyphs at print resolution. A size is a real
  measurement, so a disagreement across a page is **reported, never auto-corrected**.
- A product whose finish labels do not read as real words is flagged, not imported
  silently.
- Dimension drawings are cropped as images and never read by OCR or AI.

---

## 7. Product families, and catalogues with no template

The catalogue is two levels deep (`src/lib/categories/parents.js`):

```
Accessories                    ├── LED           bespoke template
                               └── PVC Marble    bespoke template
Acoustic Panel                 ─── itself a catalogue, default template
PVC Marble Sheet               ─── itself a catalogue, default template
… 13 families in all
```

**A family with no sub-catalogue simply IS one.** Pick it, import a PDF, and its
products land there under its own id. Nothing to create, nothing to configure.

Those catalogues use the **default template** (`src/components/DefaultPage.jsx`): a
4-across grid of photos with the code and description beneath. It is not a
reproduction of a specific design — it is a correct catalogue page with no setup.

**Its header is lifted off the source PDF.** Everything above the first product —
title, banner, `Size: 1200mm(W) x 2800mm(L) x 3mm(T)` — is cropped and used as the
page header. Inventing a plain bar in its place threw all of that away.

Row heights are then sized to whatever space that header leaves. With a real 46mm
header, a fixed row height fitted only one row per page and turned a 3-page
catalogue into 6.

> A dimension drawing is **optional** here. Sheet products have a photo and a code,
> not an engineering drawing; requiring one blocked every product for a field the
> source page does not contain. The reader states whether a layout has drawings and
> the review screen applies the same rule.

### A layout teacher was built and removed

There was briefly a screen for teaching the system a layout by dragging boxes. The
client removed it: *"its complicated, i build this system for automation, why do i
need to make more work?"* — correct, and the right instinct. **Do not rebuild it.**
The answer to an unknown layout is a reader that recognises it automatically (see
§6, Photo grid) or the AI fallback, never manual setup.

---

## 8. Importing — it merges, it does not append

Re-importing a PDF that overlaps the catalogue used to duplicate everything. It now
**reconciles** (`src/lib/reconcile.js`):

```
system before   PV1   PV2   PV4
PDF has         PV1   PV2   PV3   PV4

result          PV1   PV2   PV3   PV4      ← PDF order, PV3 inserted at 3
```

The review screen shows three groups:

| Group | Default | You can |
| --- | --- | --- |
| **Already in the catalogue** | kept as-is | take the PDF's version; refresh its images |
| **Not in this PDF** | **kept**, listed | tick to remove — never automatic |
| **New in this PDF** | added, in the PDF's position | untick to skip |

The final order follows the PDF. Products kept but absent from the PDF sit **after**
the ones it lists — the PDF is the authority on sequence, so anything it does not
mention cannot be placed inside that order.

Two details:

- **Duplicate names pair up in order.** `L Profile` appears twice; matching by name
  alone would map both to the first. Those matches are marked *"matched by position"*.
- **Images are never diffed.** Re-extracting the same photo gives different bytes
  every time, so a byte comparison would mark everything as changed. Only text and
  finish names are compared; images get an explicit *refresh from the PDF* tick.

### Upload routing and image intake

The import button accepts PDFs and individual product images. The server reads the
upload locally first, then uses the page header and product names/codes to suggest
the destination catalogue. Known category-specific readers keep their authoritative
category; generic uploads are routed only when the evidence is clear.

The review screen shows the destination and its evidence before anything is saved.
An uncertain match stays in the catalogue currently open instead of silently moving
into a wrong category or creating a new one. A single image becomes one review draft
with its photo attached; required drawings or other missing fields remain visible and
block Apply until fixed.

**Never create a category silently.** A confident match routes to an existing family;
anything less stays put and says so. The 13 families are fixed — routing chooses
between them, it does not invent one.

### Uploads are large — in both directions

**Going up.** The PU Stone catalogue is about **170 MB**, and base64 in a JSON body
inflates that to roughly **227 MB**. The request limit in `server/index.js` is
therefore `300mb`:

```js
app.use(express.json({ limit: '300mb' }))
```

Below that, the server rejected the upload with an HTML error page, and the import
dialog showed `Unexpected token '<'` — the dialog now reports the real server error
instead of the JSON parse failure behind it.

**Coming back.** The result carries every cut image, so a three-page PDF answers with
about **12 MB**. Two things had to change before that survived the trip:

1. **The result is sent in parts.** It used to go as one enormous NDJSON line. Sent
   whole it arrived instantly from the server itself and *never arrived at all*
   through the dev proxy — cut off mid-line, so the dialog sat on "Reading…"
   permanently while the work had in fact finished. It now goes as
   `{part, i, total}` lines of 256 KB followed by `{assembled}`, and the dialog
   refuses to continue if the count does not match.
2. **The browser calls the API directly** (`src/lib/api.js`). Even in parts, Vite's
   dev proxy delivered 49 of 50 and then stalled until the client timed out. The
   proxy is a development convenience, not part of the product — in a build the app
   and the API are same-origin. The server allows the dev origin by CORS, and
   `apiUrl()` returns the plain path everywhere else.

`npm run test:bot-upload` drives the whole path in a real browser, so a regression
here shows up as a failing test rather than as an import that hangs.

---

## 9. The asset pipeline

Because the tint is positional, assets must never carry a baked-in background.

| Script | Purpose |
| --- | --- |
| `server/imageops.mjs` | Shared: crop, whiten background, keep ink, trim, largest blob |
| `server/snapbox.mjs` | Snaps a vision-estimated box onto the real ink |
| `server/split-strip.mjs` | Splits a composite finish strip by connected components |
| `server/separate-subject.mjs` | Separates a photo fused to its neighbour, by tone |
| `server/normalize-assets.mjs` | Flattens a flat photo background to pure white |
| `server/normalize-lineart.mjs` | Keeps only the ink in a dimension drawing |
| `server/trim.mjs` | Crops to own content, dropping neighbour fragments |
| `server/keep-largest.mjs` | Keeps the largest connected blob |
| `server/extract-pvc.mjs` | One-off: all 42 PVC assets. Re-runnable |
| `server/extract-pvc-chrome.mjs` | One-off: PVC headers, badge region painted out |

Assets render with `mix-blend-mode: multiply` over a white ground, so one file
composites correctly onto a tinted slot or a white one.

### Traps — every one cost real time

**Cutting**

- **Background is not the same as white.** Half the LED cells sit on a tinted panel.
  Testing for white rows found no gutter and three drawings came back empty.
- **On a tinted panel, white is the PRODUCT, not the ground.** Excluding both erases
  a white aluminium product. The background is the tint *and only* the tint.
- **Grow a box horizontally, never vertically.** A drawing sits under its photo with
  under 10 px between them. Cap horizontal growth at ~80 px: enough to reclaim a
  detached `10mm` label, not enough to reach the neighbour, whose feathered edge
  leaves debris at 2–14 px spacing that no trim threshold can separate.
- **Bound growth against the ORIGINAL edge.** Comparing against the value the loop is
  moving let a box walk **2237 px** across the page.
- **Touching diagonals cannot be split by shape.** The LED featured bars and the PVC
  colour strips merge into one blob. Split by their **labels** instead — the labels
  are separate and evenly spaced, so their centres give the boundaries.
- **A photo fused to its neighbour splits by TONE.** Where the installed photo is
  drawn over the last bar, keep the largest region of the subject's tone and dilate
  to recover its soft edge. Where tone fails, cut at the narrowest column waist —
  `end-profile-v3` had a bridge at x=812 carrying 8 % ink with 94 % of the mass on
  one side.

**PVC specifics**

- **Variants come from the EMBEDDED strips, not page crops.** On the page the
  installed detail photo *overlaps* the Black bar (177–187 mm); they touch, so
  components see one blob. The embedded strips contain only the variants.
- **The embedded strips are NOT in page order** — PDF draw order shuffled them. The
  mapping was established by identifying each profile's shape:
  `h-profile`=img-001, `t-profile`=img-012, `end-profile`=img-006,
  `w-profile`=img-010 (3 variants), `corner-profile`=img-017,
  `l-profile-14`=img-019, `l-profile-10`=img-021.
- **Column splitting fails on these strips** — the bars are long diagonals sharing
  columns even at zero gap tolerance. Connected components are required.
- **PVC drawings are gold** (luminance ≈ 160), not black. `keepInk` cut 210.

---

## 10. The assistant — one bot, two engines

A bubble in the corner of the app opens a chat window. It checks the catalogue and
it answers questions, and to the admin those are one panel.

```
        ┌──────────────── one bot ────────────────┐
  you → │ 1. commands   parsed here, free         │ → delete / rename / move
        │ 2. rules      counts, gaps, duplicates  │ → instant, exact, free
        │ 3. AI         wording and judgement     │ → only with a key, text only
        └─────────────────────────────────────────┘
```

**The same principle as the PDF readers: the cheapest engine first.** Counting
products needs no intelligence, and an answer computed from the data is exact — it
cannot drift, cost anything, or be invented. Without an API key the bot still does
all quality control and every factual question; a key only buys free-form wording.

**What is sent when the API is used: a TEXT summary** — names, codes, descriptions,
counts. Never the images. They are nearly all of a catalogue's bulk and answer no
question the bot is asked.

### It never changes the catalogue by itself

| Command | What happens |
| --- | --- |
| delete · rename · move | **proposed** — a card describing the consequence, waits for a click |
| export · quality check · show me · open a dialog | runs at once; nothing is altered |
| **Upload PDF/image** | opens the normal review dialog — never a shortcut past it |
| attach a photo, "replace PV07 with this photo" | **proposed** — same as delete/rename, with the photo itself shown on the card |
| mark a finding as correct | takes effect at once — non-destructive and undoable |

The panel carries an **Upload PDF/image** button because uploading is the main
workflow and the assistant is always within reach. It opens the same review screen
as the sidebar button: **the assistant is a faster way in, never a way round.**
Extraction results are never saved without the evidence and routing step (§8).

A misheard instruction must cost a glance, never a product. Every action the bot can
take is one the admin could have clicked themselves.

### Replacing a photo

The 📎 button next to the chat box attaches a photo, separately from PDF/image
import — this is a single product's picture, not a catalogue to review. The
background is removed automatically, **entirely in the browser**: a small
Apache-2.0 model (`onnx-community/ormbg-ONNX`, via `@huggingface/transformers`)
runs on-device, so the photo is never uploaded anywhere and nothing costs money.
A bad cutout is one click to undo — "keep the original photo instead" — before
it is ever used.

`"replace PV07 with this photo"`, or `"remove PV07 and replace it with my updated
product"`, finds PV07 and proposes the swap exactly like delete or rename —
*except* the card shows the actual photo, since there is no name or code to
double-check a picture against. A product with more than one photo (a Type B
LED's finishes, PVC Marble's colour variants) is never guessed at: the bot lists
the finishes by name and asks which one, e.g. `"replace Led - 08 Black photo"`.

Picked this Apache-2.0 model over the more common `@imgly/background-removal`
package specifically for the licence: that one is AGPL-3.0, which would obligate
open-sourcing this app, or buying a commercial licence, to ship it in a
closed-source product. Apache-2.0 has no such catch. See `src/lib/bgremove.js`.

### The checks (`src/lib/qc.js`)

Deterministic rules, not AI — each one is a mistake this project actually made:

- a code whose digits do not match the page's format (`PV003` among `PV01`–`PV32`)
- two products sharing a name, a description, or **the same photo**
- **near-duplicates**: `PV18` beside `PV18N` — same number, different letter
- missing photos, missing names, missing drawings where the layout has them
- gaps in the code sequence

> **A check that cries wolf is worse than no check.** A "descriptions differ by one
> word" rule was written and deleted: nearly every name here is
> *"\<x\> \<y\> Marble"*, so it flagged *Fishbelly White* against *Miracle White* —
> five false alarms for one real find. Noise teaches people to ignore the panel.

### Answering back

Findings can be answered — *"the pv18 and pv18n is correct. mark it"*, or the
**mark as correct** link. Each finding carries a stable key describing what it is
about (`dupcode:PV18`), so the answer survives edits, reloads and the next import.
**A check that has been answered must never ask again.**

---

## 11. Tests

```bash
npm test                 # 23 checks — LED, end to end in a real browser
npm run test:pvc         # 26 checks — PVC Marble
npm run test:reimport    # re-importing an overlapping PDF (the merge)
npm run test:export-all  # every catalogue in one PDF — page counts must add up
npm run test:keep-pages  # detail pages kept whole, in order, codes intact
npm run test:bot-upload  # the assistant hands a file over; review still happens
npm run test:cancel      # a cancelled import really stops the server
npm run test:reconcile   # 19 checks — the merge logic, no browser
npm run test:ingest-ui   # the import dialog, including the no-key path
npm run test:ingest-free # the whole pipeline on the real PDF, zero API calls
npm run test:spec        # the data-driven engine against both layouts
npm run test:readers     # the rule readers, page by page
npm run test:reflow      # pagination against the client's storyboards
npm run test:geometry    # asset cutting, no API key needed
```

---

## 12. Working on this

- **Uploads are the workflow.** Products get in by uploading a PDF or an image.
  Manual entry exists for corrections; do not make it the main path again.
- **Never bypass the review step**, and never route a category silently — including
  for AI extraction. The evidence must stay visible.
- **IndexedDB stays.** Some older browser tests still poke `localStorage` and are
  stale because of it. Update those tests; do not revert the storage to satisfy them.
- **Restart the Express server yourself** after any change under `server/`. Vite
  hot-reloads the browser only, and in-process tests passed for hours once while the
  real upload was broken — prove ingest fixes through `/api/ingest`.
- **Measure, do not eyeball.** Every geometry number came from scanning a 400 DPI
  render for content bands and ink runs. The one time boundaries were estimated by
  eye, a `10mm` label became `0mm`.
- **Verify before claiming.** Run the suite. If something fails, find out *why*
  first — a download check once failed because of a malformed path in the *test*,
  not a bug in the app, and "fixing" the app would have been a fake fix.
- **Shell quoting on this machine.** Bash heredocs and `node -e` with backticks or
  template literals get mangled badly enough to corrupt files — it damaged the
  README and several source files. **Use the Write/Edit tools** for anything
  containing backticks, `${...}` or escapes, and `node --check` after shell edits.

---

## 13. Not built

- **Multi-user accounts / login.** The client's scope says a hosted web app several
  people log into; it is currently **single-user, with everything in one browser**
  (see the next bullet for where). Blocked on the client choosing: a new Supabase
  project (**costs money — never create one without explicit approval**) or the
  existing `Ai Vizualizer - Geometra` project.
- **Server-side storage.** Products and uploaded images live in the browser — now in
  **IndexedDB** (`src/lib/store.js`), not `localStorage`. They are still on one
  machine, in one browser profile, and are lost if site data is cleared.

  > **This was a real data loss, not a hypothetical.** `localStorage` caps the whole
  > site at about 5 MB. Product photos are stored as base64, so PVC Marble alone
  > reached 3.9 MB. The next import had nowhere to go: `setItem` threw
  > `QuotaExceededError`, the `catch {}` swallowed it, and 23 imported products
  > disappeared on the next reload — while their 0.8 MB page header, small enough to
  > fit, stayed behind. The screen said nothing.
  >
  > Three things changed, and all three matter:
  > 1. **IndexedDB** — no 5 MB cap (10 GB quota on this machine). Existing
  >    `localStorage` data is migrated across once, automatically.
  > 2. **A failed save is shown**, never swallowed. `store.js` throws; `App.jsx`
  >    prints `NOT SAVED — <catalogue>: <reason>`.
  > 3. **Nothing saves before the load finishes** (`hydrated`). Reading is now
  >    asynchronous, and the first render would otherwise write an EMPTY catalogue
  >    over a full one — which is exactly what stamped `[]` over those products.

  Verified in the browser: a 6.58 MB catalogue writes and reads back byte-identical,
  and `localStorage` dropped from 4.73 MB to 16 bytes after migration.
- **Reproducing an arbitrary printed design.** Reading is general: named layouts,
  then the photo grid, then AI. **Printing** is not — LED and PVC Marble have
  bespoke templates, and every other family gets the default page (§7). A catalogue
  whose printed design must be reproduced exactly still needs a template written in
  `src/components/`.
- **The AI reader path has never run.** No `ANTHROPIC_API_KEY` on this machine, so
  the fallback is untested against real model output. The local readers are proven.
