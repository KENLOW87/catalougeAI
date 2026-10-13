# Flows — step by step

Every process in the system, in the order you would actually do it. Companion to
`README.md`, which explains *why*; this is *how*.

---

## A. Everyday: edit and export a catalogue

```
1. npm start                    editor :5173, export server :5174
2. The DASHBOARD opens          all 13 families, their counts and any findings
      Download all as PDF       every catalogue that has products, one file
3. Open a family                the editor and its sidebar appear
                                tabs only when a family has more than one catalogue
                                (Accessories → LED / PVC Marble)
4. Edit
      Add from PDF…             the main workflow: a PDF, or one product image
      ✎ on a row or card        edit
      ✕ on a row or card        delete the WHOLE section
      Delete whole catalogue    empty this catalogue and take it off the dashboard
      ↑ ↓ in the sidebar        reorder
5. Download PDF                 this catalogue, named for it
```

**Where each export lives:** *Download PDF* is in the editor sidebar, because it
exports the catalogue you have open. *Download all as PDF* is on the dashboard only,
because it is about every catalogue at once.

**What happens on delete.** One click removes the entire section — name, size,
drawing, every finish, the installed photo. Everything after it slides up, the
numbers close the gap, and products pull backward across page boundaries.

```
before   1 H   2 T   3 END   4 W   5 CORNER   6 L   7 L
delete T
after    1 H   2 END   3 W   4 CORNER   5 L   6 L
                              └─ CORNER pulled from page 2 onto page 1 ─┘
```

**Two levels of delete:**

| Action | Removes |
| --- | --- |
| ✕ on the product | the entire section |
| ✕ inside the edit dialog | just that one colour finish |
| Delete whole catalogue | every section, image, drawing, page header and saved check for the open catalogue |

**Reset to original** restores the category to the catalogue as first extracted.

### Download all as PDF

One file with every catalogue that has products, in the order the families are
published — not one download per category to be merged by hand afterwards.

```
Accessories ~ LED     1 page   ─┐
PVC Marble            2 pages  ─┼─▶  GEOMETRA-Catalogue.pdf   3 pages
PVC Marble Sheet      3 pages  ─┘    (whatever is filled in, in this order)
```

The button names the count, and is greyed out until at least one catalogue has
products. It prints through the **same** exporter as the single download — a
combined file cannot differ from the individual ones.

---

## B. Import products from a PDF

```
1. Add from PDF…
2. Choose a PDF or one product image
3. Wait — the local readers extract and route it
4. Review the suggested destination and products
5. Fix any missing required assets
6. Apply
```

### Choosing the destination

The import checks the page header and product codes/names against the catalogue
families. A clear match is shown before Apply, for example **Accessories ~ LED** or
**PVC Marble Sheet 3D**. An ambiguous match remains in the currently open catalogue
and is marked as needing confirmation; it is never silently assigned to a new one.
Existing category-specific readers remain authoritative.

An image upload follows the same review path. It is read with local OCR, attached as
the product photo, and left as a draft so the admin can correct the name and add a
dimension drawing where that catalogue requires one.

A photo attached straight to the **assistant** (the 📎 button) is a different,
smaller flow: no review dialog, because it is not a new product — it replaces one
existing product's picture. The background is removed in the browser (no upload, no
cost, no API key; see README §10), then the admin names the product in plain text
and the swap is proposed like any other command — the admin still clicks Apply.

### What the reader does per page

```
render page ──▶ round 1: every NAMED layout ──▶ best match wins ──▶ read it
                        │
                        └── none matched ──▶ round 2: the FALLBACK readers
                                                 (photo grid — any grid of
                                                  photos with captions)
                                     │
                                     └── still nothing ──▶ AI reader (needs a key)
                                                            or a clear failure
```

The two rounds matter: a generic reader run alongside the named ones would win races
against the layout that was actually measured for that page.

### A page with no products is KEPT WHOLE

These catalogues open with a cover and a **Wide Range of Application** spread of room
photos, and close with installation steps. None of it is a product table. All of it
is the catalogue.

```
page 1  cover                 -> kept whole   [PAGE]
page 2  room photos           -> kept whole   [PAGE]
page 3+ Product Series grid   -> 8 products per page
```

A kept page prints exactly as it was printed originally — no header of ours over it,
no grid, nothing to reflow inside it. It shows as **full page** in the sidebar, takes
a whole sheet, and does **not** consume a product number, so adding a cover never
renumbers the catalogue. Reorder or delete it like anything else.

A PDF with **no products at all** still imports — its pages come in as pages. Only a
file that yields nothing whatsoever is refused.

> Two wrong answers came before this one. Such a page was first **fatal** (the import
> died on page 1 and never reached the products), then **skipped** — which quietly
> threw away the front page of every catalogue. `npm run test:keep-pages` pins the
> behaviour that was actually wanted.

The progress line names the layout it recognised, e.g.
`Recognised the "PVC Marble" layout (4 products) — reading it locally…`

### The review screen

Three groups. **Nothing is applied until you press Apply.**

| Group | Default | Your options |
| --- | --- | --- |
| Already in the catalogue | kept as-is | take the PDF's version · refresh its images |
| Not in this PDF | **kept**, listed | tick to remove |
| New in this PDF | added, in the PDF's position | untick to skip |

Products missing a photo or a drawing are **blocked** until you upload one.

### The result

Order follows the PDF. Kept-but-absent products sit after the ones the PDF lists.

```
system before   PV1   PV2   PV4
PDF has         PV1   PV2   PV3   PV4
after Apply     PV1   PV2   PV3   PV4
```

---

## C. Start a catalogue for an empty product family

There are 13 product families. Accessories has two sub-catalogues; the other twelve
are empty and **each one simply IS a catalogue**. Filling one takes no setup.

```
1. Category dropdown          pick the family, e.g. "PVC Marble Sheet — empty"
2. Add from PDF…
3. Choose PDF                 the whole catalogue, all its pages
4. Review what it read        every product, page by page
5. Import
```

That is the entire flow. No layout to define, no boxes to drag, no key.

**What happens underneath:** no named layout matches the page, so the second round
runs the **photo grid** reader — it finds the photo blocks by shape, infers the grid
from their edges, and reads the caption lines under each. Everything above the first
block is cropped and kept as the page header, so the printed page carries the
catalogue's own title, banner and size line rather than an invented bar.

The family then prints on the **default template**: a 4-across grid of photos with
the code and description beneath, row heights fitted to the space the real header
leaves.

> **A layout teacher was built and removed.** Dragging boxes to describe a page was
> the client's work, not the system's — *"i build this system for automation, why do
> i need to make more work?"* Do not rebuild it. An unrecognised layout is answered
> by a reader that recognises it automatically, or by the AI fallback (flow E).

### If it reads badly

| Symptom | Usually |
| --- | --- |
| A product is missing | its photo sat under the block-size floor, or the caption ran into the one below |
| The header became product 1 | the banner is being read as a photo block — it should be cut by the width ceiling |
| Text half-cut | the caption is on a line the field did not search — text boxes are search regions, not crops |
| A code has an extra digit (`PV003`) | OCR read one round glyph twice, as both `0` and `O`. Handled — `repairCode` collapses the pair. If a new variant appears, fix it in `vocab.mjs`, never by hand |
| A code reads oddly some other way | repair snaps O/0 and I/1; anything else shows in review, edit it there |

---

## D. Add a whole new category

Two separate jobs. **Reading a catalogue and printing one are not the same thing.**

### D1. Reading — you can do this yourself

Follow **flow C**. That is the whole job for reading, and for most catalogues it is
the whole job full stop: the default template prints them correctly.

### D2. Reproducing a specific printed design — this still needs code

Only when the printed page must match an original design exactly, the way LED and
PVC Marble do. Currently `src/lib/categories/`:

```
src/lib/categories/index.js     the registry — add an entry here
src/lib/categories/pvc.js       geometry, reflow, seed for PVC Marble
src/components/PvcPage.jsx      the page template
src/styles/template.css         its styles
```

A registry entry supplies:

| Key | Is |
| --- | --- |
| `title` | shown on the tab |
| `Page` | the React component that draws a page |
| `paginate` | how products flow onto pages |
| `order` | flow order (LED puts all Type A before Type B) |
| `kinds` | the "+ Add" buttons |
| `kindLabel` | what the sidebar shows next to each product |
| `fields` | drives the add/edit dialog — one dialog serves every category |
| `seed` | the products as first extracted |

**Measure the new template the same way** — render at 400 DPI and scan for content
bands. Do not eyeball it.

```bash
pdftoppm -r 400 -png -f 1 -l 1 "NEW.pdf" .tmp/new
```

Preserve the shared behaviour: positional numbering, positional tint, names
verbatim, drawings never generated.

---

## E. When something needs the API key

The key is now needed for **less** than it used to be. A page no layout recognises is
kept whole as a page (flow B), so a cover, a gallery or an instruction sheet costs
nothing and needs no key.

What a key still buys is **products out of a layout the system does not know**. With
no key, such a page comes in as a picture rather than as editable products.

```
Nothing could be read from any of the 2 page(s).

What each layout made of each page:
Page 1: Accessories ~ LED: 0 found · PVC Marble: 1 found, 1 read, but the layout's
        own fields came back empty · Photo grid: 0 found
```

That message now means a file nothing at all could be made of — not even a page
worth keeping. It **fails loudly rather than guessing**: for a published catalogue a
clear failure is safer than a confident wrong answer.

Two ways forward:

1. **Set a key** — works immediately, ~2–5¢ per page.
2. **Add a spec** for that layout in `server/readers/specs.mjs` — free and permanent
   from then on. This is developer work, deliberately: describing a page is the
   system's job, never the user's.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # this session only
setx ANTHROPIC_API_KEY "sk-ant-..."       # permanent — then open a NEW terminal
npm run server
```

Get one from <https://console.anthropic.com> → add credit → Settings → API Keys.
**A Claude Pro/Max subscription does not include API access** — separate billing.
Never paste the key into a file in this project.

The server says which state it is in on startup:

```
readers        Accessories ~ LED, PVC Marble, Photo grid
AI fallback    no ANTHROPIC_API_KEY — unknown layouts will fail
```

---

## F. The assistant — checking and asking

The bubble in the bottom-right corner opens the chat window. It is always there.

```
1. Click the bubble            a red badge shows how many problems are outstanding
2. Upload PDF/image            the same review screen as the sidebar button
3. Quality check               the whole catalogue, reported into the chat
4. show these 2                flags the offending products in the sidebar
5. Ask anything                "how many products?"  "which have no photo?"
6. Tell it what to do          "delete PV07"  "move PV12 up"  "download pdf"
```

**Upload is in the panel because uploading is the main workflow** and the assistant
is always within reach. It opens the ordinary review dialog — destination, evidence,
every draft — so the assistant is a faster way in, **never a way round**. Nothing an
upload produces is saved without that review, AI extraction included.

**Press "What can I say?"** for the full list of phrases. Clicking one puts it in the
box — it is not sent until you press Send.

### Nothing changes without a click

| You say | What happens |
| --- | --- |
| `delete PV07` | a card: *"Delete PV07? This removes the WHOLE product…"* → **Yes, delete it** / **No, leave it** |
| `rename PV07 to PV7`, `move PV12 up` | proposed the same way |
| `download pdf`, `run a quality check`, `show me PV06`, `add a product` | happens at once — nothing is altered |

### Telling it a finding is correct

`PV18` and `PV18N` are a real matte/gloss pair, not a duplicate. Say so:

```
you: the pv18 and pv18n is correct. mark it
bot: Noted — "PV18 and PV18N share the code PV18" is correct.
     I will not raise it again.                              [undo]
```

Or press **mark as correct** on the finding. The answer is remembered per catalogue
and survives edits, reloads and the next import — an answered check never asks again.

### With and without an API key

Everything above is free and runs in the browser. A key only adds free-form wording
and judgement ("is `Pasific Grey` a typo?"). Each answer says which engine replied —
*from your data* or *answered by AI* — so you always know whether anything was spent.

---

## G. Re-extracting the seed assets

Only if the source PDF changes. Both scripts are re-runnable.

```bash
cd app
node server/extract-pvc.mjs          # 42 PVC assets
node server/extract-pvc-chrome.mjs   # PVC headers, badge painted out
```

LED assets were cut with `normalize-assets.mjs`, `normalize-lineart.mjs`, `trim.mjs`
and `keep-largest.mjs` — see `README.md` § 9 for what each does and the traps.

---

## H. Before saying anything works

```bash
npm test                 # LED, in a real browser
npm run test:pvc         # PVC Marble
npm run test:reimport    # the merge on re-import
npm run test:export-all  # every catalogue in one PDF, page counts add up
npm run test:keep-pages  # detail pages kept whole, in order, codes intact
npm run test:bot-upload  # upload from the assistant, in a real browser
npm run test:cancel      # a cancelled import really stops the server
npm run test:reconcile   # merge logic, fast, no browser
npm run test:ingest-ui   # the import dialog
npm run test:ingest-free # whole pipeline, zero API calls
```

If a check fails, **find out why before changing anything.** One failure here turned
out to be a malformed path in the test, not a bug in the app — changing the app
would have been a fake fix.
