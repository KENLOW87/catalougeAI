import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Windows can have more than one Poppler installation on PATH. Resolve one
// known-good executable and pass its absolute path to every server reader.
const names = new Set(['pdfinfo', 'pdftoppm', 'pdftohtml', 'pdfseparate', 'pdfunite'])
let resolved = new Map()

function candidateDirs() {
  const dirs = []
  if (process.env.POPPLER_BIN) dirs.push(process.env.POPPLER_BIN)

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? ''
    const packages = join(local, 'Microsoft', 'WinGet', 'Packages')
    try {
      for (const packageName of readdirSync(packages)) {
        if (!/poppler/i.test(packageName)) continue
        const packageDir = join(packages, packageName)
        for (const version of readdirSync(packageDir)) {
          dirs.push(join(packageDir, version, 'Library', 'bin'))
        }
      }
    } catch {}

    const profile = process.env.USERPROFILE ?? ''
    dirs.push(join(profile, '.cache', 'codex-runtimes', 'codex-primary-runtime',
      'dependencies', 'native', 'poppler', 'Library', 'bin'))
  }
  return [...new Set(dirs)]
}

export function popplerTool(name) {
  if (!names.has(name)) return name
  if (resolved.has(name)) return resolved.get(name)
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const found = candidateDirs()
    .map(dir => join(dir, `${name}${suffix}`))
    .find(path => existsSync(path))
  const executable = found ?? name
  resolved.set(name, executable)
  return executable
}
