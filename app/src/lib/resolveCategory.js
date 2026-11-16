import { CATEGORIES, PARENTS, getCategory } from './categories/index.js'
import { defaultCategoryFor } from './categories/default.js'

const parentById = id => PARENTS.find(p => p.id === id)

// A family with no sub-catalogue is itself a catalogue, so its id doubles as a
// category id. Built-in categories keep their bespoke template; a family without one
// gets the default page, built round the header lifted from its own PDF.
export const resolveCategory = (id, chrome, custom = {}) => {
  if (CATEGORIES[id]) return CATEGORIES[id]
  const family = parentById(id) ?? custom[id]
  // A created catalogue has no bespoke template, so it prints on the default page —
  // exactly like the shipped families that have none. Without this it fell through
  // to getCategory(), which returns the LED catalogue for anything it knows nothing
  // about, and a new catalogue would have rendered as LED.
  return family ? defaultCategoryFor(family, chrome) : getCategory(id)
}
