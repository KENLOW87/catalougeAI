// The built-in layouts, expressed as DATA.
//
// These are the same two templates the hand-written readers cover, but as specs the
// engine interprets. They ship as examples and as a safety net: a layout taught
// through the UI has exactly this shape, so anything the built-ins can do, a
// user-taught layout can do too.
//
// All boxes are millimetres relative to the top-left of the product's anchor badge.

export const BUILTIN_SPECS = [
  {
    // A grid of product photos with a caption under each — the commonest catalogue
    // shape there is, and the one GEOMETRA uses for its sheet products.
    //
    // There is no numbered badge to key off, so products are found by SHAPE: a
    // large, solidly filled rectangle that repeats at a consistent size. The
    // caption is then read from a band directly beneath each block, however big
    // that block happens to be.
    //
    // This layout carries no `category` on purpose: its products belong to
    // whichever catalogue is open when the PDF is imported.
    id: 'photo-grid',
    title: 'Photo grid',
    builtin: true,
    // LAST RESORT. On the LED page the six lifestyle gallery photos would also read
    // as product blocks and could outnumber the real products, hijacking a page a
    // specific reader handles correctly. So this one only runs when no badge-based
    // layout recognises the page.
    fallback: true,
    inkCut: 185,
    // Two caption lines are separated by whatever white the designer left. Measured
    // on PU Stone page 4 the gap between "SQ01" and "Cream" is 0.70 mm — under the
    // old 0.8 mm threshold, so the two lines MERGED into one band. The code line
    // then vanished: the product came through named "Craam" with no description.
    // 0.45 mm splits them and still holds together a single line whose accents or
    // descenders leave a hairline gap.
    lineGapMm: 0.45,
    anchor: {
      type: 'blocks',
      minSizeMm: 25,        // a product photo is at least this big
      minFill: 0.62,        // solid photo, not line art or a text block
      maxWidthFrac: 0.5,    // not a full-width banner
    },
    fields: [
      { key: 'photo', type: 'blockPhoto' },
      // w: 0 means "as wide as the block"; from: 'blockBottom' measures down from it.
      // Line 1 is usually a product code, so OCR is held to letters and digits and
      // cannot emit stray accents; `repair: 'code'` then resolves letter-O / zero
      // confusion in the numeric part.
      //
      // The SPACE matters. Not every catalogue of this shape prints a code — some
      // put the description on line 1 — and without a space in the whitelist OCR
      // physically cannot emit one, so "Fishbelly White Marble" came back as
      // "FishbellyWhiteMarble". `repairCode` leaves anything that is not a code
      // exactly as read.
      { key: 'name', type: 'text', line: 1, from: 'blockBottom', repair: 'code',
        whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',
        box: { x: 0, y: 0.5, w: 0, h: 16 } },
      { key: 'subtitle', type: 'text', line: 2, from: 'blockBottom', box: { x: 0, y: 0.5, w: 0, h: 16 } },
    ],
  },

  {
    // The same photo-grid shape, but for a CARD style where the badge number and
    // product code print INSIDE the panel, above the photo, in light text on the
    // panel's own mid-tone background — not in a caption band below it. The block
    // detector still finds the whole panel as one block (title + photo + caption
    // all share the one solid-filled background), so the fields read INSIDE it
    // instead of searching the gutter below.
    //
    // Measured on "Wainscoting, Cornering & Mirror": across every cell on the page
    // the title band sits at 1.3-7.8mm from the block's top and the two-line
    // dimension caption sits at 77.0-85.5mm of an 88.1mm-tall block — both stable
    // regardless of which product is in the cell. `photo-grid` tries first; this
    // only runs when that one's fields come back empty.
    //
    // Two things vary enough on this same page that a fixed photo box baked the
    // title or the caption straight into the "clean" product shot: a title can be
    // one line ("PW01") or two ("GOLD" / "PW02" stacked), and a card spanning extra
    // columns ("PS FLAT BAR", a hero card) is shorter overall than an ordinary one.
    // The photo box is therefore measured from where the NAME and CAPTION fields
    // actually landed on THIS card (`topField`/`bottomField`), not a fixed offset —
    // see the comment on the `photo` type in spec.mjs.
    id: 'photo-grid-panel',
    title: 'Photo grid (panel card)',
    builtin: true,
    fallback: true,
    anchor: {
      type: 'blocks',
      minSizeMm: 25,
      minFill: 0.62,
      maxWidthFrac: 0.5,
    },
    fields: [
      // Light text on the panel's own background — the opposite of what OCR
      // expects, so this one field asks to be inverted before reading.
      // x starts past the circular badge number (measured: its ink ends at 10.4mm)
      // so the positional badge digit does not land in the name — it is already
      // shown by the catalogue's own numbering, not part of the product's code.
      // w: 0 inherits the BLOCK's own width, not a fixed 33mm — a one-line card
      // ("PW01") and a two-column "hero" card sharing this same spec ("PS FLAT
      // BAR", nearly twice as wide) both need their title read across their own
      // full width, not a box measured for the narrow case and clipped on the wide
      // one ("PS FLAT" with "BAR" cut off).
      //
      // `repair: 'code'` resolves the same letter-O / zero confusion the generic
      // `photo-grid` layout already fixes (PW01 -> PWOT, PW03 -> PWQO3) — this panel
      // layout reads its code from INSIDE the panel instead of a caption band below
      // it, but the OCR confusion is the same, so the repair is too.
      // Titles on this card style print in all capitals ("PW01", "PS FLAT BAR",
      // "GOLD"). Dropping lowercase from the whitelist stops OCR offering it as a
      // candidate at all, which is what fixed "PS Fl AT BAR" (a stray lowercase
      // "l" for "L") — a repair step cannot fix a case mistake after the fact
      // because "l" and "L" are an intentional, not accidental, pair of letters.
      // `joinLines` reads however many lines the title actually is — one
      // ("PW01") or two ("GOLD" stacked over "PW02", read back as "GOLD PW02") —
      // instead of a box sized for one line that clips a second down to a sliver.
      // The box is made tall enough (20mm) to hold two lines of this title size.
      { key: 'name', type: 'text', lightText: true, repair: 'code', joinLines: true,
        whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
        box: { x: 11, y: 0, w: 0, h: 20 } },
      // Measured from the BLOCK'S OWN BOTTOM, not its top: a "hero" card spanning
      // two columns (PS FLAT BAR) has a shorter total block — its photo is more
      // compact — so a caption positioned by a fixed distance from the top landed
      // past the end of the block and found nothing. The caption always sits in the
      // last ~13mm above the bottom edge, on every card regardless of its height.
      //
      // An installation-steps page has photo-sized blocks too (a tools callout, four
      // step photos), and a mixed product page can carry a plain lifestyle photo
      // filling a leftover grid cell (no badge, no caption) — both can clear the
      // generic fill bar by accident. Requiring the caption actually look like one
      // ("NNmm") is what tells a real product card apart from a block that merely
      // has the right shape, the same way PVC Marble's "series" field requires the
      // word "marble" rather than just non-empty text. `required` drops the whole
      // block when this fails, rather than importing it as a nameless product.
      //
      // These two are read BEFORE `photo` (field order matters) so the photo box
      // below can measure itself from where the caption actually landed.
      { key: 'subtitle', type: 'text', line: 1, matches: /\d+\s*mm/i, required: true,
        from: 'blockBottom', box: { x: 0, y: -16, w: 0, h: 17 } },
      { key: 'third', type: 'text', line: 2, matches: /\d+\s*mm/i,
        from: 'blockBottom', box: { x: 0, y: -16, w: 0, h: 17 } },
      // Pinned between the NAME field's own measured bottom and the CAPTION field's
      // own measured top, whatever those turned out to be on this specific card —
      // see the comment above and the `photo` type's handling in spec.mjs.
      { key: 'photo', type: 'photo', topField: 'name', bottomField: 'subtitle',
        box: { x: 0, y: 9, w: 0, h: 63 } },
    ],
  },

  {
    id: 'accessories-led',
    title: 'Accessories ~ LED',
    category: 'accessories-led',
    builtin: true,
    inkCut: 185,                       // black line art
    // LED stacks colour and length ~1.0mm apart, tighter than PVC's lines.
    lineGapMm: 0.45,
    anchor: { rgb: [51, 199, 244], tolerance: 70, arrangement: 'row', minSizeMm: 2, maxSizeMm: 9 },
    // Two kinds of product, laid out completely differently. They are told apart by
    // how many anchors share the band: the grid row has six, the featured block one.
    kinds: [
      {
        id: 'A', label: 'standard', when: { minAnchorsInBand: 2 },
        fields: [
          { key: 'name',    type: 'text', line: 1, box: { x: -0.6, y: 3.6, w: 30, h: 15 } },
          { key: 'colour',  type: 'text', line: 2, box: { x: -0.6, y: 3.6, w: 30, h: 15 } },
          { key: 'length',  type: 'text', line: 3, box: { x: -0.6, y: 3.6, w: 30, h: 15 }, repair: 'length', stripPrefix: 'length' },
          { key: 'photo',   type: 'photo',   box: { x: -0.6, y: 17.1, w: 30, h: 21 } },
          { key: 'drawing', type: 'lineart', box: { x: -0.6, y: 38.5, w: 30, h: 16 } },
        ],
      },
      {
        id: 'B', label: 'featured', when: { maxAnchorsInBand: 1 },
        fields: [
          { key: 'name',   type: 'text', line: 1, box: { x: -0.6, y: 3.8, w: 40, h: 13 } },
          { key: 'colour', type: 'text', line: 2, box: { x: -0.6, y: 3.8, w: 40, h: 13 } },
          { key: 'length', type: 'text', line: 3, box: { x: -0.6, y: 3.8, w: 40, h: 13 }, repair: 'length', stripPrefix: 'length' },
          {
            key: 'finishes', type: 'finishes',
            box: { x: -0.6, y: 15.0, w: 140, h: 25 },
            labelBox: { x: -0.6, y: 36, w: 140, h: 14 },
          },
          { key: 'drawing', type: 'lineart', box: { x: 143, y: 15.0, w: 55, h: 30 } },
        ],
      },
    ],
  },
  {
    id: 'pvc-marble',
    title: 'PVC Marble',
    category: 'pvc-marble',
    builtin: true,
    inkCut: 210,                       // gold line art sits at ~160 luminance
    anchor: {
      rgb: [189, 152, 89], tolerance: 62, arrangement: 'column',
      scanWidthMm: 34,                 // left column only: the PVC MARBLE banner is gold too
      minSizeMm: 3, maxSizeMm: 8,
    },
    // A Ceiling Panel badge is a close enough orange to pass the anchor colour check,
    // and its own "(Ceiling)" caption then lands in the "size" box by sheer position —
    // non-empty, so the default half-the-fields-filled bar let the mismatch through.
    // Every genuine PVC Marble product prints "Size: 9'5" / PVC Marble" in full, so
    // requiring ALL THREE text fields (not just half) costs nothing on a real page.
    minFill: 1,
    fields: [
      { key: 'name',   type: 'text', line: 1, box: { x: -1.5, y: 5, w: 42, h: 24 } },
      { key: 'size',   type: 'text', line: 2, box: { x: -1.5, y: 5, w: 42, h: 24 }, repair: 'size', stripPrefix: 'size' },
      // "series" is the one field every real page prints VERBATIM the same way —
      // "PVC Marble". A mismatched page still lands a stray OCR fragment here ("a",
      // "LE") by sheer box position — usually short, but a long enough fragment of
      // the WRONG page's own text ("Bena.", from a Ceiling-style caption) can clear
      // a character-count floor by pure chance. Requiring the word "marble" is the
      // one check nothing else can satisfy by accident.
      { key: 'series', type: 'text', line: 3, minChars: 4, matches: /marble/i, box: { x: -1.5, y: 5, w: 42, h: 24 } },
      { key: 'drawing', type: 'lineart', box: { x: -11.5, y: 27, w: 54, h: 24 } },
      {
        key: 'variants', type: 'finishes', leftoverKey: 'extra',
        box: { x: 42.5, y: 5, w: 147, h: 40 },
        labelBox: { x: 42.5, y: 40, w: 147, h: 22 },
      },
    ],
  },
]

export const specById = id => BUILTIN_SPECS.find(s => s.id === id)
