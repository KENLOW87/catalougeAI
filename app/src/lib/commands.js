// Telling the bot to DO something, rather than asking it something.
//
// The rule this file exists to enforce: **the bot never changes the catalogue on
// its own.** Anything that would alter data is returned as a PROPOSAL — described
// in plain words, naming exactly what it would touch — and only happens when the
// admin clicks Apply. A misread instruction must cost a glance, not a product.
//
// Commands that change nothing (export, run a check, jump to an item, open a
// dialog) run straight away: there is nothing to undo and nothing to review.
//
// Parsing is done here, in the browser, with no API key. A plain command works for
// free; only unusual wording needs the AI.

const norm = s => String(s ?? '').toLowerCase().trim()

/** The catalogue of everything the bot understands — also drives the help panel. */
export const COMMAND_HELP = [
  {
    group: 'Ask about the catalogue',
    note: 'answered from your data, free and instant',
    items: ['How many products?', 'Which ones have no photo?', 'Any gaps in the codes?', 'Tell me about PV06'],
  },
  {
    group: 'Check, and answer back',
    note: 'tell it when something it flagged is actually correct — it remembers',
    items: ['Run a quality check', 'PV18 and PV18N are correct', 'Ignore that one'],
  },
  {
    group: 'Change something — you confirm before it happens',
    note: 'the bot proposes; nothing changes until you click Apply',
    items: ['Delete PV07', 'Rename PV07 to PV7', 'Move PV12 up', 'Move PV12 down'],
  },
  {
    group: 'Replace a photo',
    note: 'attach it (📎), then tell me which product — you confirm before it happens',
    items: ['Replace PV07 with this photo', 'Remove PV07 and replace it with my updated photo'],
  },
  {
    group: 'Clean a product photo',
    note: 'the bot removes a dark background locally and asks you to confirm',
    items: ['Remove the background from PV07', 'Clean the background of PV07'],
  },
  {
    group: 'Open or export — nothing is changed',
    note: 'these run straight away',
    items: ['Show me PV06', 'Add a product', 'Add PV23 to this catalogue', 'Download PDF', 'Download all as PDF'],
  },
]

const findProduct = (text, items) => {
  const t = norm(text)
  // Longest name first, so "PV18N" is not matched as "PV18".
  const byLength = [...items].sort((a, b) => String(b.name ?? '').length - String(a.name ?? '').length)
  return byLength.find(p => p.name && t.includes(norm(p.name))) ?? null
}

const nameLike = text => {
  const m = String(text).toUpperCase().match(/\b([A-Z]{1,4}\s?\d{1,4}[A-Z]?)\b/)
  return m ? m[1].replace(/\s+/g, '') : null
}

/** Every code-like token in the sentence, not just the first — "add PV23 and
 *  PV25" names two. */
const allCodesLike = text => [...String(text).toUpperCase().matchAll(/\b([A-Z]{1,4}\s?\d{1,4}[A-Z]?)\b/g)]
  .map(m => m[1].replace(/\s+/g, ''))

/** Loose match of a spoken catalogue name against the ones that exist. */
const matchCatalogue = (t, catalogues) => {
  let best = null, bestScore = 0
  for (const c of catalogues) {
    const words = norm(c.title).split(/[^a-z0-9]+/).filter(w => w.length > 2)
    if (!words.length) continue
    // Count title words that appear in the sentence, allowing a typo per word:
    // the client wrote "accecories", and a catalogue name is not a password.
    const hits = words.filter(w => t.includes(w) || t.split(/[^a-z0-9]+/).some(s => near(s, w))).length
    const score = hits / words.length
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 0.5 ? best : null
}

/**
 * Every field of `product` that is a photo — built from `category.fields(p)`,
 * the SAME list ProductDialog uses to decide which file input to show, so this
 * never drifts from what the admin could pick manually.
 *
 * A simple product (Type A LED, a default-page item) has one: its `photo` or
 * `image` field. A multi-finish product (Type B LED's `finishes`, PVC Marble's
 * `variants`) has one target PER EXISTING FINISH, named, so a sentence that does
 * not say which one is treated as ambiguous rather than guessed at — the same
 * caution the rest of this file already applies to an unclear catalogue name.
 *
 * `drawing` is excluded: a dimension drawing is never "the photo".
 */
const photoTargets = (category, p) => {
  const targets = []
  for (const f of category.fields(p)) {
    if (f.type === 'image' && f.key !== 'drawing') {
      targets.push({ label: f.label, match: null, targetKey: f.key, targetItemId: null })
    } else if (f.type === 'list' && f.requireOne === 'photo') {
      for (const it of p[f.key] ?? []) {
        targets.push({
          label: it.name ? `${f.label} — ${it.name}` : f.label,
          match: it.name ?? null, targetKey: f.key, targetItemId: it.id,
        })
      }
    }
  }
  return targets
}

/**
 * True when two words are close enough to be the same word typed imperfectly.
 *
 * The allowance grows with length: "accecories" is TWO edits from "accessories"
 * (a swapped letter and a dropped one) and a single-edit rule rejected it, so the
 * client's own sentence went unrecognised. A long word carries enough information
 * to survive two slips; a short one does not, and must still match exactly.
 */
const near = (a, b) => {
  if (!a || !b) return false
  if (a === b) return true
  const allowed = b.length >= 8 ? 2 : b.length >= 5 ? 1 : 0
  if (!allowed || Math.abs(a.length - b.length) > allowed) return false
  // Levenshtein, small strings only.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length] <= allowed
}

/**
 * @param attachment  a background-removed photo attached in the chat (a data
 *   URL), or null — only relevant to the "replace a photo" command below
 * @returns null when this is not a command (then it is treated as a question), or
 *   { run }                       — safe, do it now
 *   { propose: { summary, detail, action } } — changes data, needs a click
 *   { reply }                     — understood, but cannot be done, and why
 */
export function parseCommand(text, items = [], category = null, findings = [], catalogues = [], attachment = null) {
  const t = norm(text)
  if (!t) return null

  // --- naming another catalogue ---------------------------------------------
  // "fix accecories cataluge" names a catalogue, possibly misspelt, possibly not
  // the one on screen. Acting on the wrong catalogue would be worse than asking.
  const named = matchCatalogue(t, catalogues)
  if (named && named.id !== category?.id) {
    if (/\b(open|switch|go to|show me)\b/.test(t)) {
      return { run: { type: 'open', id: named.id, label: named.title } }
    }
    return { reply: `That is ${named.title}, and you have ${category?.title ?? 'another catalogue'} open. ` +
      `Say "open ${named.title}" and I will switch, then I can work on it.` }
  }

  // --- a blank page ---------------------------------------------------------
  // "discard the blank page". A kept page with no picture prints as an empty sheet,
  // so it is worth removing — but only if one actually exists. Saying "done" to an
  // instruction that matched nothing is worse than saying nothing was found.
  if (/\b(blank|empty)\b/.test(t) && /\bpages?\b/.test(t)) {
    const blanks = items.filter(p => p.isPage && !p.image)
    if (!blanks.length) {
      const pages = items.filter(p => p.isPage).length
      return { reply: pages
        ? `I checked the ${pages} kept page${pages === 1 ? '' : 's'} in ${category?.title ?? 'this catalogue'} and every one has its picture, so none of them prints blank. If you mean a page that looks empty on screen, tell me which number and I will look at that one.`
        : `There are no kept pages in ${category?.title ?? 'this catalogue'} to discard.` }
    }
    return {
      propose: {
        summary: `Discard ${blanks.length} blank page${blanks.length === 1 ? '' : 's'}?`,
        detail: `${blanks.map(p => p.name).join(', ')} — kept from the PDF but carrying no picture, so ${blanks.length === 1 ? 'it prints' : 'they print'} as an empty sheet.`,
        danger: true,
        action: { type: 'delete', ids: blanks.map(p => p.id), label: blanks.map(p => p.name).join(', ') },
      },
    }
  }

  // --- "fix this catalogue" --------------------------------------------------
  // Too vague to act on, but not too vague to help with: the check says what is
  // actually wrong, and each finding carries its own fix.
  if (!/\b(background|bg)\b/.test(t) && /\bfix\b|\bclean\b|\btidy\b|\bsort out\b/.test(t)) return { run: { type: 'qc' } }

  // --- answering the quality check ----------------------------------------
  // "the pv18 and pv18n is correct. mark it" must be understood. A check the admin
  // has already judged is not a finding any more, and asking again is how a panel
  // becomes something people stop reading. This changes no product, so it happens
  // at once — and it is listed as undoable, which is why it needs no confirmation.
  if (/\b(correct|fine|ok|okay|intended|on purpose|as it should|accept|approve|ignore|dismiss|mark it|leave it|stop telling|not a (problem|mistake|duplicate))\b/.test(t)) {
    if (!findings.length) return { reply: 'There is nothing outstanding to mark — the last check found no problems.' }

    // Which finding? The codes named in the sentence decide it; failing that, a
    // single outstanding finding is unambiguous.
    const mentioned = items.filter(p => p.name && t.includes(norm(p.name))).map(p => String(p.name).toUpperCase())
    let hit = null
    if (mentioned.length) {
      hit = findings.find(f => mentioned.every(n => f.title.toUpperCase().includes(n)))
        ?? findings.find(f => mentioned.some(n => f.title.toUpperCase().includes(n)))
    }
    if (!hit && findings.length === 1) hit = findings[0]
    if (!hit) {
      return { reply: 'Which one should I mark as correct? Name it, for example ' +
        `"PV18 and PV18N are correct" — or press Mark as correct on the finding itself.` }
    }
    return { run: { type: 'accept', key: hit.key, label: hit.title } }
  }

  // --- safe: nothing is altered -------------------------------------------
  if (/\b(quality check|run a check|check the catalogue|qc)\b/.test(t)) return { run: { type: 'qc' } }

  if (/\b(download|export|save)\b/.test(t) && /\ball\b/.test(t)) return { run: { type: 'exportAll' } }
  if (/\b(download|export|save)\b.*\bpdf\b/.test(t) || /\bdownload\b/.test(t)) return { run: { type: 'export' } }

  // --- remove a product-photo background -----------------------------------
  // This is deliberately separate from the delete command below. The bot cleans
  // the existing photo locally, shows the result, and still waits for Apply before
  // replacing anything in the catalogue.
  if (/\b(background|bg)\b/.test(t) &&
      /\b(remove|clean|clear|delete)\b/.test(t)) {
    const p = findProduct(t, items)
    if (!p) {
      const asked = nameLike(text)
      return { reply: asked
        ? `I cannot find ${asked}, so there is no product photo to clean.`
        : 'Tell me which product, for example "remove the background from PW07".' }
    }
    if (p.isPage) return { reply: `${p.name} is a kept page, not a product photo. I will not alter the page image.` }
    const targets = category ? photoTargets(category, p) : []
    if (!targets.length) return { reply: `${p.name} has no product photo field I can clean.` }
    const target = targets.length === 1
      ? targets[0]
      : targets.find(tg => tg.match && t.includes(norm(tg.match)))
    if (!target) {
      return { reply: `${p.name} has more than one product photo — ${targets.map(tg => tg.label).join(', ')}. ` +
        `Say which one, for example "remove the background from ${p.name} ${targets[0].match ?? ''}".` }
    }
    const source = target.targetItemId
      ? (p[target.targetKey] ?? []).find(it => it.id === target.targetItemId)?.photo
      : p[target.targetKey]
    if (!source) return { reply: `${p.name}${target.match ? ` — ${target.match}` : ''} has no photo to clean.` }
    return {
      propose: {
        summary: `Remove the background from ${p.name}${target.match ? ` — ${target.match}` : ''}?`,
        detail: 'I will process this photo locally. Light backgrounds stay unchanged, and the product frame is not cropped. Nothing changes until you click Apply.',
        preview: source,
        action: {
          type: 'removeBackground', ids: [p.id], label: p.name,
          targetKey: target.targetKey, targetItemId: target.targetItemId, value: source,
        },
      },
    }
  }

  // "add a product" and "add PV23 to this catalogue" mean the same thing — a
  // code named directly is just as clear an instruction as the word "product".
  // It opens the SAME blank dialog a click on "+ Add product" would, with the
  // code already typed into the name field: a photo (and, where the category
  // requires one, a dimension drawing) still has to come from the admin — the
  // bot does not invent either, for the same reason it never invents a
  // measurement (see ProductDialog's own rule on this).
  // "new" alone is too common a word elsewhere ("what's new with PV07", "a new
  // finish") to treat as a creation verb on its own — it still needs
  // "product"/"item" to mean that. "add"/"create" are not used that way
  // anywhere else in normal speech, so a bare code after one of those is enough.
  const addsByCode = /\b(add|create)\b/.test(t) && (/\b(product|item)\b/.test(t) || nameLike(text))
  const addsByWord = /\bnew\b/.test(t) && /\b(product|item)\b/.test(t)
  if (addsByCode || addsByWord) {
    const codes = allCodesLike(text)
    return { run: { type: 'addProduct', value: codes[0] ?? null, more: codes.slice(1) } }
  }
  if (/\b(import|upload|read)\b.*\b(pdf|catalogue|catalog)\b/.test(t)) return { run: { type: 'import' } }

  if (/\b(show|find|where|highlight|jump)\b/.test(t)) {
    const p = findProduct(t, items)
    if (p) return { run: { type: 'reveal', ids: [p.id], label: p.name } }
    const asked = nameLike(text)
    if (asked) return { reply: `There is no ${asked} in ${category?.title ?? 'this catalogue'}.` }
  }

  // --- replacing a product's photo ------------------------------------------
  // "replace PV07 with this photo", or "remove PV07 and replace it with my
  // updated product" — the word "remove" there would otherwise match the delete
  // rule below, so this is checked first. The product is KEPT; only its picture
  // changes, which is why it needs its own detail text rather than delete's.
  const wantsReplace = /\breplace\b/.test(t) || /\bswap\b/.test(t) ||
    (/\bupdate\b/.test(t) && (/\b(photo|picture|image)\b/.test(t) || attachment))
  if (wantsReplace) {
    const p = findProduct(t, items)
    if (!p) {
      const asked = nameLike(text)
      return { reply: asked
        ? `I cannot find ${asked}, so there is nothing to put the photo on.`
        : 'Tell me which product gets the new photo, for example "replace PV07 with this photo".' }
    }
    if (!attachment) {
      return { reply: `Attach the updated photo first — the 📎 button next to the box — ` +
        `then send this again and I will swap it onto ${p.name}.` }
    }
    const targets = category ? photoTargets(category, p) : []
    if (!targets.length) return { reply: `${p.name} has no photo field I can replace.` }
    const target = targets.length === 1
      ? targets[0]
      : targets.find(tg => tg.match && t.includes(norm(tg.match)))
    if (!target) {
      return { reply: `${p.name} has more than one photo — ${targets.map(tg => tg.label).join(', ')}. ` +
        `Say which one, for example "replace ${p.name} ${targets[0].match ?? ''} photo".` }
    }
    return {
      propose: {
        summary: `Replace ${p.name}${target.match ? ` — ${target.match}` : ''}'s photo?`,
        detail: 'Only the picture changes — the name, code and every other field stay as they are.',
        preview: attachment,
        action: {
          type: 'replacePhoto', ids: [p.id], label: p.name,
          targetKey: target.targetKey, targetItemId: target.targetItemId, value: attachment,
        },
      },
    }
  }

  // --- changes data: always proposed, never done ---------------------------
  if (/\b(delete|remove|get rid of|drop|discard)\b/.test(t)) {
    const p = findProduct(t, items)
    if (!p) {
      const asked = nameLike(text)
      return { reply: asked
        ? `I cannot find ${asked}, so there is nothing to delete.`
        : 'Tell me which one to delete — by its name or code, for example "delete PV07".' }
    }
    return {
      propose: {
        summary: `Delete ${p.name}?`,
        detail: p.isPage
          ? 'This removes the whole page from the catalogue. Everything after it moves up a sheet.'
          : 'This removes the WHOLE product — its name, photo, drawing and every finish. ' +
            'The products after it slide up and the numbers close the gap.',
        danger: true,
        action: { type: 'delete', ids: [p.id], label: p.name },
      },
    }
  }

  if (/\b(rename|call it|change the name)\b/.test(t)) {
    const p = findProduct(t, items)
    const to = String(text).match(/\bto\s+(.+)$/i)?.[1]?.trim()
    if (!p) return { reply: 'Tell me which one to rename, for example "rename PV07 to PV7".' }
    if (!to) return { reply: `What should ${p.name} be called? Try "rename ${p.name} to PV7".` }
    return {
      propose: {
        summary: `Rename ${p.name} to ${to}?`,
        detail: 'Names are printed exactly as typed, and a re-import matches products by name.',
        action: { type: 'rename', ids: [p.id], label: p.name, value: to },
      },
    }
  }

  if (/\bmove\b/.test(t) && /\b(up|down|earlier|later|before|after)\b/.test(t)) {
    const p = findProduct(t, items)
    if (!p) return { reply: 'Tell me which one to move, for example "move PV12 up".' }
    const dir = /\b(up|earlier|before)\b/.test(t) ? -1 : 1
    return {
      propose: {
        summary: `Move ${p.name} ${dir < 0 ? 'up' : 'down'} one place?`,
        detail: 'The numbering follows the order, so the badges are recalculated.',
        action: { type: 'move', ids: [p.id], label: p.name, value: dir },
      },
    }
  }

  return null       // not a command — let the question engine try it
}
