// Quality control over a catalogue, as plain rules.
//
// Everything here is DETERMINISTIC and free. No API key, no cost, no waiting, and —
// the part that matters for a published catalogue — no invented answers. A rule
// either fires or it does not, and it can always say exactly which item it is about.
//
// These are the mistakes that actually happened during this project, turned into
// checks so they announce themselves instead of being found by eye:
//   PV003   a code with a digit OCR invented
//   NN 7    a phantom product read off a cover photograph
//   23 products that silently became 0 when storage was full
//
// An AI is NOT used for any of this. Judgement calls ("is this description right for
// this photo?") are the only thing worth paying for; counting is not.

const codeOf = name => String(name ?? '').trim()

/** Split "PV18N" into { prefix: 'PV', digits: '18', suffix: 'N' }, or null. */
export function partsOf(name) {
  const m = codeOf(name).match(/^([A-Za-z]+)(\d+)([A-Za-z]*)$/)
  return m ? { prefix: m[1].toUpperCase(), digits: m[2], n: Number(m[2]), suffix: m[3].toUpperCase() } : null
}

const mode = values => {
  const count = new Map()
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1)
  let best = null, bestN = 0
  for (const [v, n] of count) if (n > bestN) { best = v; bestN = n }
  return best
}

/** Does this item carry a picture of the product at all? */
const hasPhoto = p =>
  !!p.photo ||
  (p.finishes ?? []).some(f => f.photo) ||
  (p.variants ?? []).some(v => v.photo)

/**
 * @param items     the catalogue, in flow order
 * @param category  the open category (for its title and whether drawings apply)
 * @param accepted  keys the admin has marked as correct — those findings are dropped
 * @returns findings, worst first: { key, level, title, detail, ids }
 *
 * Every finding carries a stable KEY, derived from what it is about rather than
 * from where it sits in the list. That is what lets "PV18 and PV18N are correct"
 * be remembered: the same key comes back on every future check, so the answer
 * survives edits, re-imports and reloads. A check the admin has already answered
 * must never ask again — that is how a panel earns being read.
 */
export function runQc(items = [], category = null, accepted = []) {
  const out = []
  const skip = new Set(accepted)
  const products = items.filter(p => !p.isPage)
  const pages = items.filter(p => p.isPage)
  const names = list => list.map(p => String(p.name ?? '?').toUpperCase()).sort().join(',')
  const add = (level, key, title, detail, ids = []) => {
    if (skip.has(key)) return
    out.push({ key, level, title, detail, ids })
  }

  if (!items.length) return out

  // --- things that are plainly wrong ----------------------------------------
  const unnamed = products.filter(p => !codeOf(p.name))
  if (unnamed.length) {
    add('error', 'noname:' + names(unnamed), `${unnamed.length} product${unnamed.length > 1 ? 's have' : ' has'} no name`,
      'A product with no name cannot be found again or matched on a re-import.',
      unnamed.map(p => p.id))
  }

  const noPhoto = products.filter(p => !hasPhoto(p))
  if (noPhoto.length) {
    add('error', 'nophoto:' + names(noPhoto), `${noPhoto.length} product${noPhoto.length > 1 ? 's have' : ' has'} no photo`,
      `Nothing will print in the picture slot: ${noPhoto.map(p => p.name || '(unnamed)').join(', ')}.`,
      noPhoto.map(p => p.id))
  }

  // A drawing is only expected where the layout actually has one.
  if (category?.wantsDrawing || (category?.fields?.({})?.some?.(f => f.key === 'drawing' && f.required))) {
    const noDrawing = products.filter(p => !p.drawing)
    if (noDrawing.length) {
      add('error', 'nodrawing:' + names(noDrawing), `${noDrawing.length} product${noDrawing.length > 1 ? 's have' : ' has'} no dimension drawing`,
        'This catalogue prints a drawing for every product. Drawings are never generated — upload them.',
        noDrawing.map(p => p.id))
    }
  }

  // --- duplicates -----------------------------------------------------------
  const byName = new Map()
  for (const p of products) {
    const k = codeOf(p.name).toUpperCase()
    if (!k) continue
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  for (const [name, group] of byName) {
    if (group.length > 1) {
      add('warn', 'dupname:' + name, `"${name}" appears ${group.length} times`,
        'Two products with the same name cannot be told apart when a PDF is re-imported.',
        group.map(p => p.id))
    }
  }

  const byDesc = new Map()
  for (const p of products) {
    const d = String(p.subtitle ?? '').trim().toLowerCase()
    if (d.length < 4) continue
    byDesc.set(d, [...(byDesc.get(d) ?? []), p])
  }
  for (const [desc, group] of byDesc) {
    if (group.length > 1) {
      add('warn', 'dupdesc:' + names(group), `${group.length} products share the description "${group[0].subtitle}"`,
        `Usually one caption was read twice: ${group.map(p => p.name).join(', ')}.`,
        group.map(p => p.id))
    }
  }

  // --- near-duplicates ------------------------------------------------------
  // Exact matches are the easy half. What actually looks wrong on a printed page is
  // a NEAR duplicate: PV18 "Armani Grey Matte Marble" beside PV18N "Armani Grey
  // Gloss Marble" — same base number, one word apart, two grey photographs. Either
  // it is a genuine pair of finishes, or the same product was read twice. The
  // catalogue cannot tell which; the admin can, in a second, once it is pointed out.

  // Same base number, different suffix: PV18 / PV18N.
  const byBase = new Map()
  for (const { p, parts } of products.map(p => ({ p, parts: partsOf(p.name) })).filter(x => x.parts)) {
    const k = `${parts.prefix}${parts.n}`
    byBase.set(k, [...(byBase.get(k) ?? []), p])
  }
  for (const [base, group] of byBase) {
    if (group.length > 1) {
      add('warn', 'dupcode:' + base, `${group.map(p => p.name).join(' and ')} share the code ${base}`,
        'Same number, different letter — two versions of one product, or the same product ' +
        'read twice. Worth a look at both.',
        group.map(p => p.id))
    }
  }

  // A "descriptions differ by one word" check was written here and removed. Nearly
  // every name in this catalogue is "<something> <something> Marble", so it flagged
  // Fishbelly White against Miracle White, Semi Gold against White Gold — five
  // notes of noise for one real signal. A check that cries wolf teaches people to
  // ignore the panel, which is worse than not checking at all. The shared base code
  // above catches the real case (PV18 / PV18N) on its own.

  // The same picture used twice. Comparing whole base64 strings would be slow, so
  // the image is SAMPLED — but at a fixed number of points rather than a fixed
  // step, or a short string gets one sample and every product looks identical.
  const sample = s => {
    const t = String(s ?? '')
    if (t.length < 32) return ''            // too small to judge; say nothing
    const step = Math.max(1, Math.floor(t.length / 512))
    let h = 0
    for (let i = 0; i < t.length; i += step) h = (h * 31 + t.charCodeAt(i)) | 0
    return `${h}:${t.length}`
  }
  const byPhoto = new Map()
  for (const p of products) {
    const k = sample(p.photo)
    if (!k) continue
    byPhoto.set(k, [...(byPhoto.get(k) ?? []), p])
  }
  for (const group of byPhoto.values()) {
    if (group.length > 1) {
      add('warn', 'dupphoto:' + names(group), `${group.map(p => p.name).join(', ')} use the same photo`,
        'One picture cut twice during an import, or the wrong file uploaded to the second product.',
        group.map(p => p.id))
    }
  }

  // --- code shape and sequence ----------------------------------------------
  // Codes in one catalogue share a format. An outlier is the signature of a
  // misread — PV003 among PV01..PV32 was exactly this.
  const parsed = products.map(p => ({ p, parts: partsOf(p.name) })).filter(x => x.parts)
  if (parsed.length >= 4) {
    const width = mode(parsed.map(x => x.parts.digits.length))
    const odd = parsed.filter(x => x.parts.digits.length !== width)
    if (odd.length && odd.length <= parsed.length / 2) {
      add('warn', 'codeshape:' + names(odd.map(x => x.p)), `${odd.length} code${odd.length > 1 ? 's do' : ' does'} not match this catalogue's format`,
        `Most codes here have ${width} digits. These do not: ` +
        `${odd.map(x => x.p.name).join(', ')}. A code with an extra digit is usually a misread.`,
        odd.map(x => x.p.id))
    }

    const prefix = mode(parsed.map(x => x.parts.prefix))
    const run = parsed.filter(x => x.parts.prefix === prefix).map(x => x.parts.n).sort((a, b) => a - b)
    const missing = []
    for (let n = run[0]; n < run[run.length - 1]; n++) if (!run.includes(n)) missing.push(n)
    if (missing.length) {
      add('info', 'seq:' + prefix + ':' + missing.join('-'), `${missing.length} code${missing.length > 1 ? 's are' : ' is'} missing from the sequence`,
        `Between ${prefix}${run[0]} and ${prefix}${run[run.length - 1]} there is no ` +
        `${missing.slice(0, 12).map(n => prefix + String(n).padStart(String(width).length, '0')).join(', ')}` +
        `${missing.length > 12 ? '…' : ''}. That may be correct — discontinued lines leave gaps — ` +
        'but it is also what a skipped page looks like.',
        [])
    }
  }

  // --- pages kept from the source -------------------------------------------
  if (pages.length) {
    const noImage = pages.filter(p => !p.image)
    if (noImage.length) {
      add('error', 'pagenoimg:' + names(noImage), `${noImage.length} kept page${noImage.length > 1 ? 's have' : ' has'} no picture`,
        'A full page with no image prints blank.', noImage.map(p => p.id))
    }
  }

  const order = { error: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

/** One line for the sidebar: the worst thing outstanding. */
export function qcSummary(findings) {
  if (!findings.length) return { level: 'ok', text: 'No problems found' }
  const errors = findings.filter(f => f.level === 'error').length
  const warns = findings.filter(f => f.level === 'warn').length
  if (errors) return { level: 'error', text: `${errors} problem${errors > 1 ? 's' : ''} to fix` }
  if (warns) return { level: 'warn', text: `${warns} thing${warns > 1 ? 's' : ''} to check` }
  return { level: 'info', text: `${findings.length} note${findings.length > 1 ? 's' : ''}` }
}
