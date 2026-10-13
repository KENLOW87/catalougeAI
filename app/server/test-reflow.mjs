import { SEED, TYPE_A, TYPE_B } from '../src/lib/model.js'
import { paginate, orderedProducts, isTinted } from '../src/lib/paginate.js'

const show = (label, products) => {
  const pages = paginate(products)
  console.log(`\n=== ${label} ===`)
  console.log(`${orderedProducts(products).length} products -> ${pages.length} page(s)`)
  for (const pg of pages) {
    console.log(`  PAGE ${pg.index}${pg.index === 1 ? '  (header + gallery + footer)' : '  (header only)'}`)
    pg.rows.forEach((row, i) => {
      console.log(`    row ${i + 1}: ` + row.map(p => `${p.slot}:${p.name}${isTinted(p.slot) ? '*' : ' '}`).join('  '))
    })
    pg.blocks.forEach(b => {
      console.log(`    block : ${b.slot}:${b.name}${isTinted(b.slot) ? '*' : ' '}  [${(b.finishes ?? []).map(f => f.name).join(', ')}]`)
    })
  }
}

const mkA = n => ({ id: `x${n}`, type: TYPE_A, name: n, colour: 'Silver', length: '3000mm', photo: 'x', drawing: 'x' })
const mkB = n => ({ id: `y${n}`, type: TYPE_B, name: n, colour: 'Black', length: '3000mm', drawing: 'x', finishes: [{ id: 'z', name: 'Black', photo: 'x' }] })

show('ORIGINAL — as extracted from your PDF', SEED)

// Storyboard 2: delete a middle product, everything after shifts up and renumbers.
show('STORYBOARD 2 — delete Led -170 (#2)', SEED.filter(p => p.name !== 'Led -170'))

// Storyboard 1: add new products.
show('STORYBOARD 1 — add 2 standard products', [...SEED, mkA('Led -220'), mkA('Led -240')])

// The rule: Type A wraps below, pushing the featured block to a later page.
show('Add 6 standard — Type A wraps, Led - 08 pushed to page 2',
  [...SEED, ...['A7','A8','A9','A10','A11','A12'].map(mkA)])

// A second featured product goes onto a further page with the same structure.
show('Add a second featured product', [...SEED, mkB('Led - 09')])

show('Scale test — 26 standard + 3 featured',
  [...Array.from({ length: 26 }, (_, i) => mkA(`A${i + 1}`)), ...Array.from({ length: 3 }, (_, i) => mkB(`B${i + 1}`))])
