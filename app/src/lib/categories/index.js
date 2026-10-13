// Category registry.
//
// Each category owns its own template, its own reflow rules and its own product
// shape — the client's requirement is that the export follows the ORIGINAL
// catalogue template, and those differ per category. What every category shares is
// the engine: positional numbering, the editor, and the PDF export.
//
// `fields` drives the add/edit dialog, so one dialog serves every category.

import LedPage from '../../components/LedPage.jsx'
import PvcPage from '../../components/PvcPage.jsx'
import { SEED as LED_SEED, blankProduct as blankLed, TYPE_A, TYPE_B } from '../model.js'
import { paginate as paginateLed, orderedProducts } from '../paginate.js'
import { PVC_SEED, paginatePvc, blankPvcProduct, blankVariant } from './pvc.js'

export const CATEGORIES = {
  'accessories-led': {
    id: 'accessories-led',
    title: 'Accessories ~ LED',
    shortTitle: 'LED',
    Page: LedPage,
    seed: LED_SEED,
    paginate: paginateLed,
    order: orderedProducts,
    // Two kinds, because a featured product is laid out completely differently.
    kinds: [
      { id: TYPE_A, label: '+ Add product', primary: true, make: () => blankLed(TYPE_A) },
      { id: TYPE_B, label: '+ Add featured', make: () => blankLed(TYPE_B) },
    ],
    kindOf: p => p.type,
    kindLabel: p => (p.type === TYPE_B ? 'featured' : 'standard'),
    fields: p => [
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: TYPE_A, label: 'Standard — sits in the 6-across grid' },
        { value: TYPE_B, label: 'Featured — full width, multiple finishes' },
      ] },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Led -160', required: true,
        hint: 'printed exactly as typed' },
      { key: 'colour', label: p.type === TYPE_B ? 'Default finish' : 'Colour', type: 'text', placeholder: 'Silver' },
      { key: 'length', label: 'Length', type: 'text', placeholder: '3000mm' },
      ...(p.type === TYPE_B ? [] : [{ key: 'photo', label: 'Product photo', type: 'image', required: true }]),
      { key: 'drawing', label: 'Dimension drawing', type: 'image', required: true,
        hint: 'required — never generated' },
      ...(p.type === TYPE_B ? [{
        key: 'finishes', label: 'Finishes', type: 'list', requireOne: 'photo',
        itemFields: [
          { key: 'name', type: 'text', placeholder: 'Silver' },
          { key: 'badge', type: 'text', placeholder: 'New', width: 70 },
          { key: 'photo', type: 'image' },
        ],
      }] : []),
    ],
  },

  'pvc-marble': {
    id: 'pvc-marble',
    title: 'PVC Marble',
    shortTitle: 'PVC Marble',
    Page: PvcPage,
    seed: PVC_SEED,
    paginate: paginatePvc,
    order: products => products,          // one kind of product; flow order is list order
    kinds: [{ id: 'pvc', label: '+ Add product', primary: true, make: blankPvcProduct }],
    kindOf: () => 'pvc',
    kindLabel: p => `${(p.variants ?? []).length} finishes`,
    fields: () => [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'H Profile', required: true,
        hint: 'printed exactly as typed' },
      { key: 'size', label: 'Size', type: 'text', placeholder: `9'5"` },
      { key: 'series', label: 'Series', type: 'text', placeholder: 'PVC Marble' },
      { key: 'drawing', label: 'Dimension drawing', type: 'image', required: true,
        hint: 'required — never generated' },
      { key: 'variants', label: 'Colour finishes', type: 'list', requireOne: 'photo',
        make: blankVariant,
        itemFields: [
          { key: 'name', type: 'text', placeholder: 'Silver' },
          { key: 'photo', type: 'image' },
        ] },
      { key: 'extra', label: 'Installed photo (optional)', type: 'image' },
    ],
  },
}

export const CATEGORY_IDS = Object.keys(CATEGORIES)
export const DEFAULT_CATEGORY = 'accessories-led'
export const getCategory = id => CATEGORIES[id] ?? CATEGORIES[DEFAULT_CATEGORY]

export { PARENTS, DEFAULT_PARENT, getParent, parentLabel, parentOfCategory } from './parents.js'
