// One-off: push the snapshots sitting in app/data/published/ up to Supabase.
//
// Those files are what the live site used to serve, and they are the only copy
// of what was last published — the admin's working catalogues live in the
// admin's own browser (IndexedDB), not here. Render wiped these files on every
// redeploy and every idle spin-down, which is exactly the bug this move fixes,
// so whatever is still on disk locally is worth carrying over rather than
// asking the admin to re-publish three catalogues by hand.
//
// Safe to re-run: images are content-addressed, so a second run uploads nothing
// and simply rewrites the same rows.
//
//   node server/migrate-published-to-supabase.mjs            # push everything
//   node server/migrate-published-to-supabase.mjs --dry-run  # just report
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read from app/.env like the
// server does.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { isConfigured, putSnapshot, listSnapshots } from './supabase-store.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
if (existsSync(join(__dirname, '../.env'))) loadEnvFile(join(__dirname, '../.env'))

const dryRun = process.argv.includes('--dry-run')
const directory = join(__dirname, '../data/published')
const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`

if (!existsSync(directory)) {
  console.log(`No ${directory} — nothing published locally, nothing to migrate.`)
  process.exit(0)
}

const files = readdirSync(directory).filter(name => name.endsWith('.json'))
if (!files.length) {
  console.log('No snapshots in app/data/published/ — nothing to migrate.')
  process.exit(0)
}

console.log(`Found ${files.length} local snapshot(s):`)
for (const name of files) console.log(`  ${name.padEnd(28)} ${mb(statSync(join(directory, name)).size)}`)

if (!isConfigured()) {
  console.error('\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set — set them in app/.env first.')
  process.exit(1)
}
if (dryRun) {
  console.log('\n--dry-run: stopping here. Supabase is configured, so a real run would push all of the above.')
  process.exit(0)
}

let failed = 0
for (const name of files) {
  const file = join(directory, name)
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`  ${name}: unreadable, skipped — ${error.message}`)
    failed++
    continue
  }
  // The filename is the category id. Trust it over the body, which is what the
  // file backend keyed on.
  const categoryId = name.replace(/\.json$/, '')
  if (!Array.isArray(snapshot?.products) || !snapshot.products.length) {
    console.error(`  ${categoryId}: no products in the snapshot, skipped`)
    failed++
    continue
  }
  try {
    process.stdout.write(`  ${categoryId}: uploading… `)
    const { imageCount, uploaded } = await putSnapshot({ ...snapshot, categoryId })
    console.log(`done — ${snapshot.products.length} products, ${imageCount} images (${uploaded} newly uploaded)`)
  } catch (error) {
    console.log('FAILED')
    console.error(`    ${error.message}`)
    failed++
  }
}

console.log('\nNow published in Supabase:')
for (const row of await listSnapshots()) console.log(`  ${row.categoryId.padEnd(24)} ${row.title} — ${row.publishedAt}`)

if (failed) {
  console.error(`\n${failed} snapshot(s) did not migrate.`)
  process.exit(1)
}
console.log('\nAll local snapshots migrated. These now survive redeploys and idle spin-down.')
