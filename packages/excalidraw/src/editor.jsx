import {
  CaptureUpdateAction,
  Excalidraw,
  restore,
} from '@excalidraw/excalidraw'
import {
  documentKind,
  loadDocument,
  serializeDocument,
} from './adapters.js'
import { registerEditorSession } from './editor-registry.js'
import { parseObsidianDrawing, normalizeObsidianIds } from './obsidian.js'
import { loadObsidianFiles, writeObsidianFiles } from './obsidian-files.js'
import {
  canvasMeasure,
  layoutBoundText,
} from './text-layout.js'
import {
  MAX_SOURCE_BYTES,
  minimalChange,
  scenesEquivalent,
} from './scene.js'
import { setPortalHost } from './shims/react-dom.js'

const React = globalThis.__hibiExcalidrawReact

if (!React) {
  throw new Error('The Excalidraw editor did not receive Hibi’s React instance.')
}

const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: true,
    clearCanvas: true,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false,
    saveAsImage: false,
  },
  tools: { image: true },
}

const activeTheme = (context) =>
  context.colorschemes.getActive().appearance === 'dark' ? 'dark' : 'light'

function issueTitle(issue) {
  switch (issue.kind) {
    case 'size':
      return 'Drawing is too large for Hibi'
    case 'conflict':
      return 'Drawing changed elsewhere'
    case 'stale':
      return 'Drawing changed elsewhere'
    case 'invalid-source':
      return 'The document source is not valid Excalidraw JSON'
    case 'closed':
      return 'This drawing is no longer open'
    case 'busy':
      return 'The document is busy'
    default:
      return 'Could not save the drawing'
  }
}

function restoreScene(data, theme, kind) {
  const restored = restore(data, null, null, {
    repairBindings: true,
    refreshDimensions: kind !== 'obsidian',
  })
  const elements =
    kind === 'obsidian'
      ? layoutBoundText(
          { elements: restored.elements },
          canvasMeasure(),
        ).elements
      : restored.elements
  return {
    elements,
    appState: {
      ...restored.appState,
      theme,
      showWelcomeScreen: false,
    },
    files: restored.files ?? {},
  }
}

function liveMarkdown(context, document, binding) {
  if (binding !== 'pinned') return document.markdown
  try {
    const metadata = context.documents
      .listOpen()
      .find((entry) => entry.tabId === document.tabId)
    if (!metadata) return document.markdown
    const read = context.documents.readSource(metadata.target)
    return read.status === 'read' ? read.source : document.markdown
  } catch {
    return document.markdown
  }
}

function Canvas({ context, document, kind, binding }) {
  const rootRef = React.useRef(null)
  const portalHostRef = React.useRef(null)
  const apiRef = React.useRef(null)
  const latestRef = React.useRef(null)
  const structureRef = React.useRef(null)
  const initialSourceRef = React.useRef(null)
  if (initialSourceRef.current === null) {
    initialSourceRef.current = liveMarkdown(context, document, binding)
  }
  const sourceRef = React.useRef(initialSourceRef.current)
  const interactedRef = React.useRef(false)
  const dirtyRef = React.useRef(false)
  const pointerActiveRef = React.useRef(false)
  const disposedRef = React.useRef(false)
  const suppressUntilRef = React.useRef(0)
  const busyRetriesRef = React.useRef(0)
  const timerRef = React.useRef(null)
  const saveTimerRef = React.useRef(null)
  const savingRef = React.useRef(false)
  const saveAgainRef = React.useRef(false)
  const flushRef = React.useRef(() => {})
  const saveRef = React.useRef(() => {})
  const [attempt, setAttempt] = React.useState(0)
  const [portalReady, setPortalReady] = React.useState(false)
  const [apiReady, setApiReady] = React.useState(false)
  const [theme, setTheme] = React.useState(() => activeTheme(context))
  const themeRef = React.useRef(theme)
  const [issue, setIssue] = React.useState(null)

  themeRef.current = theme

  const initial = React.useMemo(() => {
    const loaded = loadDocument(kind, initialSourceRef.current)
    if (!loaded.ok) return { error: loaded.error }
    structureRef.current = loaded.parsed
    try {
      return { data: restoreScene(loaded.data, themeRef.current, kind) }
    } catch (error) {
      return {
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'The drawing could not be restored.',
        },
      }
    }
  }, [attempt, kind])

  React.useEffect(() => {
    const update = () => setTheme(activeTheme(context))
    update()
    return context.colorschemes.subscribe(update)
  }, [context])

  React.useEffect(() => {
    setPortalHost(portalHostRef.current)
    setPortalReady(true)
    return () => setPortalHost(null)
  }, [])

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const mark = () => {
      interactedRef.current = true
    }
    const pointerDown = () => {
      pointerActiveRef.current = true
      mark()
    }
    const pointerUp = () => {
      pointerActiveRef.current = false
      if (dirtyRef.current) schedule()
    }
    root.addEventListener('pointerdown', pointerDown, true)
    root.addEventListener('pointerup', pointerUp, true)
    root.addEventListener('pointercancel', pointerUp, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', pointerUp, true)
    root.addEventListener('keydown', mark, true)
    root.addEventListener('drop', mark, true)
    root.addEventListener('paste', mark, true)
    return () => {
      root.removeEventListener('pointerdown', pointerDown, true)
      root.removeEventListener('pointerup', pointerUp, true)
      root.removeEventListener('pointercancel', pointerUp, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerUp, true)
      root.removeEventListener('keydown', mark, true)
      root.removeEventListener('drop', mark, true)
      root.removeEventListener('paste', mark, true)
    }
  }, [])

  const schedule = React.useCallback(() => {
    if (pointerActiveRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flushRef.current(false)
    }, kind === 'obsidian' ? 1000 : 400)
  }, [kind])

  const saveNow = React.useCallback(
    async (explicit = false) => {
      if (savingRef.current) {
        saveAgainRef.current = true
        return
      }
      const metadata = context.documents
        .listOpen()
        .find((entry) => entry.tabId === document.tabId)
      if (!metadata) return
      const read = context.documents.readSource(metadata.target)
      if (read.status !== 'read') {
        setIssue({ kind: 'save', message: read.message })
        if (explicit) context.notify('The drawing could not be saved.')
        return
      }
      savingRef.current = true
      try {
        const result = await context.documents.save(read.target)
        if (result.status === 'saved' || result.status === 'clean') {
          busyRetriesRef.current = 0
          return
        }
        if (result.status === 'busy') {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            saveRef.current(false)
          }, 300)
          return
        }
        setIssue({ kind: 'save', message: result.message })
        if (explicit) context.notify('The drawing could not be saved.')
      } catch (error) {
        setIssue({
          kind: 'save',
          message:
            error instanceof Error ? error.message : 'The drawing could not be saved.',
        })
        if (explicit) context.notify('The drawing could not be saved.')
      } finally {
        savingRef.current = false
        if (saveAgainRef.current) {
          saveAgainRef.current = false
          saveRef.current(false)
        }
      }
    },
    [context, document.tabId],
  )

  saveRef.current = saveNow

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      saveRef.current(false)
    }, 800)
  }, [])

  const flush = React.useCallback(
    (explicit = false) => {
      if (disposedRef.current) return
      if (!interactedRef.current || !dirtyRef.current) return
      const latest = latestRef.current
      if (!latest) return
      const previousStructure = structureRef.current

      let serialized
      try {
        serialized = serializeDocument(kind, latest, {
          parsed: structureRef.current,
        })
      } catch (error) {
        setIssue({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The drawing could not be serialized.',
        })
        return
      }
      const next = serialized.source

      if (next === sourceRef.current) {
        dirtyRef.current = false
        if (explicit) saveRef.current(true)
        else scheduleSave()
        return
      }

      const bytes = new TextEncoder().encode(next).length
      if (bytes > MAX_SOURCE_BYTES) {
        setIssue({
          kind: 'size',
          message: `This drawing is ${(
            bytes /
            (1024 * 1024)
          ).toFixed(1)} MiB. Hibi documents are limited to 2 MiB. Remove embedded images or split the drawing.`,
        })
        return
      }

      const metadata = context.documents
        .listOpen()
        .find((entry) => entry.tabId === document.tabId)
      if (!metadata) {
        setIssue({
          kind: 'closed',
          message: 'The document tab was closed before this change could be saved.',
        })
        return
      }
      const read = context.documents.readSource(metadata.target)
      if (read.status !== 'read') {
        setIssue({ kind: 'stale', message: read.message })
        return
      }
      if (read.source !== sourceRef.current) {
        setIssue({
          kind: 'conflict',
          message:
            'The source changed in another view. Reload the drawing to keep the source version.',
        })
        return
      }

      const comparable =
        kind === 'obsidian' ? normalizeObsidianIds(latest) : latest
      if (
        structureRef.current?.data &&
        scenesEquivalent(structureRef.current.data, comparable)
      ) {
        sourceRef.current = read.source
        dirtyRef.current = false
        setIssue(null)
        return
      }

      const fallback = minimalChange(read.source, next)
      const changes =
        serialized.edits?.length &&
        structureRef.current?.source === read.source
          ? serialized.edits
          : fallback
            ? [fallback]
            : []
      if (!changes.length) {
        sourceRef.current = next
        dirtyRef.current = false
        setIssue(null)
        return
      }

      let result
      try {
        result = context.documents.applyEdits({
          requestId: crypto.randomUUID(),
          target: read.target,
          changes,
        })
      } catch (error) {
        setIssue({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The edit was rejected.',
        })
        return
      }

      if (
        result.status === 'unsupported-view' &&
        kind === 'obsidian' &&
        context.editor.getDocument()?.tabId === document.tabId
      ) {
        try {
          context.editor.updateMarkdown(() => next)
          result = { status: 'applied' }
        } catch (error) {
          setIssue({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'The edit was rejected.',
          })
          return
        }
      }

      if (result.status === 'applied') {
        let appliedSource = next
        if (kind === 'obsidian') {
          const current = context.documents
            .listOpen()
            .find((entry) => entry.tabId === document.tabId)
          const refreshed = current
            ? context.documents.readSource(current.target)
            : null
          if (refreshed?.status === 'read') appliedSource = refreshed.source
        }
        sourceRef.current = appliedSource
        dirtyRef.current = false
        busyRetriesRef.current = 0
        setIssue(null)
        if (kind === 'obsidian') {
          const reparsed = parseObsidianDrawing(appliedSource)
          if (reparsed.ok) structureRef.current = reparsed
          if (Object.keys(latest.files ?? {}).length) {
            void writeObsidianFiles(
              context,
              document,
              latest.files,
              previousStructure,
            ).catch((error) => {
              context.notify(
                error instanceof Error
                  ? error.message
                  : 'A drawing attachment could not be written.',
              )
            })
          }
        }
        if (explicit) saveRef.current(true)
        else scheduleSave()
        return
      }
      if (result.status === 'busy' || result.status === 'composing') {
        if (busyRetriesRef.current < 10) {
          busyRetriesRef.current++
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            flushRef.current(false)
          }, 300)
        } else {
          setIssue({ kind: 'busy', message: result.message })
        }
        return
      }
      if (result.status === 'stale' || result.status === 'conflict') {
        setIssue({
          kind: 'conflict',
          message: 'The document changed elsewhere. Reload the drawing.',
        })
        return
      }
      if (/size limit/i.test(result.message)) {
        setIssue({ kind: 'size', message: result.message })
        return
      }
      setIssue({ kind: 'error', message: result.message })
      if (explicit) {
        context.notify('The latest drawing changes could not be saved.')
      }
    },
    [context, document.tabId],
  )

  flushRef.current = flush

  const handleChange = React.useCallback(
    (elements, appState, files) => {
      latestRef.current = { elements, appState, files }
      if (performance.now() < suppressUntilRef.current) return
      if (!interactedRef.current) return
      dirtyRef.current = true
      schedule()
    },
    [schedule],
  )

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const unregister = registerEditorSession({
      tabId: document.tabId,
      container: root,
      flush: () => flushRef.current(true),
      save: () => saveRef.current(true),
    })
    return () => {
      flushRef.current(true)
      saveRef.current(true)
      disposedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      unregister()
    }
  }, [document.tabId])

  React.useEffect(() => {
    if (!apiRef.current) return
    if (document.markdown === sourceRef.current) return
    if (dirtyRef.current) {
      setIssue({
        kind: 'conflict',
        message:
          'The document source changed while this drawing had unsaved canvas changes. Reload to keep the source version.',
      })
      return
    }
    const loaded = loadDocument(kind, document.markdown)
    if (!loaded.ok) {
      setIssue({ kind: 'invalid-source', message: loaded.error.message })
      return
    }
    try {
      const next = restoreScene(loaded.data, themeRef.current, kind)
      structureRef.current = loaded.parsed
      suppressUntilRef.current = performance.now() + 150
      if (Object.keys(next.files).length) {
        apiRef.current.addFiles(Object.values(next.files))
      }
      apiRef.current.updateScene(
        { elements: next.elements, appState: next.appState },
        { captureUpdate: CaptureUpdateAction.NEVER },
      )
      sourceRef.current = document.markdown
      latestRef.current = {
        elements: next.elements,
        appState: next.appState,
        files: next.files,
      }
      dirtyRef.current = false
      setIssue((current) =>
        current?.kind === 'size' || current?.kind === 'conflict'
          ? current
          : null,
      )
    } catch (error) {
      setIssue({
        kind: 'invalid-source',
        message:
          error instanceof Error
            ? error.message
            : 'The document source could not be loaded.',
      })
    }
  }, [document.markdown, document.contentVersion, apiReady])

  React.useEffect(() => {
    if (!apiReady || kind !== 'obsidian' || !structureRef.current) return
    let active = true
    loadObsidianFiles(context, document, structureRef.current)
      .then((loaded) => {
        if (!active || !apiRef.current) return
        const values = Object.values(loaded)
        if (!values.length) return
        apiRef.current.addFiles(values)
        suppressUntilRef.current = performance.now() + 150
        apiRef.current.updateScene(
          {
            elements:
              latestRef.current?.elements ?? apiRef.current.getSceneElements(),
          },
          { captureUpdate: CaptureUpdateAction.NEVER },
        )
      })
      .catch((error) => {
        console.warn('Could not load Obsidian attachments:', error)
      })
    return () => {
      active = false
    }
  }, [apiReady, kind, document.tabId])

  React.useEffect(() => {
    if (!apiReady || kind !== 'obsidian') return
    let active = true
    const refresh = async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (!active || !apiRef.current) return
      const latest = latestRef.current
      if (!latest) return
      try {
        const laidOut = layoutBoundText(
          { elements: latest.elements },
          canvasMeasure(),
        )
        suppressUntilRef.current = performance.now() + 200
        apiRef.current.updateScene(
          { elements: laidOut.elements, appState: latest.appState },
          { captureUpdate: CaptureUpdateAction.NEVER },
        )
        latestRef.current = {
          elements: laidOut.elements,
          appState: latest.appState,
          files: latest.files,
        }
      } catch (error) {
        console.warn('Could not refresh Excalidraw text metrics:', error)
      }
    }
    void refresh()
    return () => {
      active = false
    }
  }, [apiReady, kind])

  const reload = () => {
    const metadata = context.documents
      .listOpen()
      .find((entry) => entry.tabId === document.tabId)
    let source = document.markdown
    if (metadata) {
      const read = context.documents.readSource(metadata.target)
      if (read.status === 'read') source = read.source
    }
    const loaded = loadDocument(kind, source)
    if (!loaded.ok) {
      setIssue({ kind: 'invalid-source', message: loaded.error.message })
      return
    }
    try {
      const next = restoreScene(loaded.data, themeRef.current, kind)
      structureRef.current = loaded.parsed
      suppressUntilRef.current = performance.now() + 150
      if (Object.keys(next.files).length) {
        apiRef.current?.addFiles(Object.values(next.files))
      }
      apiRef.current?.updateScene(
        { elements: next.elements, appState: next.appState },
        { captureUpdate: CaptureUpdateAction.NEVER },
      )
      sourceRef.current = source
      latestRef.current = {
        elements: next.elements,
        appState: next.appState,
        files: next.files,
      }
      dirtyRef.current = false
      setIssue(null)
    } catch (error) {
      setIssue({
        kind: 'invalid-source',
        message:
          error instanceof Error
            ? error.message
            : 'The document source could not be loaded.',
      })
    }
  }

  const retry = () => {
    setIssue(null)
    if (latestRef.current) {
      flushRef.current(true)
      return
    }
    initialSourceRef.current = liveMarkdown(context, document, binding)
    setAttempt((value) => value + 1)
  }

  const openSource = () => {
    context.app.runAction('markdown')
  }

  const openLink = React.useCallback(
    async (element) => {
      const link = element?.link
      if (!link) return
      const inner = link.startsWith('[[') ? link.slice(2, -2).split('|')[0] : ''
      const href = inner
        ? `obsidian-wiki:${encodeURIComponent(inner)}`
        : link
      try {
        const current = await window.hibi?.getDocument?.()
        const revision = current?.revision ?? document.revision
        if (window.hibi?.openDocumentLink) {
          await window.hibi.openDocumentLink(href, revision)
          return
        }
        context.notify('This link cannot be opened here.')
      } catch (error) {
        context.notify(
          error instanceof Error ? error.message : 'The link could not be opened.',
        )
      }
    },
    [context, document.revision],
  )

  const banner = issue
    ? React.createElement(
        'div',
        { className: 'hibi-excalidraw-issue', role: 'status' },
        React.createElement('strong', null, issueTitle(issue)),
        React.createElement('span', null, issue.message),
        React.createElement(
          'div',
          { className: 'hibi-excalidraw-issue__actions' },
          React.createElement(
            'button',
            { type: 'button', onClick: openSource },
            'Open source view',
          ),
          issue.kind !== 'size' && issue.kind !== 'busy'
            ? React.createElement(
                'button',
                { type: 'button', onClick: reload },
                'Reload drawing',
              )
            : null,
          React.createElement(
            'button',
            { type: 'button', onClick: retry },
            'Retry',
          ),
        ),
      )
    : null

  if (initial.error) {
    return React.createElement(
      'div',
      {
        className: 'hibi-excalidraw-root',
        dir: 'ltr',
        ref: rootRef,
        'data-hibi-excalidraw-document': document.name,
        'data-hibi-excalidraw-tab': document.tabId,
      },
      React.createElement(
        'div',
        { className: 'hibi-excalidraw-error' },
        React.createElement('h2', null, 'This drawing cannot be opened'),
        React.createElement('p', null, initial.error.message),
        React.createElement(
          'div',
          { className: 'hibi-excalidraw-issue__actions' },
          React.createElement(
            'button',
            { type: 'button', onClick: openSource },
            'Open source view',
          ),
          React.createElement(
            'button',
            { type: 'button', onClick: retry },
            'Retry',
          ),
        ),
      ),
    )
  }

  return React.createElement(
    'div',
    {
      className: 'hibi-excalidraw-root',
      dir: 'ltr',
      ref: rootRef,
      'data-hibi-excalidraw-document': document.name,
      'data-hibi-excalidraw-tab': document.tabId,
    },
    React.createElement('div', {
      className: 'hibi-excalidraw-portals',
      ref: portalHostRef,
    }),
    banner,
    portalReady
      ? React.createElement(Excalidraw, {
          initialData: initial.data,
          excalidrawAPI: (api) => {
            apiRef.current = api
            setApiReady(true)
          },
          onChange: handleChange,
          onLinkOpen: (element, event) => {
            event.preventDefault()
            void openLink(element)
          },
          theme,
          name: document.name,
          langCode: 'en',
          autoFocus: false,
          handleKeyboardGlobally: false,
          aiEnabled: false,
          isCollaborating: false,
          validateEmbeddable: false,
          UIOptions: UI_OPTIONS,
        })
      : null,
  )
}

export function Editor(props) {
  const { context, document, binding } = props

  if (!document) {
    return React.createElement(
      'div',
      { className: 'hibi-excalidraw-loading' },
      React.createElement('h2', null, 'No drawing open'),
      React.createElement(
        'p',
        null,
        'Select or create an .excalidraw or .excalidraw.md drawing.',
      ),
    )
  }

  const kind = documentKind(document.name, document.markdown)
  if (kind === 'unknown') {
    return React.createElement(
      'div',
      { className: 'hibi-excalidraw-loading' },
      React.createElement('h2', null, 'Not an Excalidraw drawing'),
      React.createElement(
        'p',
        null,
        'This tab edits .excalidraw and Obsidian .excalidraw.md drawings.',
      ),
    )
  }

  return React.createElement(Canvas, {
    key: `${document.tabId}:${kind}:${binding}`,
    context,
    document,
    kind,
    binding,
  })
}
