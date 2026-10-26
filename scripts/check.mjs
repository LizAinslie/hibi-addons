#!/usr/bin/env node
// Checks the packages Hibi would find when it installs this repository.
// Hibi's installer has the final say; this catches common mistakes before you share.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOWED = new Set(
  '.js .mjs .json .css .woff .woff2 .ttf .svg .png .jpg .jpeg .webp .gif .mp3 .ogg .wav .md .txt'.split(
    ' ',
  ),
)
const ID = /^[a-z][a-z0-9-]{0,47}$/
const HEX = /^#[\da-f]{6}$/i
const REQUIRED_COLORS = [
  'background',
  'surface',
  'ink',
  'muted',
  'accent',
  'border',
]
// Every color name Hibi accepts. Hibi derives the ones a theme leaves out.
const COLORS = new Set([
  ...REQUIRED_COLORS,
  'sidebar',
  'overlay',
  'hover',
  'active',
  'selection',
  'selection-ink',
  'caret',
  'code-background',
  'code-ink',
  'syntax-heading',
  'syntax-link',
  'syntax-code',
  'syntax-meta',
  'syntax-quote',
  'syntax-strong',
  'syntax-emphasis',
  'syntax-keyword',
  'syntax-string',
  'syntax-number',
  'syntax-comment',
  'syntax-type',
  'syntax-function',
  'syntax-variable',
  'syntax-operator',
  'status-success',
  'status-warning',
  'status-danger',
  'status-info',
])
const hidden = (name) =>
  name.startsWith('.') ||
  ['node_modules', '__macosx'].includes(name.toLowerCase())

function files(root, folder = root) {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !hidden(entry.name))
    .flatMap((entry) => {
      const path = join(folder, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`${relative(root, path)} is a symbolic link.`)
      return entry.isDirectory()
        ? files(root, path)
        : [relative(root, path).split(sep).join('/')]
    })
}

function checkTheme(file, value) {
  if (!value || typeof value !== 'object')
    throw new Error(`${file} must contain a JSON object.`)
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value.id))
    throw new Error(
      `${file} needs an id made of lowercase letters, numbers, and hyphens.`,
    )
  for (const key of ['name', 'author'])
    if (typeof value[key] !== 'string' || !value[key].trim())
      throw new Error(`${file} needs a ${key}.`)
  if (!['light', 'dark'].includes(value.appearance))
    throw new Error(`${file} needs "appearance": "light" or "dark".`)
  if (!value.license?.name?.trim() || !value.license?.text?.trim())
    throw new Error(`${file} needs license.name and license.text.`)
  for (const color of REQUIRED_COLORS)
    if (!HEX.test(value.colors?.[color] ?? ''))
      throw new Error(`${file} needs a six-digit hex color for ${color}.`)
  for (const [color, hex] of Object.entries(value.colors))
    if (!COLORS.has(color) || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(hex))
      throw new Error(
        `${file} has an unknown color name or invalid hex value: ${color}.`,
      )
}

/** Returns the checked packages as { folder, manifest }. */
export function checkRepository(root) {
  const all = files(root)
  const folders = all
    .filter((path) => path.split('/').at(-1) === 'hibi-addon.json')
    .map((path) => path.slice(0, -'hibi-addon.json'.length).replace(/\/$/, ''))
  if (!folders.length) throw new Error('No hibi-addon.json was found.')
  for (const a of folders)
    for (const b of folders)
      if (a !== b && (!a || b.startsWith(`${a}/`)))
        throw new Error(
          `Package folders overlap: ${a || '.'} and ${b}. Keep each package in its own folder.`,
        )
  const ids = new Map()
  return folders.map((folder) => {
    const prefix = folder ? `${folder}/` : ''
    const own = all
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
    const label = folder || '.'
    for (const path of own)
      if (!ALLOWED.has(extname(path).toLowerCase()))
        throw new Error(
          `${label}: Hibi does not install ${path}. Rename license files to LICENSE.txt or LICENSE.md.`,
        )
    if (!own.includes('README.md'))
      throw new Error(`${label}: add a README.md.`)
    const manifest = JSON.parse(
      readFileSync(join(root, prefix, 'hibi-addon.json'), 'utf8'),
    )
    if (!ID.test(manifest.id ?? ''))
      throw new Error(
        `${label}: the id must be 1–48 lowercase letters, numbers, or hyphens.`,
      )
    if (ids.has(manifest.id))
      throw new Error(
        `${label}: ${ids.get(manifest.id)} already uses the id ${manifest.id}.`,
      )
    ids.set(manifest.id, label)
    for (const key of ['name', 'description', 'version'])
      if (typeof manifest[key] !== 'string' || !manifest[key].trim())
        throw new Error(`${label}: add a ${key}.`)
    if (manifest.apiVersion !== 2)
      throw new Error(`${label}: set "apiVersion": 2.`)
    if (
      !manifest.authors?.length ||
      manifest.authors.some((author) => !author?.displayName?.trim())
    )
      throw new Error(`${label}: list at least one author with a displayName.`)
    if (!own.some((path) => /^licen[cs]e(\.|$)/i.test(path)))
      throw new Error(`${label}: add LICENSE.txt or LICENSE.md.`)
    if (manifest.kind === 'theme') {
      if (
        [
          'entry',
          'capabilities',
          'activation',
          'commands',
          'styles',
          'dependencies',
        ].some((key) => key in manifest)
      )
        throw new Error(
          `${label}: themes contain color schemes only, without code.`,
        )
      if (!manifest.themes?.length)
        throw new Error(`${label}: list at least one theme file in "themes".`)
      for (const theme of manifest.themes) {
        if (typeof theme === 'string' && !own.includes(theme))
          throw new Error(`${label}: ${theme} is missing.`)
        checkTheme(
          `${label}/${theme.id ?? theme}`,
          typeof theme === 'string'
            ? JSON.parse(readFileSync(join(root, prefix, theme), 'utf8'))
            : theme,
        )
      }
    } else if (manifest.kind === 'extension') {
      if (
        !/\.m?js$/.test(manifest.entry ?? '') ||
        !own.includes(manifest.entry)
      )
        throw new Error(
          `${label}: "entry" must name a .js or .mjs file in this folder. Hibi does not build addons.`,
        )
      execFileSync(
        process.execPath,
        ['--check', join(root, prefix, manifest.entry)],
        { stdio: 'pipe' },
      )
      if (manifest.activation === 'command' && !manifest.commands?.length)
        throw new Error(
          `${label}: command-activated addons must list their commands.`,
        )
    } else throw new Error(`${label}: set "kind" to "extension" or "theme".`)
    return { folder, manifest }
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)),
  )
  try {
    for (const { folder, manifest } of checkRepository(root))
      console.log(
        `ok ${folder || '.'}: ${manifest.name} ${manifest.version} (${manifest.kind})`,
      )
  } catch (error) {
    console.error(error.stderr?.toString() || error.message)
    process.exitCode = 1
  }
}
