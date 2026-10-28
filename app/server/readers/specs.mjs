// The built-in layouts, expressed as DATA.
//
// These are the same two templates the hand-written readers cover, but as specs the
// engine interprets. They ship as examples and as a safety net: a layout taught
// through the UI has exactly this shape, so anything the built-ins can do, a
// user-taught layout can do too.
//
// All boxes are millimetres relative to the top-left of the product's anchor badge.

// Reviewed rectangles belong to a recognized source layout, in millimetres.
// They are not post-import overrides keyed by the catalogue's product names.
const rect=(x,y,w,h)=>({x:x*210/827,y:y*210/827,w:w*210/827,h:h*210/827})
const usage=(x,y,w,h,caption='')=>({box:rect(x,y,w,h),caption,role:'usage'})
export const BUILTIN_SPECS = [
  {
    // These pages are catalogue material, but contain no product cards. They
    // stay in the exported flow as whole pages and must never trigger AI OCR.
    id: 'wainscoting-non-product-pages',
    title: 'Wainscoting cover / comparison / installation',
    builtin: true,
    nonProductPages: [1, 2, 6],
    nonProductEvidence:{1:[/WAINSCOTING/,/POLYSTYRENE/],2:[/WAINSCOTING/,/COMPARISON/],6:[/INSTALLATION/,/BASICSTEPS|REQUIREDTOOLS/]},
  },
  {
    // Page 7 is a two-card feature sheet. The left side of each row is the
    // actual Wave Crystal Brick product; the remaining photos are installed /
    // showroom examples and must not become extra products.
    id: 'wainscoting-wave-crystal-brick',
    title: 'Wainscoting Wave Crystal Brick',
    builtin: true,
    anchor: { type: 'fixed', pages: [7], boxes: [
      // The product photo is the small left-hand object, not the whole feature
      // row. Keep the card anchor broad enough for the printed caption, while
      // the per-row photo boxes stop before the showroom photos on the right.
      { x: 5, y: 28, w: 82, h: 72 },
      { x: 5, y: 102, w: 82, h: 72 },
    ] },
    kinds: [{ id: 'wave-crystal-fixed', examplesByAnchor:[
      [usage(300,128,241,245),usage(546,128,241,245)],
      [usage(300,421,241,244),usage(546,421,241,244)],
    ], fields: [
      { key: 'name', type: 'text', required: true,
        valueByAnchor: ['Wave Crystal Brick (Full)', 'Wave Crystal Brick (End)'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'subtitle', type: 'text', required: true, matches: /\d+\s*mm/i,
        valueByAnchor: ['200mm x 50mm(T) x 100mm', '100mm x 50mm(T) x 100mm'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'photo', type: 'photo', source: true, boxByAnchor: [
        { x: 6, y: 3, w: 55, h: 46 },
        { x: 14, y: 3, w: 38, h: 45 },
      ], box: { x: 6, y: 3, w: 55, h: 46 } },
    ] }],
  },
  {
    // Page 10 has two named positions of the same Half Moon Mirror. The lower
    // four photos are lighting examples, not separate products.
    id: 'wainscoting-half-moon-mirror',
    title: 'Wainscoting Half Moon Mirror',
    builtin: true,
    anchor: { type: 'fixed', pages: [10], boxes: [
      { x: 1, y: 28, w: 102, h: 126 },
      { x: 107, y: 28, w: 102, h: 126 },
    ] },
    kinds: [{ id: 'half-moon-fixed', fields: [
      { key: 'name', type: 'text', required: true,
        valueByAnchor: ['HM01 RIGHT', 'HM01 LEFT'], box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'subtitle', type: 'text', required: true, matches: /\d+\s*mm/i,
        valueByAnchor: ['700mm (W) x 1400mm (L)', '700mm (W) x 1400mm (L)'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'photo', type: 'photo', source: true, preserveScene: true, box: { x: 0, y: 12, w: 102, h: 112 } },
    ] }],
  },
  {
    // Page 8 has three mirror cards in one left column. M03 is pale enough that
    // the generic block detector can lose it, while the red review circles mark
    // the adjacent technical drawings. Keep all three cards and drawings as a
    // page-specific, exact layout.
    id: 'wainscoting-mirror-cards',
    title: 'Wainscoting mirror cards (M01-M03)',
    builtin: true,
    anchor: { type: 'fixed', pages: [8], boxes: [
      { x: 5, y: 27, w: 48, h: 85 },
      { x: 5, y: 118, w: 48, h: 85 },
      { x: 5, y: 210, w: 48, h: 85 },
    ] },
    kinds: [{ id: 'mirror-fixed', examplesByAnchor:[
      [usage(553,108,250,146),usage(553,264,250,148)],
      [usage(553,423,250,290)], [usage(553,728,250,430)],
    ], fields: [
      { key: 'name', type: 'text', required: true,
        valueByAnchor: ['M01 Full Mirror', 'M02 Quater Mirror', 'M03 Half Mirror'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'subtitle', type: 'text', required: true, matches: /\d+\s*mm/i,
        valueByAnchor: ['304mm x 304mm', '215mm x 215mm', '304mm x 304mm'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key:'photo',type:'photo',source:true,absolute:true,boxByAnchor:[rect(45,217,145,136),rect(60,604,125,101),rect(45,935,150,132)] },
      { key:'drawing',type:'lineart',absolute:true,boxByAnchor:[rect(260,174,225,200),rect(260,540,190,180),rect(258,887,233,233)] },
    ] }],
  },
  {
    // Preserve the already approved Flat Bar/display pairing on recognized
    // uploads. The printed white title is checked before these source crops run.
    id:'wainscoting-flat-bar-display',title:'PS Flat Bar with its original installation display',builtin:true,augment:true,
    anchor:{type:'fixed',pages:[3],boxes:[rect(35,865,414,289)]},
    kinds:[{id:'flat-bar-display',examplesByAnchor:[[usage(455,865,354,289,'Pemasangan PS FLAT BAR')]],fields:[
      {key:'name',type:'text',required:true,valueByAnchor:['PS FLAT BAR'],codeByAnchor:['PSFLATBAR'],
        codeEvidenceByAnchor:[{box:{x:14,y:0,w:84,h:11},lightText:true}],box:{x:0,y:0,w:1,h:1}},
      {key:'subtitle',type:'text',required:true,valueByAnchor:['40mm (W) x 15mm (H) x 3000mm (L)'],box:{x:0,y:0,w:1,h:1}},
      {key:'photo',type:'photo',source:true,absolute:true,box:rect(35,865,414,289)},
    ]}],
  },
  {
    // Page 4 corner-edge profiles are feature diagrams rather than photo blocks.
    id: 'wainscoting-corner-edge',
    title: 'Wainscoting corner-edge profiles (C-R80/C-R100)',
    builtin: true,
    augment: true,
    anchor: { type: 'fixed', pages: [4], boxes: [
      { x: 104, y: 88, w: 96, h: 42 },
      { x: 104, y: 132, w: 96, h: 55 },
    ] },
    kinds: [{ id: 'corner-edge', layoutPairGroup:'aluminium-corners', layoutFullRow:true, fields: [
      { key: 'name', type: 'text', required: true,
        valueByAnchor: ['C-R80', 'C-R100'], box: { x: 55, y: 0, w: 40, h: 12 } },
      { key: 'size', type: 'text', required: true, matches: /\d+\s*mm/i,
        valueByAnchor: ['115mm', '143mm'], box: { x: 0, y: 0, w: 1, h: 1 } },
      {key:'photo',type:'photo',source:true,absolute:true,boxByAnchor:[rect(67,602,57,131),rect(144,568,55,165)]},
      {key:'drawing',type:'lineart',absolute:true,boxByAnchor:[rect(463,394,326,144),rect(452,572,343,161)]},
    ] }],
  },
  {
    id:'wainscoting-csw-complete',title:'Complete CSW corner profiles and measurements',builtin:true,augment:true,
    anchor:{type:'fixed',pages:[4],boxes:[rect(48,154,248,167),rect(311,158,273,163)]},
    kinds:[{id:'csw-complete',layoutPairGroup:'csw-corners',layoutFullRow:true,fields:[
      {key:'name',type:'text',required:true,valueByAnchor:['CSW - Coner Solid Wainscoting','CSW - Coner Wainscoting'],codeByAnchor:['CSW','CSW'],requiredTextByAnchor:['SOLID','WAINSCOTING'],
        codeEvidenceByAnchor:[{box:{x:11.5,y:0,w:21,h:10},lightText:true},{box:{x:13,y:-.7,w:22,h:9},lightText:true}],box:{x:0,y:0,w:1,h:1}},
      {key:'subtitle',type:'text',required:true,valueByAnchor:['60mm (W) x 60mm (H) x 2440mm (L) / 3000mm (L)','89mm (W) x 31mm (H) x 2440mm (L) / 3000mm (L)'],box:{x:0,y:0,w:1,h:1}},
      {key:'photo',type:'photo',source:true,absolute:true,boxByAnchor:[rect(73,190,91,125),rect(312,194,133,99)]},
      {key:'drawing',type:'lineart',absolute:true,boxByAnchor:[rect(170,197,122,119),rect(438,193,145,119)]},
    ]}],
  },
  {
    // CW02-CW04 each combine a top product card with its matching drawing below.
    id: 'wainscoting-corner-flower',
    title: 'Wainscoting corner flowers (CW02-CW04)',
    builtin: true,
    augment: true,
    anchor: { type: 'fixed', pages: [5], boxes: [
      { x: 5, y: 166, w: 54, h: 90 },
      { x: 76, y: 166, w: 54, h: 90 },
      { x: 147, y: 166, w: 54, h: 90 },
    ] },
    kinds: [{ id: 'corner-flower-fixed', examplesByAnchor:[
      [{...usage(10,1047,105,110,'Pemasangan CW02'),displayWithProductCode:'WB06',relatedProductCodes:['WB06','CW02']}],
      [{...usage(413,1047,97,110,'Pemasangan CW03'),displayWithProductCode:'WB06',relatedProductCodes:['WB06','CW03']}],[],
    ], fields: [
      { key: 'name', type: 'text', required: true,
        valueByAnchor: ['CW02', 'CW03', 'CW04'], box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'subtitle', type: 'text', required: true, matches: /\d+\s*mm/i,
        valueByAnchor: ['172mm x 172mm x 35mm', '172mm x 172mm x 20mm', '147mm x 147mm x 12mm'],
        box: { x: 1, y: 1, w: 1, h: 1 } },
      { key: 'photo', type: 'photo', box: { x: 1, y: 10, w: 52, h: 35 } },
      { key:'drawing',type:'lineart',absolute:true,boxByAnchor:[rect(18,850,268,181),rect(299,850,271,181),rect(575,850,238,181)] },
    ] }],
  },
  {
    id:'wainscoting-bendable-profiles',title:'Wainscoting bendable profiles (WB01/WB02/WB05/WB06)',builtin:true,
    anchor:{type:'fixed',pages:[5],boxes:[{x:5,y:30,w:43,h:76},{x:57,y:30,w:43,h:76},{x:110,y:30,w:40,h:76},{x:161,y:30,w:42,h:76}]},
    kinds:[{id:'bendable-profiles',layoutRowGroup:'wains-bendable-profiles',
      supportStripByAnchor:[rect(20,437,775,180),null,null,rect(10,1047,805,110)],
      supportCaptionByAnchor:['WB01','','','Contoh pemasangan WB06 bersama CW02 / CW03'],examplesByAnchor:[
      [usage(20,437,422,135),usage(448,437,75,135),{...usage(527,437,122,135),role:'supplementary'},usage(654,437,141,135)],
      [],[],[usage(134,1047,260,110,'Pemasangan WB06 dengan CW02'),usage(530,1047,285,110,'Pemasangan WB06 dengan CW03')],
    ],fields:[
      {key:'name',type:'text',required:true,valueByAnchor:['WB01','WB02','WB05','WB06'],box:{x:0,y:0,w:1,h:1}},
      {key:'subtitle',type:'text',required:true,valueByAnchor:['40mm (W) x 17mm (H) x 5100mm (L)','30mm (W) x 13mm (H) x 5100mm (L)','22mm (W) x 10mm (H) x 5090mm (L)','30mm (W) x 10mm (H) x 5120mm (L)'],box:{x:0,y:0,w:1,h:1}},
      {key:'photo',type:'photo',source:true,absolute:true,boxByAnchor:[rect(29,151,147,224),rect(256,154,122,223),rect(466,155,92,224),rect(657,155,119,223)]},
    ]}],
  },
  {
    // Page 9 is a special mirror layout: the M04 and M05 cards are surrounded
    // by diagrams and red review boxes, so connected-component photo detection
    // splits them apart. Use the measured card positions only on that page.
    id: 'wainscoting-mirror-folded',
    title: 'Wainscoting mirror cards (M04/M05)',
    builtin: true,
    anchor: {
      type: 'fixed',
      pages: [9],
      boxes: [
        { x: 6, y: 27, w: 54, h: 98 },
        // M05 starts below the separator, at about 198mm. The old 155mm
        // anchor crossed the bottom of M04 and made its photo crop include
        // M04's note plus the top of M05.
        { x: 6, y: 198, w: 54, h: 96 },
      ],
    },
    kinds: [{
      id: 'mirror-folded-card',
      examplesByAnchor:[
        [usage(435,94,203,188,'Folded to the left'),usage(435,286,203,186,'Folded to the right'),usage(435,478,203,241,'Fully folded'),usage(24,489,213,250,'This mirror uses a strong glue sticker on the back.')],
        [usage(435,754,127,194,'This mirror can be folded to 2 parts backwards'),usage(435,953,127,207,'This mirror can be folded to 4 parts backwards'),usage(258,959,154,201,'This mirror uses a strong glue sticker on the back.')],
      ],
      label: 'M04/M05 card',
      fields: [
        { key: 'name', type: 'text', required: true,
          valueByAnchor: ['M04 Full Diamond Mirror', 'M05 Bronze Brick Mirror'],
          box: { x: 4, y: 1, w: 47, h: 22 } },
        { key: 'subtitle', type: 'text', lightText: true, required: true,
          valueByAnchor: ['300mm x 300mm', '300mm x 300mm'], matches: /\d+\s*mm/i,
          box: { x: 3, y: 1, w: 48, h: 1 } },
        { key: 'photo', type: 'photo', boxByAnchor: [
          { x: 3, y: 25, w: 48, h: 60 },
          // M05 has a taller title block than the fixed box used by M04.
          // Start below the title and stop above the printed size caption.
          { x: 3, y: 32, w: 48, h: 46 },
        ], box: { x: 3, y: 25, w: 48, h: 60 } },
        {key:'drawing',type:'lineart',absolute:true,boxByAnchor:[rect(250,212,170,211),rect(249,773,171,171)]},
      ],
    }],
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
    // Two UNRELATED card shapes share this one page's block anchors: the ordinary
    // numbered panel (PW01, GOLD PW02) and the wider "CSW" corner-profile card
    // (badge + big word + description beside it, photo and line-art diagram side
    // by side instead of stacked, a single dimension caption instead of two). They
    // cannot be told apart by position or count the way LED's grid-row/featured
    // split can — neither kind declares `when`, so the engine tries both against
    // every anchor and keeps whichever one's required fields actually held up.
    kinds: [
      {
        id: 'standard',
        label: 'coded panel (PW/GOLD)',
        fields: [
          // Light text on the panel's own background — the opposite of what OCR
          // expects, so this one field asks to be inverted before reading.
          // x starts past the circular badge number (measured: its ink ends at
          // 10.4mm) so the positional badge digit does not land in the name — it is
          // already shown by the catalogue's own numbering, not part of the
          // product's code.
          // w: 0 inherits the BLOCK's own width, not a fixed 33mm — a one-line card
          // ("PW01") and a two-column "hero" card sharing this same spec ("PS FLAT
          // BAR", nearly twice as wide) both need their title read across their own
          // full width, not a box measured for the narrow case and clipped on the
          // wide one ("PS FLAT" with "BAR" cut off).
          //
          // `repair: 'code'` resolves the same letter-O / zero confusion the generic
          // `photo-grid` layout already fixes (PW01 -> PWOT, PW03 -> PWQO3) — this
          // panel layout reads its code from INSIDE the panel instead of a caption
          // band below it, but the OCR confusion is the same, so the repair is too.
          // Titles on this card style print in all capitals ("PW01", "PS FLAT BAR",
          // "GOLD"). Dropping lowercase from the whitelist stops OCR offering it as
          // a candidate at all, which is what fixed "PS Fl AT BAR" (a stray
          // lowercase "l" for "L") — a repair step cannot fix a case mistake after
          // the fact because "l" and "L" are an intentional, not accidental, pair of
          // letters.
          // `joinLines` reads however many lines the title actually is — one
          // ("PW01") or two ("GOLD" stacked over "PW02", read back as "GOLD PW02")
          // — instead of a box sized for one line that clips a second down to a
          // sliver. The box is made tall enough (35mm) to hold two lines of the
          // GOLD cards' noticeably bigger title font; the line-gap/height-ratio
          // guard above stops a one-line card's PHOTO (which starts well past 35mm
          // on every card measured) from being mistaken for a second line.
          // `looseCode` lets the digit repair fire even when OCR misread EVERY
          // digit of a short numbered badge into its look-alike letter at once
          // ("PW01" -> "PWOI", not one real digit left to anchor the repair on) —
          // safe here because every badge on this page really is numbered, and a
          // genuine letters-only name ("CSW") has letters outside the repairable
          // set and so never matches the code shape at all; see the comment in
          // vocab.mjs.
          //
          // No "Q" in the whitelist: no code on this whole catalogue's panel cards
          // starts with or contains one, and at this font/size tesseract
          // occasionally read a doubled "0" glyph ("PW06" -> "PWO06", already fixed
          // by repairCode's own doubled-glyph collapse) as a Q instead — which
          // repairCode correctly refuses to touch, because elsewhere a Q is a real
          // letter (PU Stone's "SQ01"). Taking Q off the menu here removes the
          // wrong reading before it happens.
          { key: 'name', type: 'text', lightText: true, repair: 'code', looseCode: true,
            codeCandidates: ['PW01', 'PW02', 'PW03', 'PW04', 'PW05', 'PW06', 'PW07'], joinLines: true,
            whitelist: 'ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789 ',
            box: { x: 11, y: 0, w: 0, h: 35 } },
          // Measured from the BLOCK'S OWN BOTTOM, not its top: a "hero" card
          // spanning two columns (PS FLAT BAR) has a shorter total block — its
          // photo is more compact — so a caption positioned by a fixed distance
          // from the top landed past the end of the block and found nothing. The
          // caption always sits in the last ~13mm above the bottom edge, on every
          // card regardless of its height.
          //
          // An installation-steps page has photo-sized blocks too (a tools
          // callout, four step photos), and a mixed product page can carry a plain
          // lifestyle photo filling a leftover grid cell (no badge, no caption) —
          // both can clear the generic fill bar by accident. Requiring the caption
          // actually look like one ("NNmm") is what tells a real product card
          // apart from a block that merely has the right shape, the same way PVC
          // Marble's "series" field requires the word "marble" rather than just
          // non-empty text. `required` drops the whole block when this fails,
          // rather than importing it as a nameless product.
          //
          // These two are read BEFORE `photo` (field order matters) so the photo
          // box below can measure itself from where the caption actually landed.
          // BOTH lines are required, not just the first: a card this kind should
          // not match at all (the CSW cards, a dark text-on-light-grey
          // description, not a dimension caption) can land a stray OCR fragment
          // in the first line's box by sheer position and happen to contain "mm"
          // by coincidence — its second line then fails to look like a real
          // caption and gives the mismatch away, so the whole anchor falls
          // through to the "csw" kind below instead.
          { key: 'subtitle', type: 'text', line: 1, matches: /\d+\s*mm/i, required: true, pickMatching: true,
            from: 'blockBottom', box: { x: 0, y: -16, w: 0, h: 17 } },
          // `repair: 'lengthParen'` re-prints the trailing "(L)" literally — on
          // this line it always reads "NNNNmm (L)", but OCR sometimes mistakes
          // the L for a look-alike digit or trails a stray scrap bled in from
          // below the card ("2440mm (1)", "2440mm (L) Hid") — see the comment on
          // repairLengthParen.
          { key: 'third', type: 'text', line: 2, matches: /\d+\s*mm/i, required: true, pickMatching: true,
            repair: 'lengthParen', from: 'blockBottom', box: { x: 0, y: -16, w: 0, h: 17 } },
          // Pinned between the NAME field's own measured bottom and the CAPTION
          // field's own measured top, whatever those turned out to be on this
          // specific card — see the comment above and the `photo` type's handling
          // in spec.mjs.
          { key: 'photo', type: 'photo', topField: 'name', bottomField: 'subtitle',
            box: { x: 0, y: 9, w: 0, h: 63 } },
        ],
      },
      {
        // The Mirror card ("M01 / Full Mirror" .. "M05", "Mirror, Cornering &
        // Mirror" pages 8-9): a dark stone-textured panel, badge + a two-line
        // title (code over a plain-English name, exactly the shape of the GOLD
        // kind's own title) over a photo over a three-line caption ("304mm x
        // 304mm" / "5mm Diamond Mirror" / "+ Bevel" — the overall size, the glass
        // spec, and the edge finish, one per line, every product on both pages).
        // The technical diagram and the big lifestyle photo that sit beside this
        // panel in the actual layout are in SEPARATE columns, not part of this
        // block at all, so unlike the CSW kind there is no neighbouring stray
        // text for the title or caption search to trip over.
        //
        // Placed BEFORE the csw/wb-caption/corner-flower kinds below (which were
        // all written for a different page and so do not actually know this
        // card's shape) deliberately: each of them validates only that ITS OWN
        // required fields produced something non-empty, which is loose enough
        // that a dark-stone Mirror card — printing its own "NNNmm" sizes and its
        // own light-coloured text — satisfied one of them by coincidence before
        // this kind, the one actually written for it, ever got a turn. `mirror`'s
        // own caption match (two bare "NNNmm x NNNmm" numbers side by side, no
        // "(W)"/"(H)" in between) does not fire on any of those other cards'
        // captions, so trying it first costs them nothing.
        id: 'mirror',
        label: 'Mirror panel (dark stone card)',
        fields: [
          // Mixed case, unlike every other kind's title on this whole catalogue —
          // "Full Mirror", "Quater Mirror", "Full Diamond Mirror" print in actual
          // Title Case, not all-capitals. An all-caps whitelist (right for every
          // other card here) made the second line physically impossible for OCR
          // to read correctly — it could not even emit the letters needed —
          // and it came back pure noise ("U M") no matter how the box or OCR mode
          // was adjusted, until lowercase was back on the menu.
          { key: 'name', type: 'text', lightText: true, joinLines: true, required: true,
            whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',
            box: { x: 9, y: 0, w: 0, h: 38 } },
          // `matches` looks for the overall-size line only ("NNNmm x NNNmm") —
          // every real card's caption starts with it, while the lifestyle photo
          // sharing this page's block anchors has no caption at all to confuse it
          // with.
          { key: 'subtitle', type: 'text', lightText: true, joinLines: true, required: true,
            matches: /\d+\s*mm\s*x\s*\d+\s*mm/i,
            from: 'blockBottom', box: { x: 0, y: -23, w: 0, h: 24 } },
          { key: 'photo', type: 'photo', topField: 'name', bottomField: 'subtitle',
            box: { x: 0, y: 38, w: 0, h: 25 } },
          // Technical drawings sit in the adjacent column; keep them with M01-M03.
          { key: 'drawing', type: 'lineart', box: { x: 62, y: 0, w: 48, h: 82 } },
        ],
      },
      {
        // The "CSW" corner-profile card (badges 09-10 on "Wainscoting, Cornering
        // & Mirror" page 4): a landscape panel, not portrait — badge + a big word
        // ("CSW") in light text with a dark descriptive phrase beside it ("- Coner
        // Solid Wainscoting", one line or two depending how long the phrase is),
        // a product photo on the left and a separate line-art dimension diagram
        // on the right (not stacked the way PW/GOLD put photo under title), and
        // ONE two-line dimension caption at the very bottom-right instead of the
        // standard kind's two short lines directly under the photo.
        //
        // Measured on both cards (63.2x42.4mm and 69.5x41.5mm — the two aren't
        // even the same size, so every box uses `w: 0` to reach the block's own
        // right edge rather than a fixed width): the badge's ink ends by 11mm, the
        // bright "CSW" word sits in the first 10mm of height, and the dark
        // description starts around 28mm across — well clear of the badge — and
        // runs one or two lines depending on its length.
        id: 'csw',
        layoutPairGroup:'csw-corners',
        layoutFullRow:true,
        label: 'CSW corner panel',
        fields: [
          // The title is two differently-coloured parts side by side, not stacked
          // — "CSW" in light text on the card's own background, "- Coner Solid
          // Wainscoting" in dark text beside it — so each is read with its own
          // polarity and box and then joined into one name, the same way
          // "PS FLAT BAR" is one name on the standard kind. `required` on the
          // first part only: every real CSW card prints the bright word, so its
          // absence is what tells this kind apart from a PW/GOLD card (which has
          // no light-text word of its own at this position) or a non-product block.
          {
            key: 'name', type: 'text', required: true,
            parts: [
              { lightText: true, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                box: { x: 9, y: 0, w: 36, h: 11 } },
              { lightText: false, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ',
                box: { x: 28, y: -1, w: 0, h: 16 } },
            ],
          },
          // The dimension caption: always two lines ("60mm (W) x 60mm (H) x" /
          // "2440mm (L) / 3000mm (L)"), sitting flush with the card's own BOTTOM
          // edge. A box tall enough to reach it also catches a smaller single-line
          // dimension label belonging to the DIAGRAM above it ("60mm", "89mm") —
          // and the two diagrams are drawn at different heights (an L-bracket vs.
          // an arch), so how far above the caption that stray label sits varies
          // card to card, which rules out a box measured tight enough to simply
          // exclude it.
          //
          // `fromEnd` walks the continuation check backward from the LAST line
          // instead of forward from the first — the caption is what is always
          // flush with the bottom, so anchoring there and growing upward only
          // picks up the stray label if it is close enough to look like a real
          // continuation line, same spirit as the forward check already used for
          // a title. `lineGapMaxMm` is tightened from the 3mm default: measured on
          // this card, the diagram's own label sits a good 2mm+ clear above the
          // caption — enough room to tell "another line of this caption" from
          // "unrelated diagram text".
          //
          // The two lines themselves sit close enough together that no row
          // between them ever drops clear of the ink floor, at any split
          // threshold — there is no gap to split them on, so they measure as ONE
          // band that is genuinely two lines of print. `blockOcr` reads that kept
          // span in block mode in one pass instead of assuming one line per band,
          // which is what actually gets both.
          { key: 'subtitle', type: 'text', joinLines: true, fromEnd: true, blockOcr: true,
            lineGapMaxMm: 1.5, required: true, matches: /\d+\s*mm/i,
            from: 'blockBottom', box: { x: 28, y: -24, w: 0, h: 25 } },
          // Left of the diagram, below the title row. A fixed box (not measured
          // from where the title/caption landed, unlike the standard kind) is
          // enough here — this card's internal layout does not vary the way a
          // one-line/two-line PW title does.
          { key: 'photo', type: 'photo', source:true, box: { x: 0, y: 10, w: 35, h: 32 } },
          // The quarter-round/arch cross-section with its own dimension lines and
          // numbers, printed in the same dark brown as body text — well above the
          // default 185 line-art cut, so no spec-level `inkCut` override is needed.
          { key: 'drawing', type: 'lineart', box: { x: 29, y: 11, w: 0, h: 29 } },
        ],
      },
      {
        // The "WB" card (badges 16-19, "WB01".."WB06" on "Wainscoting, Cornering &
        // Mirror" page 5): same black-gradient panel shape as the standard kind's
        // GOLD cards, a one-line code instead of a two-line title, and a "New"
        // ribbon over the photo's corner that the title box has to measure short
        // enough to miss (one more bright, text-shaped thing for a single-line
        // search box to trip over, the same kind of hazard the standard kind's own
        // title avoids by stopping short of the badge).
        //
        // What actually needed its OWN kind: the caption's two lines sit close
        // enough together that no row between them ever drops under the ink
        // floor, at any threshold — there is no gap to split them on, so they
        // measure as ONE band that is genuinely two lines ("40mm (W) x 17mm (H)" /
        // "x 5100mm (L)"). The standard kind reads its caption as two SEPARATE
        // positional lines, which only works when the page actually gives it two
        // separate bands to find — on this one it does not, and the first line
        // alone stood in for the field, the second simply missing. `blockOcr`
        // reads the kept span in block mode in one pass instead, same fix as the
        // CSW kind's own caption; `fromEnd` keeps it anchored on the caption
        // itself (flush with the card's bottom edge) rather than the product
        // photo's own shadow, which can register as a faint, unrelated band of its
        // own a few millimetres further up.
        id: 'wb-caption',
        label: 'coded panel, single caption block',
        fields: [
          // On ONE of the four cards measured, the badge code's last digit sits
          // close enough to the block's own right edge that `w: 0` (stopping
          // exactly there) clips it — widening the box to compensate instead
          // dragged in enough of the "New" ribbon on the OTHER three cards to
          // break them, a worse trade. `w: 0` stays; the odd single missing
          // digit is the smaller cost.
          { key: 'name', type: 'text', lightText: true, repair: 'code', looseCode: true, joinLines: true,
            required: true,
            whitelist: 'ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789 ',
            box: { x: 11, y: 0, w: 0, h: 12 } },
          // Dark caption text on the card's own light-gradient bottom (the same
          // polarity as the standard kind's caption, NOT the bright title above
          // it) — only the title is light-on-dark on this card style.
          { key: 'subtitle', type: 'text', joinLines: true, fromEnd: true, blockOcr: true,
            lineGapMaxMm: 2, required: true, matches: /\d+\s*mm/i,
            from: 'blockBottom', box: { x: 0, y: -17, w: 0, h: 18 } },
          { key: 'photo', type: 'photo', topField: 'name', bottomField: 'subtitle',
            box: { x: 0, y: 9, w: 0, h: 63 } },
        ],
      },
      {
        // The "Corner Flower" card (badges 20-22, "CW02"/"CW03"/"CW04" on the same
        // page): badge + code + "Material : PVC" all in light text on ONE row (not
        // stacked, and both parts light enough to read as a single box, unlike the
        // CSW kind's two-colour title), an ornate scrollwork photo, and a bold
        // caption naming the PRODUCT TYPE ("Wainscoting Corner Flower") rather than
        // a dimension line — every card on this page shares that exact phrase, so
        // it is what tells a genuine card apart from anything else sharing this
        // page's block anchors (the decorative demo strip, the installed-photo
        // thumbnails at the very bottom of the page, neither of which say it).
        id: 'corner-flower',
        label: 'Corner Flower panel',
        fields: [
          // x stops short of "Material : PVC" so the badge code stays the whole
          // name, the same "name is the code, verbatim" convention every other
          // kind on this page follows.
          // Height stops at 12mm, short of the full 15mm header band: the photo
          // beneath it is bright enough in places (the scrollwork's own highlights)
          // that `inkFromBright` turned them to ink too, and a tall enough box
          // dragged a chunk of sculpted photo into the same single-line OCR pass
          // as the code — confusing it badly enough to drop characters ("CW04"
          // read back "CWO", not a mere letter/digit mix-up repairCode can fix).
          { key: 'name', type: 'text', lightText: true, required: true, repair: 'code', looseCode: true,
            whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            box: { x: 8, y: 0, w: 27, h: 12 } },
          { key: 'subtitle', type: 'text', lightText: true, required: true, matches: /flower/i,
            from: 'blockBottom', box: { x: 0, y: -11, w: 0, h: 12 } },
          // Pinned between where the title and caption actually measured, the same
          // move the standard kind's own photo makes — this card's "New" ribbon
          // sits inside that span too, which is fine: it is really printed there.
          { key: 'photo', type: 'photo', topField: 'name', bottomField: 'subtitle',
            box: { x: 0, y: 15, w: 0, h: 35 } },
        ],
      },
    ],
  },

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
    // LAST RESORT, same anchor shape as `photo-grid-panel` above and so an exact
    // tie on anchor COUNT whenever both match the same page — placed AFTER it in
    // this array so a tie (stable-sorted) favours the more specific panel-card
    // reading first. Measured on "Wainscoting, Cornering & Mirror" page 5: tried
    // first, this one happily read the page's decorative demo strip and
    // installation thumbnails as half-empty "products" (an empty caption still
    // clears `ruleReadIsUsable`'s 0.5-filled bar, because a field with no `matches`
    // of its own accepts ANY one non-blank character) well enough to win outright
    // and pre-empt `photo-grid-panel`'s correct, fully-validated read of the WB/CW
    // cards actually on it. On the LED page the six lifestyle gallery photos would
    // likewise read as product blocks and could outnumber the real products,
    // hijacking a page a specific reader handles correctly — so this one only
    // runs when no more specific layout recognises the page.
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
    // A product marked by nothing but an oversized BOLD HEADING, in a full-width
    // feature block its own paragraph text and diagrams break up too much to ever
    // register as one solidly-filled rectangle — "ALUMINIUM CORNER EDGE" on
    // "Wainscoting, Cornering & Mirror" page 4 holds two of these side by side,
    // "C-R80" and "C-R100", each with its own dimensioned product photo beneath.
    // `findTextBlockAnchors` finds the heading itself by shape (taller than body
    // text, a compact run of ink rather than a paragraph's long one) rather than
    // by colour or fill, which is what a layout like this needs instead of the
    // `blocks` anchor every other spec here uses.
    id: 'wainscoting-feature-heading',
    title: 'Feature block (oversized heading)',
    builtin: true,
    fallback: true,
    anchor: { type: 'textBlocks' },
    fields: [
      // The anchor IS the heading's own bounding box, so the name is read from
      // exactly that box (`w: 0, h: 0` on a `block` anchor inherit its own size)
      // rather than a search region — there is nothing else in it to search for.
      { key: 'name', type: 'text', whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
        box: { x: 0, y: 0, w: 0, h: 0 } },
      // The width figure ("115mm", "143mm") sits in the first text row below the
      // heading, well left of it — the measurement line runs back across most of
      // the diagram. `required` + `matches` is the gate that tells a genuine
      // product heading apart from an ordinary oversized headline elsewhere in the
      // document (this spec has no colour or fill test of its own to lean on):
      // a real one always has a dimension line directly under it, a page title
      // never does.
      //
      // No `line:1` here, deliberately: the measurement line either side of the
      // white "115mm" label is itself a thin run of dark pixels, and on one of the
      // two headings measured it was picked up as its own separate "line" ahead of
      // the real text — OCR-ing the whole box in one pass (the box is already
      // tight enough to hold nothing else) reads the label fine either way, ticks
      // and all, and `matches` only cares that "115mm" is in there somewhere.
      { key: 'size', type: 'text', matches: /\d+\s*mm/i, required: true, repair: 'firstMm',
        from: 'blockBottom', box: { x: -48, y: 2, w: 0, h: 9 } },
      // The whole dimensioned diagram, kept as ONE image rather than parsed apart
      // — it carries several numbers (width, height, material thickness) laid out
      // as a technical drawing, not a caption, the same way LED's own `drawing`
      // field keeps its line-art whole. `lineart`, not `photo`: the panel's
      // background here is a flat mid-grey, not white, so there is no "product
      // blob against white" for `cleanPhoto` to isolate — keeping every dark pixel
      // above the ink cut and trimming to content is what actually works on it.
      { key: 'drawing', type: 'lineart', from: 'blockBottom', box: { x: -48, y: 2, w: 90, h: 34 } },
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
