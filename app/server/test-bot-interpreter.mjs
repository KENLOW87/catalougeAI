import assert from 'node:assert/strict'
import { interpreterPayload, resolveInterpretedIntent } from '../src/lib/bot-interpreter.js'
import { conversationContext, CONVERSATION_GUIDANCE } from './display-intent.mjs'
const items = [{ id: 'wb', name: 'WB08 (Bare Finish)', photo: 'PRIVATE-PHOTO', examples: [{ image: 'PRIVATE-DISPLAY', displayId: 'chosen', origin: 'manual-display', addedAt: 100 }] }]
const category = { isDefault: true, title: 'Test', fields: () => [{ key: 'photo', type: 'image' }] }
const log = [{ who: 'you', text: 'Gambar ni untuk WB series' }, { who: 'bot', text: '', propose: { summary: 'Tambah WB display', detail: 'Preview', action: { type: 'addDisplayImage', value: 'PRIVATE-ACTION', ids: ['wb'] }, preview: 'PRIVATE-PREVIEW' } }]
const request = interpreterPayload({ text: 'letak dekat siri yang tadi', items, category, log, hasAttachment: true,
  context: { displayId: 'chosen', value: 'PRIVATE-CONTEXT', ids: ['wb'] }, localReply: 'Saya tak jumpa siri itu' })
const encoded = JSON.stringify(request)
for (const value of ['PRIVATE-PHOTO', 'PRIVATE-DISPLAY', 'PRIVATE-ACTION', 'PRIVATE-PREVIEW', 'PRIVATE-CONTEXT']) assert.ok(!encoded.includes(value))
assert.match(encoded, /Gambar ni untuk WB series/)
assert.equal(request.conversation[1].proposal.status, 'pending')
assert.match(conversationContext(request), /Saya tak jumpa siri itu/)
assert.match(CONVERSATION_GUIDANCE, /failed preliminary guess/)
const ctx = { items, category, context: { displayId: 'chosen', value: 'PRIVATE-DISPLAY', ids: ['wb'] } }
const moved = resolveInterpretedIntent({ kind: 'display_intent', text: JSON.stringify({ operation: 'move', source: { displayId: 'chosen' }, target: { type: 'product', value: 'WB08' }, placement: { mode: 'beside-product' } }) }, ctx)
assert.equal(moved.propose.action.type, 'moveDisplayImage')
assert.deepEqual(moved.propose.action.ids, ['wb'])
const converted = resolveInterpretedIntent({ intent: { operation: 'page', source: { displayId: 'chosen' } } }, ctx)
assert.equal(converted.propose.action.type, 'addImagePage')
assert.equal(converted.propose.preview, 'PRIVATE-DISPLAY')
assert.ok(resolveInterpretedIntent({ intent: { operation: 'move', source: { displayId: 'missing' }, target: { type: 'product', value: 'WB08' } } }, ctx).reply)
assert.ok(resolveInterpretedIntent({ text: 'invalid JSON' }, ctx).reply)
console.log('Interpreter context: bounded conversation/pending plans, preliminary clarification reaches AI, no image bytes, real short-code aliases, exact display identity, full-page action and malformed/stale response safety. No API calls.')
