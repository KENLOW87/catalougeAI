// The assistant's upload flow, driven in a real browser.
//
// What is being pinned:
//   1. the panel has a file input of its own, so a file can be handed over in chat
//   2. handing one over opens the REVIEW dialog — never a shortcut past it
//   3. the dialog starts reading immediately instead of asking for the file again
//   4. cancelling says so in the chat, rather than leaving the assistant silent
//
// The last one is the point of the change: the assistant starting a job and then
// never mentioning how it went is what made it feel like a button.
//
//   node server/test-bot-upload.mjs
//
// Needs `npm start` running.

import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.APP_URL ?? 'http://localhost:5173'

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ].find(p => p && existsSync(p))
}

let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}`)
  if (!ok) failed++
}

const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: 'new', args: ['--no-sandbox'],
  // Reading a PDF takes minutes; the default 30 s protocol timeout kills the wait
  // long before the review screen can appear.
  protocolTimeout: 600_000,
})
const page = await browser.newPage()

try {
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60_000 })
  await page.waitForSelector('.bot-bubble', { timeout: 20_000 })

  // Open a catalogue so the editor (and its own import button) is in play.
  await page.evaluate(() => {
    const open = [...document.querySelectorAll('button')].find(b => /^Open\b/i.test(b.textContent))
    if (open) open.click()
  })
  await new Promise(r => setTimeout(r, 600))

  await page.click('.bot-bubble')
  await page.waitForSelector('.bot-dock', { timeout: 10_000 })

  const hasInput = await page.$('.bot-dock input[type=file]')
  check(!!hasInput, 'the assistant has its own file input — the file is handed over in chat')

  const uploadLabel = await page.$$eval('.bot-tools button', bs =>
    bs.map(b => b.textContent.trim()).find(t => /upload/i.test(t)) ?? '')
  check(/upload/i.test(uploadLabel), `the panel offers "${uploadLabel}"`)

  // Hand over a small PDF exactly as the admin would.
  const pdf = '../test 3.pdf'
  if (!existsSync(pdf)) {
    console.log(`  skip  ${pdf} not found — cannot exercise the handover`)
  } else {
    await hasInput.uploadFile(pdf)

    // The review dialog must appear. Nothing may be saved without it.
    await page.waitForSelector('.modal--wide', { timeout: 30_000 })
    check(true, 'handing over a file opens the review dialog')

    // And it must already be reading, not asking for the file a second time.
    const state = await page.evaluate(() => ({
      working: !!document.querySelector('.working'),
      stillAsking: [...document.querySelectorAll('.modal--wide button')]
        .some(b => /choose (a )?(pdf|file)/i.test(b.textContent)),
    }))
    check(state.working, 'it starts reading straight away')
    check(!state.stillAsking, 'it does not ask for the file again')

    // Wait for the review screen — the step that must never be skipped — then
    // cancel from there. (While it is READING there is no cancel button at all;
    // that is a separate gap, noted but not changed here.)
    await page.waitForSelector('.drafts', { timeout: 240_000 })
    check(true, 'the review screen appears, with the drafts to check')

    await page.evaluate(() => {
      const cancel = [...document.querySelectorAll('.modal--wide button')]
        .find(b => /^(cancel|close)$/i.test(b.textContent.trim()))
      if (cancel) cancel.click()
    })
    await new Promise(r => setTimeout(r, 900))
    const said = await page.evaluate(() =>
      [...document.querySelectorAll('.bot-msg')].map(n => n.textContent).join(' | '))
    check(/cancelled/i.test(said), 'the assistant reports the cancellation in the chat')
    check(/Reading that PDF/i.test(said), 'and it acknowledged the file when it was handed over')
  }
} catch (e) {
  console.log('  FAIL  ' + e.message)
  failed++
} finally {
  await browser.close()
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
