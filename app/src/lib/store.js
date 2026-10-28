// Where catalogues are kept in the browser.
//
// This used to be localStorage, and localStorage is capped at about 5 MB for the
// whole site. A catalogue carries its product photos as base64, so ONE category
// (PVC Marble) reached 3.9 MB on its own. The next import had nowhere to go: the
// save threw QuotaExceededError, the error was swallowed, and 23 imported products
// vanished on the next reload while their page header — small enough to fit —
// stayed behind. Nothing on screen said a thing.
//
// IndexedDB has no 5 MB cap (this machine reports a 10 GB quota) and stores the
// data as structured values rather than one giant string.
//
// Two rules this file exists to enforce:
//   1. A FAILED SAVE MUST BE VISIBLE. Never swallow a write error again.
//   2. Nothing is written before the existing data has been read back, or an
//      empty catalogue overwrites a full one — which is exactly what stamped
//      "[]" over those 23 products.

const DB_NAME = 'geometra'
const STORE = 'catalogues'
const VERSION = 1

const catKey = id => `catalogue.${id}`
const chromeKey = id => `chrome.${id}`

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('could not open the local database'))
  })
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let out
    try { out = run(store) } catch (e) { reject(e); return }
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('the save was aborted — the disk may be full'))
  })
}

async function readAll(db) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).openCursor()
    const out = {}
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) { resolve(out); return }
      out[cur.key] = cur.value
      cur.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

// Anything still sitting in localStorage from before is moved across once, and the
// big keys are dropped so the old 5 MB cap can never bite again. The tiny
// "which category was open" key stays where it is — it is synchronous and small.
async function migrateFromLocalStorage(db, existing) {
  const moved = []
  const stale = []
  for (const lsKey of Object.keys(localStorage)) {
    const m = lsKey.match(/^geometra\.(catalogue|chrome)\.(.+)$/)
    if (!m) continue
    stale.push(lsKey)
    const key = `${m[1]}.${m[2]}`
    if (key in existing) continue
    let value
    try { value = JSON.parse(localStorage.getItem(lsKey)) } catch { continue }
    // An empty catalogue is what the quota bug left behind. Do not carry it over
    // and do not let it mask a real one.
    if (Array.isArray(value) && value.length === 0) continue
    if (value == null) continue
    await tx(db, 'readwrite', s => s.put(value, key))
    existing[key] = value
    moved.push(key)
  }
  for (const lsKey of stale) { try { localStorage.removeItem(lsKey) } catch {} }
  return moved
}

/** Everything held for this browser, including categories explicitly deleted. */
export async function loadAll() {
  const db = await open()
  const raw = await readAll(db)
  const moved = await migrateFromLocalStorage(db, raw)
  db.close()

  const byCategory = {}
  const chromeByCategory = {}
  const acceptedByCategory = {}
  const deletedCategories = {}
  const customCategories = {}
  for (const [key, value] of Object.entries(raw)) {
    const m = key.match(/^(catalogue|chrome|accepted|deleted|custom)\.(.+)$/)
    if (!m) continue
    if (m[1] === 'catalogue') byCategory[m[2]] = value
    else if (m[1] === 'chrome') chromeByCategory[m[2]] = value
    else if (m[1] === 'accepted') acceptedByCategory[m[2]] = value
    else if (m[1] === 'deleted') deletedCategories[m[2]] = Boolean(value)
    else customCategories[m[2]] = value
  }
  return { byCategory, chromeByCategory, acceptedByCategory, deletedCategories, customCategories, moved }
}

/** Throws on failure — the caller must show it, never swallow it. */
export async function saveCatalogue(id, products) {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.put(products, catKey(id))) } finally { db.close() }
}

/** Empty one catalogue and remove its auxiliary records.
 *
 * Keep an explicit [] catalogue record: built-in catalogues have seed data used
 * on first launch, and deleting the record would make that seed reappear after
 * reload. The empty marker is the durable meaning of "this catalogue was deleted".
 */
export async function removeCatalogue(id) {
  const db = await open()
  try {
    await tx(db, 'readwrite', s => {
      s.put([], catKey(id))
      s.delete(chromeKey(id))
      s.delete(`accepted.${id}`)
    })
  } finally { db.close() }
}

export async function markCategoryDeleted(id) {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.put(true, `deleted.${id}`)) } finally { db.close() }
}

// The inverse of markCategoryDeleted — a catalogue the admin deleted, brought back
// because an import confidently landed on it again. Products arriving for a hidden
// category must make it visible, or they are saved and never shown anywhere.
export async function restoreCategory(id) {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.delete(`deleted.${id}`)) } finally { db.close() }
}

export async function saveChrome(id, chrome) {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.put(chrome, chromeKey(id))) } finally { db.close() }
}

// Quality-check findings the admin has answered: "PV18 and PV18N are correct".
// Kept here rather than in memory because a check that has been answered must stay
// answered — through a reload, an edit, and the next import. Being told the same
// thing twice is what makes a panel worth ignoring.
export async function saveAccepted(id, keys) {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.put(keys, `accepted.${id}`)) } finally { db.close() }
}

/**
 * A catalogue the admin created during an import, because the PDF belonged to no
 * family the system ships with. It is an ordinary catalogue from that point on —
 * stored, listed, printed on the default template — and the only difference is
 * that nobody wrote it into `parents.js`.
 */
export async function saveCustomCategory(category) {
  const db = await open()
  try {
    await tx(db, 'readwrite', s => s.put(category, `custom.${category.id}`))
  } finally { db.close() }
}

/** Wipe EVERY record this browser holds — every catalogue, header, accepted
 *  check, deletion marker and created category. For starting over clean, e.g.
 *  before demoing to a new company. The two built-in categories' seed examples
 *  live in code, not storage, so the caller must write an explicit empty
 *  catalogue record for them too if a blank slate (not the shipped demo
 *  content) is wanted — same reasoning as the empty-marker note on
 *  `removeCatalogue` above. */
export async function clearAll() {
  const db = await open()
  try { await tx(db, 'readwrite', s => s.clear()) } finally { db.close() }
}
