/**
 * Copies Latin Geist woff2 files into public/fonts for preload + optional display.
 * Run after upgrading @fontsource-variable/geist* packages: node scripts/sync-fonts.mjs
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'fonts')

const copies = [
  [
    '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
    'geist-latin.woff2',
  ],
  [
    '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
    'geist-mono-latin.woff2',
  ],
]

mkdirSync(outDir, { recursive: true })

for (const [fromRel, name] of copies) {
  const src = join(root, 'node_modules', fromRel)
  const dest = join(outDir, name)
  copyFileSync(src, dest)
  console.log(`sync-fonts: ${name}`)
}
