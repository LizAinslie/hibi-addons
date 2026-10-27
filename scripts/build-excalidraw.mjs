import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = join(root, 'src/excalidraw')
const output = join(root, 'addons/excalidraw')
const excalidraw = join(root, 'node_modules/@excalidraw/excalidraw')
const production = join(excalidraw, 'dist/prod')
const PREFIX = '.hibi-excalidraw-root'
const MAX_ENTRIES = 1000
const MAX_TOTAL = 25 * 1024 * 1024
const MAX_FILE = 5 * 1024 * 1024

const shims = {
  react: join(source, 'shims/react.js'),
  'react/jsx-runtime': join(source, 'shims/jsx-runtime.js'),
  'react/jsx-dev-runtime': join(source, 'shims/jsx-runtime.js'),
  'react-dom': join(source, 'shims/react-dom.js'),
  'react-dom/client': join(source, 'shims/react-dom-client.js'),
}

const reactAlias = {
  name: 'hibi-react-shims',
  setup(build) {
    build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => {
      const path = shims[args.path]
      return path ? { path } : undefined
    })
    build.onResolve({ filter: /^react-dom(\/.*)?$/ }, (args) => {
      const path = shims[args.path]
      if (path) return { path }
      if (args.path === 'react-dom/test-utils') {
        return { path: shims['react-dom'], namespace: 'hibi-shim' }
      }
      throw new Error(`Unsupported ReactDOM import: ${args.path}`)
    })
  },
}

function keyframes(css) {
  const names = new Set()
  for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)) {
    names.add(match[1])
  }
  return names
}

function scopeCss(css) {
  const names = keyframes(css)
  const prefixed = new Map(
    [...names].map((name) => [name, `hibi-excalidraw-${name}`]),
  )
  const plugin = {
    postcssPlugin: 'hibi-excalidraw-scope',
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
          if (value === ':root') return PREFIX
          if (value.startsWith(':root ')) return value.replace(':root', PREFIX)
          if (value.startsWith(':root[')) return value.replace(':root', PREFIX)
          if (/^\[dir=(ltr|rtl)\]/.test(value)) {
            return `${PREFIX}${value.replace(
              /\.excalidraw\s+/,
              '',
            )}`
          }
          if (value.startsWith('body.excalidraw-cursor-resize')) {
            return `body.excalidraw-cursor-resize ${PREFIX} *`
          }
          if (value.startsWith(`${PREFIX} `) || value === PREFIX) return value
          if (value === '.excalidraw') return `${PREFIX} .excalidraw`
          if (value.startsWith('.excalidraw ')) {
            return `${PREFIX} ${value.slice('.excalidraw '.length)}`
          }
          return `${PREFIX} ${value}`
        })
      })
    },
  }
  return postcss([plugin]).process(css, { from: undefined }).css
}

async function bundle() {
  mkdirSync(output, { recursive: true })
  for (const name of ['index.js', 'editor.js', 'chunks', 'fonts', 'excalidraw.css']) {
    rmSync(join(output, name), { recursive: true, force: true })
  }

  await build({
    absWorkingDir: root,
    entryPoints: {
      index: join(source, 'index.js'),
      editor: join(source, 'editor.jsx'),
    },
    outdir: output,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome130'],
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [reactAlias],
  })

  copyFileSync(join(source, 'host.css'), join(output, 'host.css'))
  const rawCss = readFileSync(join(production, 'index.css'), 'utf8')
  writeFileSync(join(output, 'excalidraw.css'), scopeCss(rawCss))
  cpSync(join(production, 'fonts'), join(output, 'fonts'), { recursive: true })
}

function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function checkPackage() {
  const files = walk(output)
  let total = 0
  let largest = 0
  for (const file of files) {
    const size = statSync(file).size
    total += size
    largest = Math.max(largest, size)
    if (size > MAX_FILE) {
      throw new Error(
        `${relative(root, file)} is ${(size / (1024 * 1024)).toFixed(1)} MiB; Hibi allows 5 MiB per file.`,
      )
    }
  }
  if (files.length > MAX_ENTRIES) {
    throw new Error(`The package has ${files.length} entries; Hibi allows ${MAX_ENTRIES}.`)
  }
  if (total > MAX_TOTAL) {
    throw new Error(
      `The package is ${(total / (1024 * 1024)).toFixed(1)} MiB; Hibi allows 25 MiB.`,
    )
  }
  const manifest = readFileSync(join(output, 'hibi-addon.json'))
  if (manifest.length > 64 * 1024) throw new Error('hibi-addon.json exceeds 64 KiB.')
  console.log(
    `Package: ${files.length} entries, ${(total / (1024 * 1024)).toFixed(1)} MiB total, largest ${(largest / 1024).toFixed(0)} KiB.`,
  )
}

await bundle()
checkPackage()
