import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, relative } from 'node:path'
import postcss from 'postcss'

const PREFIX = '.hibi-addon-root'
const KEYFRAME_PREFIX = 'hibi-addon-'
const MAX_ENTRIES = 1000
const MAX_TOTAL = 25 * 1024 * 1024
const MAX_FILE = 5 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.md',
  '.txt',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp3',
  '.ogg',
  '.wav',
])

export const defaultGenerated = [
  'index.js',
  'editor.js',
  'chunks',
  'assets',
  'fonts',
  'excalidraw.css',
  'host.css',
]

export function reactShims(sourceDir) {
  const shims = {
    react: join(sourceDir, 'shims/react.js'),
    'react/jsx-runtime': join(sourceDir, 'shims/jsx-runtime.js'),
    'react/jsx-dev-runtime': join(sourceDir, 'shims/jsx-runtime.js'),
    'react-dom': join(sourceDir, 'shims/react-dom.js'),
    'react-dom/client': join(sourceDir, 'shims/react-dom-client.js'),
    'react-dom/test-utils': join(sourceDir, 'shims/react-dom.js'),
  }
  return {
    name: 'hibi-react-shims',
    enforce: 'pre',
    resolveId(source) {
      return shims[source] ?? null
    },
  }
}

function keyframes(css) {
  const names = new Set()
  for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)) {
    names.add(match[1])
  }
  return names
}

export function scopeCss(
  css,
  {
    prefix = PREFIX,
    keyframePrefix = KEYFRAME_PREFIX,
    rootSelector = '.excalidraw',
  } = {},
) {
  const names = keyframes(css)
  const prefixed = new Map(
    [...names].map((name) => [name, `${keyframePrefix}${name}`]),
  )
  const plugin = {
    postcssPlugin: 'hibi-addon-scope',
    Once(root) {
      root.walkAtRules((rule) => {
        if (rule.name !== 'keyframes' && rule.name !== '-webkit-keyframes') return
        const next = prefixed.get(rule.params.trim())
        if (next) rule.params = next
      })
      root.walkDecls((decl) => {
        if (!/^(-webkit-)?animation(-name)?$/.test(decl.prop)) return
        decl.value = decl.value.replace(
          /([\w-]+)/g,
          (name) => prefixed.get(name) ?? name,
        )
      })
      root.walkRules((rule) => {
        if (
          rule.parent?.type === 'atrule' &&
          (rule.parent.name === 'keyframes' ||
            rule.parent.name === '-webkit-keyframes' ||
            rule.parent.name === 'font-face')
        ) {
          return
        }
        rule.selectors = rule.selectors.map((selector) => {
          const value = selector.trim()
          if (!value) return value
          if (value === ':root') return prefix
          if (value.startsWith(':root ')) return value.replace(':root', prefix)
          if (value.startsWith(':root[')) return value.replace(':root', prefix)
          if (/^\[dir=(ltr|rtl)\]/.test(value)) {
            const escapedRoot = rootSelector.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            )
            return `${prefix}${value.replace(
              new RegExp(`${escapedRoot}\\s+`),
              '',
            )}`
          }
          if (value.startsWith('body.excalidraw-cursor-resize')) {
            return `body.excalidraw-cursor-resize ${prefix} *`
          }
          if (value.startsWith(`${prefix} `) || value === prefix) return value
          if (value === rootSelector) return `${prefix} ${rootSelector}`
          if (value.startsWith(`${rootSelector} `)) {
            return `${prefix} ${value.slice(rootSelector.length + 1)}`
          }
          return `${prefix} ${value}`
        })
      })
    },
  }
  return postcss([plugin]).process(css, { from: undefined }).css
}

function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function checkPackage(output, packageRoot) {
  const files = walk(output)
  let total = 0
  let largest = 0
  for (const file of files) {
    const extension = extname(file)
    if (!extension) {
      throw new Error(
        `Hibi will not install extensionless file ${relative(packageRoot, file)}.`,
      )
    }
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(
        `Hibi will not install ${relative(packageRoot, file)} (${extension}).`,
      )
    }
    const size = statSync(file).size
    total += size
    largest = Math.max(largest, size)
    if (size > MAX_FILE) {
      throw new Error(
        `${relative(packageRoot, file)} is ${(size / (1024 * 1024)).toFixed(1)} MiB; Hibi allows 5 MiB per file.`,
      )
    }
  }
  if (files.length > MAX_ENTRIES) {
    throw new Error(
      `The package has ${files.length} entries; Hibi allows ${MAX_ENTRIES}.`,
    )
  }
  if (total > MAX_TOTAL) {
    throw new Error(
      `The package is ${(total / (1024 * 1024)).toFixed(1)} MiB; Hibi allows 25 MiB.`,
    )
  }
  const manifest = readFileSync(join(output, 'hibi-addon.json'))
  if (manifest.length > 64 * 1024) {
    throw new Error('hibi-addon.json exceeds 64 KiB.')
  }
  console.log(
    `Package: ${files.length} entries, ${(total / (1024 * 1024)).toFixed(1)} MiB total, largest ${(largest / 1024).toFixed(0)} KiB.`,
  )
}

function packageRootPath(require, packageName) {
  let directory = dirname(require.resolve(packageName))
  for (;;) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === packageName) {
          return directory
        }
      } catch {}
    }
    const parent = dirname(directory)
    if (parent === directory) {
      throw new Error(`Could not find the root of ${packageName}.`)
    }
    directory = parent
  }
}

function packageFile(require, packageName, file) {
  return join(packageRootPath(require, packageName), file)
}

export function hibiAddon({
  packageRoot,
  outDir,
  generated = defaultGenerated,
  css = null,
  fonts = null,
  hostCss = null,
}) {
  const require = createRequire(join(packageRoot, 'package.json'))

  return {
    name: 'hibi-addon-package',
    buildStart() {
      mkdirSync(outDir, { recursive: true })
      for (const name of generated) {
        rmSync(join(outDir, name), { recursive: true, force: true })
      }
    },
    writeBundle() {
      if (fonts) {
        cpSync(
          packageFile(require, fonts.packageName, fonts.file),
          join(outDir, fonts.output ?? 'fonts'),
          { recursive: true },
        )
      }
      if (css) {
        const raw = readFileSync(
          packageFile(require, css.packageName, css.file),
          'utf8',
        )
        writeFileSync(
          join(outDir, css.output ?? 'style.css'),
          scopeCss(raw, css),
        )
      }
      if (hostCss) {
        copyFileSync(hostCss, join(outDir, basename(hostCss)))
      }
      checkPackage(outDir, packageRoot)
    },
  }
}
