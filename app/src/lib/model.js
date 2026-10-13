// Product model for the "Accessories ~ LED" category.
//
// Two product types, taken from the original catalogue:
//   A = standard item  -> one finish, sits in the 6-across grid strip
//   B = featured item  -> several finishes, rendered full width
//
// Names are stored EXACTLY as printed in the catalogue, including the uneven
// spacing around the dash ("Led -160" vs "Led - 508"). That inconsistency is in
// the source and the client asked for it to be preserved verbatim.

export const TYPE_A = 'A'
export const TYPE_B = 'B'

export const CATEGORY = {
  id: 'accessories-led',
  title_en: 'Accessories ~ LED',
  title_zh: 'LED 线性铝灯槽',
  tagline_zh: '创意装饰点亮空间艺术',
}

let nextId = 100
export const newId = () => `p${nextId++}`

export const blankProduct = (type = TYPE_A) => ({
  id: newId(),
  type,
  name: '',
  colour: '',
  length: '3000mm',
  photo: null,
  drawing: null,
  finishes: type === TYPE_B ? [] : undefined,
})

export const blankFinish = () => ({ id: newId(), name: '', photo: null, badge: 'New' })

// The 7 products the AI extracted from page 1 of the source PDF.
export const SEED = [
  { id: 'p1', type: TYPE_A, name: 'Led -160', colour: 'Silver', length: '3000mm',
    photo: '/assets/products/led-160.png', drawing: '/assets/drawings/led-160.png' },
  { id: 'p2', type: TYPE_A, name: 'Led -170', colour: 'Silver', length: '3000mm',
    photo: '/assets/products/led-170.png', drawing: '/assets/drawings/led-170.png' },
  { id: 'p3', type: TYPE_A, name: 'Led -195', colour: 'Black', length: '3000mm',
    photo: '/assets/products/led-195.png', drawing: '/assets/drawings/led-195.png' },
  { id: 'p4', type: TYPE_A, name: 'Led - 508', colour: 'Black & Silver', length: '3000mm',
    photo: '/assets/products/led-508.png', drawing: '/assets/drawings/led-508.png' },
  { id: 'p5', type: TYPE_A, name: 'Led -15', colour: 'Black & White', length: '3000mm',
    photo: '/assets/products/led-15.png', drawing: '/assets/drawings/led-15.png' },
  { id: 'p6', type: TYPE_A, name: 'Corner Led 601', colour: 'Silver', length: '3000mm',
    photo: '/assets/products/corner-led-601.png', drawing: '/assets/drawings/corner-led-601.png' },
  { id: 'p7', type: TYPE_B, name: 'Led - 08', colour: 'Black', length: '3000mm',
    photo: null, drawing: '/assets/drawings/led-08.png',
    finishes: [
      { id: 'f1', name: 'Black',     photo: '/assets/products/led-08-black.png',     badge: 'New' },
      { id: 'f2', name: 'Silver',    photo: '/assets/products/led-08-silver.png',    badge: 'New' },
      { id: 'f3', name: 'Rose Gold', photo: '/assets/products/led-08-rose-gold.png', badge: 'New' },
      { id: 'f4', name: 'Copper',    photo: '/assets/products/led-08-copper.png',    badge: 'New' },
    ] },
]
