// Regression for the shared photo-grid detector.
//
// Two adjacent ordinary cards can touch through a shadow/anti-aliased edge and
// become one connected image component. The detector must split that component
// when the surrounding grid proves that it contains two normal cells, while
// leaving a genuinely wide hero card alone when it has no same-row peer.

import assert from 'node:assert/strict'
import { findBlockAnchors } from './readers/spec.mjs'

const width = 840
const height = 1188
const data = new Uint8ClampedArray(width * height * 4)
for (let i = 0; i < data.length; i += 4) {
  data[i] = 255
  data[i + 1] = 255
  data[i + 2] = 255
  data[i + 3] = 255
}

const fill = (x0, y0, x1, y1, rgb = [80, 80, 80]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
  }
}

// Four ordinary cards establish the page pitch.
for (const x of [50, 213, 376, 539]) fill(x, 180, x + 160, 480)

// The lower row contains one ordinary card and two cards that touch through a
// narrow connected shadow. Visually these are three products, not two.
fill(50, 600, 210, 900)
fill(213, 600, 373, 900)
fill(376, 600, 536, 900)
fill(373, 600, 376, 900) // connected edge between the last two cards

const page = { width, height, data }
const boxes = findBlockAnchors(page, {
  type: 'blocks', minSizeMm: 25, minFill: 0.62, maxWidthFrac: 0.5,
})

assert.equal(boxes.length, 7, 'four top cards plus three lower cards are detected')
assert.deepEqual(
  boxes.filter(b => b.y > 500).map(b => [b.x, b.w]),
  [[50, 160], [213, 160], [376, 160]],
  'the connected lower component is split back into its two grid cells',
)

// A single wide card is a real hero and must remain one product.
const hero = { width, height, data: new Uint8ClampedArray(data) }
hero.data.fill(255)
for (let y = 600; y < 900; y++) for (let x = 50; x < 450; x++) {
  const i = (y * width + x) * 4
  hero.data[i] = hero.data[i + 1] = hero.data[i + 2] = 80
}
const heroBoxes = findBlockAnchors(hero, {
  type: 'blocks', minSizeMm: 25, minFill: 0.62, maxWidthFrac: 0.5,
})
assert.ok(heroBoxes.some(b => b.y > 500 && b.w > 300), 'a lone wide hero remains intact')

console.log('all block-anchor splitting checks passed')
