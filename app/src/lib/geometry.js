// Page geometry, in millimetres, measured directly off the source PDF.
//
// Measured by scanning the 400 DPI render for content bands rather than by eye:
//   header        0.0 -  27.5
//   gallery      27.5 - 164.1
//   type A strip 165.7 - 220.9   (badge 165.7, name 171.3, colour 176.0, length 179.1, panel 182.8)
//   type B block 225.8 - 271.8
//   footer       275.1 - 288.4
//
// NOTE ON THE GRID: the six columns in the original are NOT evenly spaced -- the
// measured pitch runs 31.9, 34.0, 35.1, 35.6, 37.2 mm. The page was laid out by
// hand. A reflowing catalogue cannot use hand-placed slots, so the template below
// imposes an even 6-column grid. The rebuilt page is therefore very slightly more
// regular than the original.

export const PAGE = { w: 210, h: 297 }

export const CHROME = {
  headerH: 27.5,
  galleryTop: 27.5,
  galleryH: 136.6,
  footerTop: 275.1,
  footerH: 13.5,
}

export const GRID = {
  marginX: 5.14,        // measured from the left edge of badge #1
  columns: 6,
  get contentW() { return PAGE.w - this.marginX * 2 },
  get colW() { return this.contentW / this.columns },
}

// A single Type A cell, top-down, relative to the row top.
export const CELL_A = {
  badgeTop: 0,     badgeH: 4.4,
  nameTop: 5.6,    nameH: 3.5,
  colourTop: 10.3, colourH: 2.1,
  lengthTop: 13.4, lengthH: 2.5,
  panelTop: 17.1,  panelH: 37.0,
  get rowH() { return this.panelTop + this.panelH },   // 54.1mm
}

export const BLOCK_B = {
  badgeTop: 0,     badgeH: 4.1,
  nameTop: 5.7,    nameH: 3.1,
  colourTop: 9.2,  colourH: 2.1,
  lengthTop: 12.3, lengthH: 1.5,
  panelTop: 14.7,  panelH: 31.3,
  get blockH() { return this.panelTop + this.panelH },  // 46.0mm
}

// Vertical space available for products.
// Page 1 carries the gallery, so it has far less room than a continuation page.
export const FLOW = {
  page1Top: 165.7,
  page1Bottom: 275.1,      // the footer starts here
  contTop: 33.0,           // continuation pages keep the header, drop the gallery
  contBottom: 288.4,
  rowGap: 1.0,             // between two Type A rows
  blockGap: 3.0,           // before a Type B block
  get page1H() { return this.page1Bottom - this.page1Top },
  get contH() { return this.contBottom - this.contTop },
}
