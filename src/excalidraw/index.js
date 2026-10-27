import {
  blankDocument,
  parseScene,
  summariseScene,
} from './scene.js'
import { canOpenExcalidrawDocument } from './detect.js'
import {
  blankObsidianDocument,
  repairObsidianSource,
} from './obsidian.js'
import {
  flushEditorSessions,
  installHistoryBridge,
  saveEditorSessions,
  shouldHandleSave,
} from './editor-registry.js'

const EDITOR_VIEW_ID = 'canvas'
let nativeFontFace = null
let previousAssetPath

function localFontSource(source) {
  if (typeof source === 'string') {
    const parts = source
      .split(/,\s*(?=url\()/)
      .filter((part) => !/url\(\s*["']?https?:\/\//i.test(part))
    return parts.length ? parts.join(', ') : source
  }
  if (!Array.isArray(source)) return source
  const local = source.filter(
    (entry) => typeof entry !== 'string' || !/^https?:/i.test(entry),
  )
  return local.length ? local : source
}

function installFontFaceFilter() {
  if (nativeFontFace || typeof FontFace === 'undefined') return
  const Native = FontFace
  nativeFontFace = Native
  globalThis.FontFace = new Proxy(Native, {
    construct(target, args) {
      const [family, source, descriptors] = args
      return new target(family, localFontSource(source), descriptors)
    },
  })
}

function removeFontFaceFilter() {
  if (!nativeFontFace) return
  globalThis.FontFace = nativeFontFace
  nativeFontFace = null
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export default ({ React, ui }) => {
  const h = React.createElement
  let context = null
  let view = null
  let lastDocument = null
  const disposers = []
  const autoOpened = new Set()

  const openEditor = () => {
    if (!view) return
    view.open({ id: EDITOR_VIEW_ID, binding: 'follow', focus: true })
  }

  const isCurrentDrawing = () => {
    const document = context?.editor.getDocument() ?? lastDocument
    return Boolean(
      document && canOpenExcalidrawDocument(document.name, document.markdown),
    )
  }

  const maybeAutoOpen = (document) => {
    if (document) lastDocument = document
    if (
      !document ||
      !canOpenExcalidrawDocument(document.name, document.markdown)
    ) {
      return
    }
    if (autoOpened.has(document.tabId)) return
    autoOpened.add(document.tabId)
    try {
      openEditor()
    } catch (error) {
      autoOpened.delete(document.tabId)
      console.error('Could not open the Excalidraw editor:', error)
    }
  }

  function Preview({ value }) {
    const parsed = React.useMemo(() => parseScene(value), [value])
    const summary = parsed.ok ? summariseScene(parsed.data) : null
    return h(
      'div',
      { className: 'hibi-excalidraw-preview' },
      h(
        'div',
        { className: 'hibi-excalidraw-preview__art', 'aria-hidden': 'true' },
        h(
          'svg',
          {
            viewBox: '0 0 64 64',
            width: '48',
            height: '48',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '2.5',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('rect', { x: 9, y: 12, width: 30, height: 30, rx: 3 }),
          h('circle', { cx: 44, cy: 23, r: 6 }),
          h('path', { d: 'M17 51l16-18 9 12 7-7' }),
        ),
      ),
      h(
        'div',
        { className: 'hibi-excalidraw-preview__copy' },
        h('h2', null, 'Excalidraw drawing'),
        parsed.ok
          ? h(
              'p',
              null,
              parsed.empty
                ? 'This drawing is empty.'
                : `${summary.elements} element${summary.elements === 1 ? '' : 's'}${
                    summary.images
                      ? ` · ${summary.images} embedded image${summary.images === 1 ? '' : 's'}`
                      : ''
                  }`,
              h(
                'span',
                { className: 'hibi-excalidraw-preview__meta' },
                `${new TextEncoder().encode(value).length.toLocaleString()} bytes`,
              ),
            )
          : h(
              'p',
              { className: 'hibi-excalidraw-preview__error' },
              parsed.message,
            ),
        h(
          'p',
          null,
          'The drawing is edited in a full Excalidraw tab. This preview is read-only.',
        ),
        h(
          ui.Button,
          { type: 'button', onClick: openEditor },
          'Edit drawing',
        ),
      ),
    )
  }

  function EditorView(props) {
    const [loaded, setLoaded] = React.useState(null)
    const [failure, setFailure] = React.useState(null)
    React.useEffect(() => {
      let active = true
      import('./editor.js')
        .then((module) => {
          if (active) setLoaded(module)
        })
        .catch((error) => {
          if (active) setFailure(error)
        })
      return () => {
        active = false
      }
    }, [])

    if (failure) {
      return h(
        'div',
        { className: 'hibi-excalidraw-loading' },
        h('h2', null, 'Excalidraw could not start'),
        h('p', null, failure instanceof Error ? failure.message : String(failure)),
      )
    }
    if (!loaded) {
      return h(
        'div',
        { className: 'hibi-excalidraw-loading' },
        h('p', null, 'Loading Excalidraw…'),
      )
    }
    return h(loaded.Editor, { ...props, context })
  }

  const render = async (source) => {
    const parsed = parseScene(source)
    if (!parsed.ok) {
      return {
        html: `<p>This Excalidraw file could not be read: ${escapeHtml(
          parsed.message,
        )}</p>`,
        css: '',
      }
    }
    if (parsed.empty) {
      return { html: '<p>Empty Excalidraw drawing.</p>', css: '' }
    }
    const summary = summariseScene(parsed.data)
    return {
      html: `<p>Excalidraw drawing with ${summary.elements} element${
        summary.elements === 1 ? '' : 's'
      }${summary.images ? ` and ${summary.images} embedded image${summary.images === 1 ? '' : 's'}` : ''}. Open it in Hibi to edit.</p>`,
      css: '',
    }
  }

  return {
    async start(addonContext) {
      context = addonContext
      globalThis.__hibiExcalidrawReact = React
      previousAssetPath = globalThis.EXCALIDRAW_ASSET_PATH
      globalThis.EXCALIDRAW_ASSET_PATH = new URL('./', import.meta.url).href
      installFontFaceFilter()

      view = context.views.register({
        id: EDITOR_VIEW_ID,
        label: 'Excalidraw',
        location: 'tab',
        lifetime: 'visible',
        Content: EditorView,
      })

      disposers.push(
        context.editor.registerDocumentFormat({
          id: 'excalidraw',
          name: 'Excalidraw',
          extensions: ['excalidraw'],
          codeLanguage: 'json',
          views: ['side-by-side', 'markdown'],
          Preview,
          render,
        }),
      )

      const createDrawing = async (extension, source) => {
        const workspace = await context.workspace.get()
        if (!workspace?.id || workspace.workspaceGeneration === undefined) {
          context.notify('Open a workspace folder to create a drawing.')
          return
        }
        const target = {
          workspaceId: workspace.id,
          workspaceGeneration: workspace.workspaceGeneration,
        }
        for (let index = 1; index <= 50; index++) {
          const name =
            index === 1
              ? `Untitled${extension}`
              : `Untitled ${index}${extension}`
          const result = await context.workspace.createText(
            target,
            name,
            source,
          )
          if (result.ok) {
            await context.workspace.openFile(name)
            return
          }
          if (result.code !== 'conflict' && result.code !== 'not-found') {
            context.notify(result.message)
            return
          }
        }
        context.notify('Could not find an unused drawing name.')
      }

      disposers.push(
        context.commands.register({
          id: 'open-editor',
          label: 'Open Excalidraw editor',
          keywords: 'canvas drawing diagram excalidraw',
          run: () => {
            if (!isCurrentDrawing()) {
              context.notify('Open an .excalidraw or .excalidraw.md drawing first.')
              return
            }
            openEditor()
          },
        }),
      )

      disposers.push(
        context.commands.register({
          id: 'new-drawing',
          label: 'New Excalidraw drawing',
          keywords: 'canvas diagram excalidraw create markdown obsidian',
          run: () =>
            createDrawing(
              '.excalidraw.md',
              blankObsidianDocument(blankDocument()),
            ),
        }),
      )

      disposers.push(
        context.commands.register({
          id: 'new-json-drawing',
          label: 'New standalone Excalidraw JSON file',
          keywords: 'canvas diagram excalidraw create json',
          run: () => createDrawing('.excalidraw', blankDocument()),
        }),
      )

      disposers.push(
        context.commands.register({
          id: 'repair-obsidian',
          label: 'Repair Obsidian Excalidraw files',
          keywords: 'obsidian excalidraw repair links import',
          async run() {
            const workspace = await context.workspace.get()
            if (!workspace?.id || workspace.workspaceGeneration === undefined) {
              context.notify('Open a workspace folder to repair drawings.')
              return
            }
            const target = {
              workspaceId: workspace.id,
              workspaceGeneration: workspace.workspaceGeneration,
            }
            const index = await context.workspace.index()
            const open = context.documents.listOpen()
            let repaired = 0
            let skipped = 0
            let failed = 0
            for (const page of index?.pages ?? []) {
              if (!page.path.toLowerCase().endsWith('.excalidraw.md')) continue
              const name = page.path.split('/').pop()
              if (open.some((entry) => entry.name === name)) {
                skipped++
                continue
              }
              const read = await context.workspace.readText(target, page.path)
              if (!read.ok) {
                failed++
                continue
              }
              const result = repairObsidianSource(read.value.markdown)
              if (!result.ok || !result.changed) {
                skipped++
                continue
              }
              const update = await context.workspace.updateText(
                target,
                page.path,
                read.value.version,
                result.markdown,
                { allowMetadataReset: true },
              )
              if (update.ok) repaired++
              else failed++
            }
            context.notify(
              `Obsidian drawings repaired: ${repaired}. Skipped: ${skipped}. Failed: ${failed}.`,
            )
          },
        }),
      )

      try {
        disposers.push(installHistoryBridge(context))
      } catch (error) {
        console.warn('Excalidraw could not bridge Hibi undo/redo:', error)
      }

      try {
        disposers.push(
          context.patches.instead(context.app, 'runAction', (args, next) => {
            if (
              args[0] === 'save' &&
              shouldHandleSave() &&
              saveEditorSessions() > 0
            ) {
              return true
            }
            return next(...args)
          }),
        )
      } catch (error) {
        console.warn('Excalidraw could not handle Hibi save:', error)
      }

      try {
        disposers.push(
          context.patches.before(context.app, 'runAction', ([command]) => {
            if (
              command === 'save' ||
              command === 'saveAs' ||
              command === 'close-tab' ||
              command === 'history' ||
              command === 'normal' ||
              command === 'side-by-side' ||
              command === 'markdown'
            ) {
              flushEditorSessions()
            }
          }),
        )
      } catch (error) {
        console.warn('Excalidraw could not flush before Hibi actions:', error)
      }

      disposers.push(context.editor.onDocumentChange(maybeAutoOpen))
      maybeAutoOpen(context.editor.getDocument())
    },

    stop() {
      flushEditorSessions()
      saveEditorSessions()
      for (const dispose of disposers.splice(0).reverse()) dispose()
      view?.dispose()
      view = null
      context = null
      lastDocument = null
      autoOpened.clear()
      removeFontFaceFilter()
      if (previousAssetPath === undefined) {
        delete globalThis.EXCALIDRAW_ASSET_PATH
      } else {
        globalThis.EXCALIDRAW_ASSET_PATH = previousAssetPath
      }
      previousAssetPath = undefined
      delete globalThis.__hibiExcalidrawReact
    },
  }
}
