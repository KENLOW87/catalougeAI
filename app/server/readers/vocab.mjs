// Repairing OCR output using what the catalogue can actually say.
//
// OCR reads characters, not meaning, so it truncates and substitutes: "Rose Gol",
// "Golc", "Blo", "9'b”". Where a field draws from a small fixed set — finish names
// do — snapping to the nearest known value fixes those cleanly. Where it does not
// — product names must stay verbatim — nothing is snapped and the raw read stands.

export const FINISHES = ['Silver', 'Rose Gold', 'Gold', 'Black', 'White', 'Copper', 'Bronze', 'Champagne']

/** Levenshtein, capped — we only care about near misses. */
function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase()
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Snaps a read to the closest term in a controlled vocabulary.
 * Returns the original when nothing is close enough, so a genuinely new colour
 * is not silently rewritten into an old one.
 */
export function snapTo(text, vocab = FINISHES, { maxRatio = 0.42 } = {}) {
  const raw = (text ?? '').replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim()
  if (!raw) return { value: '', snapped: false, confidence: 0 }

  let best = null, bestD = Infinity
  for (const term of vocab) {
    const d = distance(raw, term)
    if (d < bestD) { bestD = d; best = term }
  }
  // Allow a miss roughly proportional to the length of the target word.
  const allowed = Math.max(1, Math.round(best.length * maxRatio))
  if (bestD <= allowed) {
    return { value: best, snapped: best.toLowerCase() !== raw.toLowerCase(), confidence: 1 - bestD / best.length }
  }
  return { value: raw, snapped: false, confidence: 0 }
}

/**
 * Repairs an imperial size like `Size : 9'5"`.
 * OCR reliably mangles the digits around the foot/inch marks ("9'b”", "9'%”"),
 * so read the shape rather than trusting each glyph.
 */
export function repairSize(text) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  // feet ' inches "  — accept any junk where the inch digits should be
  const m = t.match(/(\d+)\s*['’´`]\s*([0-9OoIlSsbB%]{0,2})\s*["”“'']?/)
  if (!m) return { value: t, repaired: false }
  const feet = m[1]
  // Common OCR substitutions for digits in this position.
  const fix = { O: '0', o: '0', I: '1', l: '1', S: '5', s: '5', b: '5', B: '8', '%': '5' }
  const inches = (m[2] ?? '').split('').map(c => fix[c] ?? c).filter(c => /\d/.test(c)).join('')
  return { value: `${feet}'${inches}"`, repaired: true }
}

/**
 * Repairs a product code like `PV01`, `PV05N`.
 *
 * OCR cannot reliably tell letter-O from zero, and on this catalogue it produced
 * `PVO1`, `PVO8`, `PVO0é`. The shape is known — a short letter prefix followed by
 * digits, sometimes with a trailing letter — so ambiguous glyphs in the NUMERIC
 * part can be resolved. This is resolving a misread, not tidying a name: the
 * printed truth really is a zero.
 */
export function repairCode(text) {
  // Whitespace is collapsed, NOT removed. Removing it unconditionally meant a first
  // line carrying a description instead of a code came back as one run-on word
  // ("Fishbelly White Marble" -> "FishbellyWhiteMarble"). Spaces are only dropped
  // below, once the text has proved to actually be a code.
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  const compact = t.replace(/\s+/g, '')
  // The prefix is LAZY on purpose. A greedy letter prefix swallows the very glyph
  // that needs repairing — "PVO1" matched as prefix "PVO" + "1" and came out
  // unchanged. Lazy matching stops the prefix at "PV" and leaves "O1" to be fixed.
  //
  // Q IS NOT A ZERO. It was in this set, and "SQ01" — a real PU Stone code — came
  // out as "S001": the lazy prefix stopped at "S" and the Q was converted like a
  // misread nought. A Q in a code is nearly always the letter (SQ = square), while
  // Q read for a zero is rare, so the wrong repair cost far more than it saved.
  const m = compact.match(/^([A-Za-z]+?)([OolI|Ss0-9]+)([A-Za-z]?)$/)
  // Not a code — a name or a description. Hand it back exactly as read; product
  // names are never second-guessed.
  if (!m) return { value: t, repaired: false }
  const [, prefix, middle0, suffix] = m
  // Only touch the middle if it is meant to be numeric — it must already contain
  // at least one unambiguous digit.
  if (!/\d/.test(middle0)) return { value: t, repaired: false }

  // ONE GLYPH, READ TWICE. At print resolution OCR sometimes emits both readings of
  // the same round character — "PV03" comes back as "PV0O3", "PV06" as "PVO06".
  // Converting both then INVENTS a digit: PV003, PV006. The client saw exactly that.
  //
  // Collapse only where an ambiguous LETTER sits directly against a real digit 0,
  // which is the signature of a doubled glyph. A genuine "100" is two true digits
  // with no letter between them and is left completely alone.
  const middle = middle0.replace(/0[Oo]|[Oo]0/g, '0')

  const fixed = middle
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[^0-9]/g, '')
  if (!fixed) return { value: t, repaired: false }
  return { value: `${prefix.toUpperCase()}${fixed}${suffix.toUpperCase()}`, repaired: true }
}

/** Repairs `Length : 3000mm`. */
export function repairLength(text) {
  const m = (text ?? '').match(/(\d[\d\s,]*)\s*mm/i)
  if (!m) return { value: (text ?? '').trim(), repaired: false }
  return { value: `${m[1].replace(/[\s,]/g, '')}mm`, repaired: true }
}

/**
 * Strips trailing noise bled in from a neighbouring column.
 *
 * A crop that reaches slightly too far right picks up the first letters of the next
 * cell — "Silver Co", "Black oo", "Led -170 L". Real trailing words in this
 * catalogue are never one or two letters, so a short trailing token is bleed.
 */
export function trimBleed(text) {
  let t = (text ?? '').trim()
  for (let i = 0; i < 2; i++) {
    const next = t.replace(/\s+[A-Za-z]{1,2}$/, '').trim()
    if (next === t) break
    t = next
  }
  return t
}
