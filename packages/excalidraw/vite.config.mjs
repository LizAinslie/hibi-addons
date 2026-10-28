import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { hibiAddon, reactShims } from '../../build/vite-addon.mjs'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const source = resolve(packageRoot, 'src')
const outDir = fileURLToPath(new URL('../../addons/excalidraw', import.meta.url))

export default defineConfig({
  root: packageRoot,
  base: './',
  plugins: [
    reactShims(source),
    hibiAddon({
      packageRoot,
      outDir,
      css: {
        packageName: '@excalidraw/excalidraw',
        file: 'dist/prod/index.css',
        output: 'excalidraw.css',
        prefix: '.hibi-excalidraw-root',
        keyframePrefix: 'hibi-excalidraw-',
      },
      fonts: {
        packageName: '@excalidraw/excalidraw',
        file: 'dist/prod/fonts',
      },
      hostCss: resolve(source, 'host.css'),
    }),
  ],
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir,
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2022',
    modulePreload: false,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      onwarn(warning, warn) {
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          warning.message.includes('"use client"')
        ) {
          return
        }
        warn(warning)
      },
      input: {
        index: resolve(source, 'index.js'),
        editor: resolve(source, 'editor.jsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
