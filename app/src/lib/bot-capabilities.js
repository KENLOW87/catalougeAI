// This is the action vocabulary, not a list of required user phrases. The text
// interpreter maps ordinary language into these capabilities; the browser owns
// all record lookup, validation, previews and Apply execution.
export const BOT_CAPABILITIES = [
  { domain: 'product', operations: ['add', 'rename', 'remove', 'move', 'show'], fields: ['target', 'name', 'direction'], notes: 'Add opens the existing product form with the original attachment. Rename/remove/show require a real unique product. Move supports one place up/down; source grouping remains enforced.' },
  { domain: 'photo', operations: ['replace', 'remove', 'background', 'backgroundAll', 'adjust'], fields: ['target', 'finish', 'adjustment', 'angle'], notes: 'Use actual product photo fields; never confuse image removal with whole-product removal. Adjust supports brighten/darken/contrast/flip/explicit rotate 90/180/270. Background editing uses existing image editor, never drawings. backgroundAll requires an explicit request to isolate all product photos; each result is reviewed before Apply.' },
  { domain: 'display', operations: ['add', 'move', 'remove'], fields: ['target', 'source', 'placement'], notes: 'Use existing display-intent target/source/placement schema. Full original scene; shared series image appears once.' },
  { domain: 'imagePage', operations: ['add', 'move', 'remove'], fields: ['source', 'pagePosition'], notes: 'Create or reposition a complete original image page; honour exact one-based requested pagePosition. Never append when a position was supplied. Use manual image page ID for removal.' },
  { domain: 'catalogue', operations: ['check', 'acceptFinding', 'open', 'import', 'export'], fields: ['target', 'scope'], notes: 'Check runs existing quality check. acceptFinding requires an exact current quality finding title/key. Open needs an exact available catalogue. Import opens existing upload guidance. Export only when explicitly requested; scope all exports all catalogues only when user explicitly asked for all. Never export to verify an edit.' },
]

export const BOT_CAPABILITY_GUIDANCE = `Interpret requests against this executable capability registry: ${JSON.stringify(BOT_CAPABILITIES)}
For product, photo or catalogue operations return kind "catalogue_intent" and text containing JSON {"domain":"product|photo|catalogue","operation":"one listed operation","target":"real product code/name or catalogue","name":"new name only when supplied by the user","direction":"up|down","finish":"optional exact finish","adjustment":"optional supported photo adjustment","angle":90,"unfulfilledConstraints":[]}.
For display and imagePage operations you may return kind catalogue_intent with the same target/source/placement/pagePosition fields used by display_intent, or the existing display_intent. Use the full conversation and all positive and negative requirements. A product mentioned after "jangan", "bukan" or "except" is not automatically another target. Never perform a partial interpretation that drops a condition. If a requirement cannot be carried out by the available functions, list it in unfulfilledConstraints and explain specifically; do not claim it was followed. Keep unsupported operations explicit instead of inventing tools or pretending success. Destructive and data-changing actions remain proposals requiring Apply. Multiple dependent operations that cannot be represented safely need one concise clarification, not a partially executed plan. Do not invent new names, dimensions, images or product codes.`

export function needsSemanticReview(text, candidate) {
  if (!candidate?.propose && !candidate?.run) return false
  // A valid local match can still be wrong when it covers only one clause.
  // Review conflicting named targets, exclusions and multiple action clauses.
  const words = text.replace(/\b(?:jangan|do not|don't)\s+(?:buang|remove|ubah|change)\s+(?:background|latar belakang)\b/gi, '')
  const codes = [...new Set([...words.matchAll(/\b[A-Z]{1,4}\s?\d{1,4}[A-Z]?\b/gi)].map(m => m[0].toUpperCase().replace(/\s/g, '')))]
  if (codes.length > 1 && /\b(jangan|bukan|kecuali|except|not|don't|do not)\b/i.test(words)) return true
  if (/\b(?:dan|and|tetapi|tapi|but|kemudian|then|sebaliknya|instead)\b.{0,50}\b(?:padam|buang|hapuskan|delete|remove|rename|namakan|tukar|gantikan|replace|pindah(?:kan)?|move|tambah(?:kan)?|add)\b/i.test(words)) return true
  // A keyword match within conversational language is only a candidate.
  // Only a complete, short command can bypass semantic interpretation.
  const code = '[A-Z]{1,4}[ -]?\\d{1,4}[A-Z]?'
  const atomic = [
    `^(?:add|tambah|create)(?:\\s+(?:a|new|product|produk))*\\s+${code}(?:\\s+(?:dalam|to|in)(?: this)?\\s+(?:catalogue|catalog|katalog))?$`,
    `^(?:delete|padam|buang|remove)\\s+${code}$`,
    `^rename\\s+${code}\\s+to\\s+${code}$`,
    `^move\\s+${code}\\s+(?:up|down)$`,
    `^(?:show(?: me)?|find|tunjuk(?:kan)?)\\s+${code}$`,
    '^(?:run a quality check|quality check|semak kualiti|download pdf|download all as pdf)$',
    '^(?:gambar|image|photo)\\s+(?:ni|ini|this)\\s+(?:untuk|for)\\s+[A-Z]{1,8}\\s+(?:series|siri)$',
    '^product\\s+[A-Z]{1,8}\\s+series$',
  ]
  return !atomic.some(pattern => new RegExp(pattern, 'i').test(text.trim()))
}
