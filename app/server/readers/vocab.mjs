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
export function repairCode(text, { requireDigit = true } = {}) {
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
  // Only touch the middle if it is meant to be numeric — by default it must already
  // contain at least one unambiguous digit, which is what stops a letters-only code
  // like "SQ" being invented into "S0".
  //
  // `requireDigit: false` is for a layout whose badges are KNOWN to be numbered
  // ("PW01".."PW07") — there OCR sometimes misreads BOTH digits of a short suffix
  // into their look-alike letters at once ("PW01" -> "PWOI", not one real digit left
  // to anchor on). The outer shape regex above already does the real safety work:
  // a genuine letters-only name ("CSW", "PS FLAT BAR") has letters outside the
  // ambiguous set and simply never matches it, digit or no digit.
  if (requireDigit && !/\d/.test(middle0)) return { value: t, repaired: false }

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

/**
 * Snaps a code to a small, layout-specific candidate set after OCR repair.
 * This is deliberately opt-in: product codes are not globally predictable, but
 * a known page family such as Wainscoting's PW01..PW07 is. It handles OCR's Q/O
 * confusion and repeated zero glyphs without changing unrelated catalogues.
 */
export function snapCode(text, candidates = []) {
  const raw = (text ?? '').replace(/\s+/g, '').toUpperCase()
  if (!raw || !candidates.length) return raw
  const normal = value => value.toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/S/g, '5')
    .replace(/0+/g, '0')
  const key = normal(raw)
  return candidates.find(candidate => normal(candidate) === key) ?? text
}

/** Repairs `Length : 3000mm`. */
export function repairLength(text) {
  const m = (text ?? '').match(/(\d[\d\s,]*)\s*mm/i)
  if (!m) return { value: (text ?? '').trim(), repaired: false }
  return { value: `${m[1].replace(/[\s,]/g, '')}mm`, repaired: true }
}

/**
 * Repairs a "2440mm (L)" length line — the second caption line under a panel
 * card's dimensions (`photo-grid-panel`'s "third" field).
 *
 * The parenthesised letter is always "L" on every real caption (it is the one
 * length figure, printed after the width/height line), but at this font size OCR
 * sometimes reads it as a look-alike digit ("2440mm (1)") or leaves a trailing
 * scrap from whatever sits just below the card bleeding into the crop ("2440mm
 * (L) Hid"). Re-printing the parenthetical as the literal "(L)" it always is —
 * rather than trying to repair whatever glyph OCR actually produced — fixes both
 * at once and discards the trailing noise along with it.
 */
export function repairLengthParen(text) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  const m = t.match(/(\d[\d,]*)\s*mm\s*\([^)]*\)/i)
  if (!m) return { value: t, repaired: false }
  return { value: `${m[1].replace(/,/g, '')}mm (L)`, repaired: true }
}

/**
 * Keeps just the "NNNmm" figure out of a box that also caught the measurement
 * line's own tick marks either side of it ("— 115mm — _") — the ticks are drawn
 * as thin runs of ink, not glyphs, so OCR renders them as stray dashes and
 * underscores rather than dropping them, and `matches: /\d+\s*mm/i` only proves
 * the real number is in there SOMEWHERE, not that it is all that came back.
 */
export function repairFirstMm(text) {
  const m = (text ?? '').match(/\d[\d,]*\s*mm/i)
  if (!m) return { value: (text ?? '').trim(), repaired: false }
  return { value: m[0].replace(/[\s,]/g, ''), repaired: true }
}

/**
 * Strips noise bled in from a neighbouring element.
 *
 * A crop that reaches slightly too far right picks up the first letters of the next
 * cell — "Silver Co", "Black oo", "Led -170 L". Real trailing words in this
 * catalogue are never one or two letters, so a short trailing token is bleed.
 *
 * The same thing happens at the START of a dimension caption: a search box wide
 * enough to find "40mm (W) x 15mm (H)" also catches the tip of the product photo
 * sitting just above it, and a faint mark on it reads as one junk token before the
 * real text — "J 40mm (W)...". A caption here always begins with a digit, so a
 * single short non-numeric token immediately before one is bleed the same way.
 */
export function trimBleed(text) {
  let t = (text ?? '').trim()
  const lead = t.match(/^([^\d]{1,3})\s+(\d.*)$/)
  if (lead && lead[1].replace(/[^A-Za-z]/g, '').length <= 1) t = lead[2]
  for (let i = 0; i < 2; i++) {
    const next = t.replace(/\s+[A-Za-z]{1,2}$/, '').trim()
    if (next === t) break
    t = next
  }
  // A stray punctuation mark left by the same kind of bleed, after whatever real
  // word or digit ends the line ("2440mm (L) =") — never part of a real caption.
  t = t.replace(/\s+[^\w\s]{1,2}$/, '').trim()
  return t
}
