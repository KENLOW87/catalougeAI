import { summarise } from './ask.js'
import { displayInventory, planDisplayIntent, resolveProductReference } from './display-planner.js'
import { proposeImagePage } from './image-page.js'
import { proposeImageRemoval, isImageRemovalRequest } from './image-removal.js'
import { photoTargets } from './commands.js'
import { BOT_CAPABILITIES } from './bot-capabilities.js'
import { resolveDisplaySeries } from './display-image.js'

// Only small, explicit text fields leave the browser. In particular, action
// values, attachments and preview/image data must never enter conversation history.
export function interpreterPayload({ text, items, category, log = [], hasAttachment, findings = [], context, localReply, catalogues = [] }) {
  return {
    text, summary: summarise(items, category), hasAttachment: Boolean(hasAttachment),
    findingTitles: findings.map(f => f.title), displayInventory: displayInventory(items),
    catalogues: catalogues.map(c => ({ id: c.id, title: c.title })),
    photoInventory: items.filter(p => !p.isPage).map(p => ({ id: p.id, name: p.name,
      targets: typeof category?.fields === 'function' ? photoTargets(category, p).map(target => ({
        label: target.label, finish: target.match, key: target.targetKey, itemId: target.targetItemId,
      })) : [],
    })),
    pageInventory: items.filter(p => p.isPage).map(p => ({ id: p.id, name: p.name, origin: p.origin })),
    pageLayout: typeof category?.paginate === 'function' ? category.paginate(items).map((page, i) => ({
      number: i + 1, imagePageId: page.plate?.id, productIds: (page.rows ?? []).flatMap(row => row.map(p => p.id)),
    })) : [],
    displayContext: context ? { displayId: context.displayId, ids: context.ids, kind: context.kind, pageId: context.pageId, targetKey: context.targetKey } : null,
    localClarification: localReply ?? null,
    conversation: log.slice(-10).map(message => ({
      role: message.who === 'you' ? 'user' : 'assistant',
      text: String(message.text ?? '').slice(0, 1500),
      ...(message.propose ? { proposal: {
        summary: message.propose.summary, detail: message.propose.detail,
        status: message.done ? 'completed' : 'pending',
        action: { type: message.propose.action?.type, ids: message.propose.action?.ids,
          label: message.propose.action?.label, displayId: message.propose.action?.displayId, pageId: message.propose.action?.pageId },
      } } : {}),
    })),
  }
}

export function resolveInterpretedIntent(data, { items, category, attachment, context, text = '' }) {
  let intent
  try { intent = data.intent ?? JSON.parse(data.text) } catch {
    return { reply: 'AI memulangkan arahan yang tidak sah. Tiada perubahan dibuat; cuba nyatakan semula tindakan yang dikehendaki.' }
  }
  if (!intent || Array.isArray(intent) || intent.actions) return { reply: 'Tafsiran memerlukan beberapa tindakan yang belum dapat dipadankan dengan selamat. Tiada perubahan dibuat.' }
  if (intent.unfulfilledConstraints != null && !Array.isArray(intent.unfulfilledConstraints)) return { reply: 'Tafsiran syarat tidak sah. Tiada perubahan dibuat.' }
  if (intent.unfulfilledConstraints?.length) return { reply: `Bahagian arahan ini belum dapat dilaksanakan: ${intent.unfulfilledConstraints.map(String).join('; ')}. Tiada perubahan dibuat.` }
  if (intent?.operation === 'remove' && (intent.source?.pageId || intent.source?.kind === 'image-page' ||
      (context?.kind === 'image-page' && !intent.source?.displayId && !intent.source?.product && !intent.source?.series))) {
    const selected = intent.source?.pageId ? { kind: 'image-page', pageId: intent.source.pageId } : context
    return proposeImageRemoval('remove image page', items, category, null, selected)
  }
  if (intent?.operation === 'page') {
    let selected = context
    if (!attachment && intent.source?.pageId) selected = { kind: 'image-page', pageId: intent.source.pageId, ids: [intent.source.pageId] }
    else if (!attachment && intent.source && Object.values(intent.source).some(Boolean)) {
      const removal = planDisplayIntent({ operation: 'remove', source: intent.source }, { items, category, context })
      if (!removal.propose) return removal
      selected = removal.propose.action
    }
    return proposeImagePage(text, items, category, attachment, selected, { pagePosition: intent.pagePosition })
  }
  return planDisplayIntent(intent, { items, category, attachment, context })
}

export function resolveCatalogueIntent(data, ctx) {
  let intent
  try { intent = data.intent ?? JSON.parse(data.text) } catch { return { reply: 'Tafsiran AI tidak sah. Tiada perubahan dibuat.' } }
  if (!intent || Array.isArray(intent) || intent.actions) return { reply: 'Arahan ini memerlukan beberapa tindakan yang belum dapat dipadankan dengan selamat. Tiada perubahan dibuat.' }
  if (!BOT_CAPABILITIES.some(capability => capability.domain === intent.domain && capability.operations.includes(intent.operation))) return { reply: 'Fungsi atau pilihan itu belum tersedia. Tiada perubahan dibuat.' }
  if (intent.unfulfilledConstraints != null && !Array.isArray(intent.unfulfilledConstraints)) return { reply: 'Tafsiran syarat tidak sah. Tiada perubahan dibuat.' }
  if (intent.unfulfilledConstraints?.length) return { reply: `Bahagian arahan ini belum dapat dilaksanakan: ${intent.unfulfilledConstraints.map(String).join('; ')}. Tiada perubahan dibuat.` }
  if (intent.domain === 'display') {
    if (typeof intent.target === 'string') {
      const matches = resolveProductReference(intent.target, ctx.items)
      const series = matches.length ? null : resolveDisplaySeries(intent.target, ctx.items)
      if (matches.length === 1) intent = { ...intent, target: { type: 'product', value: matches[0].name } }
      else if (series && !series.reply) intent = { ...intent, target: { type: 'series', value: series.family } }
      else return { reply: 'Produk atau siri sasaran tidak jelas. Tiada perubahan dibuat.' }
    }
    return resolveInterpretedIntent({ intent }, ctx)
  }
  if (intent.domain === 'imagePage') {
    if (intent.operation === 'remove') return proposeImageRemoval('remove image page', ctx.items, ctx.category, null,
      intent.source?.pageId ? { kind: 'image-page', pageId: intent.source.pageId } : ctx.context)
    return resolveInterpretedIntent({ intent: { ...intent, operation: 'page' } }, ctx)
  }
  const { items, category, attachment, catalogues = [], text = '' } = ctx
  if (intent.domain === 'catalogue') {
    if (intent.operation === 'check') return { run: { type: 'qc' } }
    if (intent.operation === 'import') return { run: { type: 'import' } }
    if (intent.operation === 'acceptFinding') {
      const matches = (ctx.findings ?? []).filter(f => f.key === intent.target || f.title === intent.target)
      return matches.length === 1 ? { run: { type: 'accept', key: matches[0].key, label: matches[0].title } } : { reply: 'Finding yang hendak disahkan tidak jelas. Nyatakan finding semasa yang betul.' }
    }
    if (intent.operation === 'open') {
      const matches = catalogues.filter(c => c.id === intent.target || c.title?.toLowerCase() === String(intent.target).toLowerCase())
      return matches.length === 1 ? { run: { type: 'open', id: matches[0].id, label: matches[0].title } } : { reply: 'Katalog sasaran tidak jelas. Nyatakan katalog yang tersedia.' }
    }
    if (intent.operation === 'export' && /\b(export|eksport|download|muat turun)\b/i.test(text)) return { run: { type: intent.scope === 'all' && /\b(all|semua)\b/i.test(text) ? 'exportAll' : 'export' } }
    return { reply: 'Tindakan katalog itu belum disokong atau belum diminta dengan jelas. Tiada perubahan dibuat.' }
  }
  if (intent.domain === 'photo' && intent.operation === 'backgroundAll') return /\b(all|semua)\b/i.test(text) && /\b(background|latar|isolate|asingkan)\b/i.test(text)
    ? { run: { type: 'preparePhotos' } } : { reply: 'Mengasingkan semua gambar memerlukan arahan jelas untuk semua foto produk. Tiada gambar diproses.' }
  if (!['product', 'photo'].includes(intent.domain)) return { reply: 'Fungsi yang diminta belum tersedia dalam katalog ini. Tiada perubahan dibuat.' }
  if (intent.domain === 'product' && intent.operation === 'add') {
    const name = String(intent.name ?? intent.target ?? '').trim()
    if (!name || !text.toLowerCase().includes(name.toLowerCase())) return { reply: 'Nyatakan nama/kod produk baharu. Bot tidak mereka produk atau gambar.' }
    return { run: { type: 'addProduct', value: name, photo: attachment } }
  }
  const matches = resolveProductReference(intent.target, items)
  if (matches.length !== 1) return { reply: 'Produk sasaran tidak ditemui atau tidak unik. Nyatakan kod/nama sebenar.' }
  const product = matches[0]
  const proposal = (summary, detail, action, preview) => ({ propose: { summary, detail, action: { ids: [product.id], label: product.name, ...action }, ...(preview ? { preview } : {}) } })
  if (intent.domain === 'product') {
    if (intent.operation === 'show') return { run: { type: 'reveal', ids: [product.id], label: product.name } }
    if (intent.operation === 'remove') {
      if (isImageRemovalRequest(text)) return proposeImageRemoval(text, items, category, attachment, ctx.context)
      const result = proposal(`Buang produk ${product.name}?`, 'Seluruh produk, gambar dan drawing akan dibuang selepas Apply. Semak sasaran sebelum sahkan.', { type: 'delete' })
      result.propose.danger = true
      return result
    }
    if (intent.operation === 'rename') {
      const name = String(intent.name ?? '').trim()
      if (!name || name.length > 200 || !text.toLowerCase().includes(name.toLowerCase())) return { reply: 'Nyatakan nama baharu yang tepat untuk produk ini.' }
      return proposal(`Tukar nama ${product.name} kepada ${name}?`, 'Hanya nama berubah. Gambar, drawing dan display dikekalkan.', { type: 'rename', value: name })
    }
    if (intent.operation === 'move' && ['up', 'down'].includes(intent.direction)) return proposal(`Pindahkan ${product.name} satu tempat ${intent.direction === 'up' ? 'ke atas' : 'ke bawah'}?`, 'Pengelompokan dan susunan sumber yang dilindungi kekal berkuat kuasa.', { type: 'move', value: intent.direction === 'up' ? -1 : 1 })
  } else {
    const finish = String(intent.finish ?? '').trim()
    if (typeof category?.fields !== 'function') return { reply: 'Medan gambar produk tidak tersedia dalam katalog ini.' }
    const targets = photoTargets(category, product)
    const selected = finish ? targets.filter(target => target.match?.toLowerCase() === finish.toLowerCase()) : targets
    if (selected.length !== 1) return { reply: `Pilih gambar/finish untuk ${product.name}: ${targets.map(target => target.label).join(', ')}.` }
    const target = selected[0]
    const current = target.targetItemId ? product[target.targetKey]?.find(item => item.id === target.targetItemId)?.photo : product[target.targetKey]
    if (intent.operation === 'replace') return attachment ? proposal(`Ganti gambar ${product.name}?`, 'Hanya gambar sasaran diganti dengan lampiran asal. Drawing dan display dikekalkan.', { type: 'replacePhoto', ...target, value: attachment }, attachment) : { reply: 'Lampirkan gambar baharu dahulu.' }
    if (!current) return { reply: 'Gambar sasaran belum tersedia. Tiada perubahan dibuat.' }
    if (intent.operation === 'remove') return proposal(`Buang gambar sahaja — ${product.name}?`, 'Produk, drawing, ukuran dan gambar lain dikekalkan.', { type: 'clearProductPhoto', ...target, value: current }, current)
    if (intent.operation === 'background') return proposal(`Asingkan produk — ${product.name}?`, 'Editor gambar mengasingkan produk tanpa mengubah orientasi asal. Semak hasil sebelum Apply.', { type: 'removeBackground', ...target, value: current }, current)
    if (intent.operation === 'adjust' && ['brighten', 'darken', 'contrast', 'flip', 'rotate'].includes(intent.adjustment)) {
      if (intent.adjustment === 'rotate' && ![90, 180, 270].includes(intent.angle)) return { reply: 'Nyatakan sudut rotation 90, 180 atau 270 darjah.' }
      return proposal(`Laras gambar — ${product.name}`, 'Semak hasil sebelum Apply.', { type: 'adjustPhoto', ...target, value: current, operation: intent.adjustment, angle: intent.angle }, current)
    }
  }
  return { reply: 'Fungsi atau pilihan itu belum disokong. Tiada perubahan dibuat; layout asal dikekalkan.' }
}
