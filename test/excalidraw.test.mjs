import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blankDocument,
  isExcalidrawName,
  minimalChange,
  parseScene,
  summariseScene,
} from '../src/excalidraw/scene.js'
import create from '../addons/excalidraw/index.js'

test('blank documents are valid Excalidraw JSON', () => {
  const parsed = parseScene(blankDocument())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.empty, false)
  assert.deepEqual(parsed.data.elements, [])
  assert.deepEqual(parsed.data.files, {})
})

test('empty source starts a blank drawing', () => {
  const parsed = parseScene('  \n')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.empty, true)
})

test('invalid and non-Excalidraw sources are rejected', () => {
  assert.equal(parseScene('{').reason, 'invalid-json')
  assert.equal(parseScene('[]').reason, 'invalid-scene')
  assert.equal(
    parseScene('{"type":"other","elements":[]}').reason,
    'invalid-scene',
  )
  assert.equal(
    parseScene('{"type":"excalidraw","elements":{}}').reason,
    'invalid-scene',
  )
})

test('null imported collections are tolerated', () => {
  const parsed = parseScene(
    '{"type":"excalidraw","elements":null,"appState":null,"files":null}',
  )
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.data, { elements: [], appState: {}, files: {} })
})

test('minimal changes reconstruct the next source', () => {
  const cases = [
    ['', 'abc'],
    ['abc', ''],
    ['abcdef', 'abcXef'],
    ['abc😀def', 'abc😁def'],
    ['abc😀def', 'abcdef'],
    ['abc', 'abc'],
    ['a😀b😀c', 'a😀c'],
  ]
  for (const [previous, next] of cases) {
    const change = minimalChange(previous, next)
    if (previous === next) {
      assert.equal(change, null)
      continue
    }
    assert.equal(
      previous.slice(0, change.from) +
        change.insert +
        previous.slice(change.to),
      next,
    )
    assert.equal(
      previous.slice(change.from, change.to),
      change.expectedText,
    )
    assert.equal(/[\uD800-\uDFFF]/u.test(change.insert), false)
  }
})

test('names and summaries use the file source', () => {
  assert.equal(isExcalidrawName('Drawing.EXCALIDRAW'), true)
  assert.equal(isExcalidrawName('drawing.json'), false)
  assert.deepEqual(
    summariseScene({
      elements: [{ id: 'a' }, { id: 'b', isDeleted: true }],
      files: { image: {} },
    }),
    { elements: 1, images: 1 },
  )
})

test('the addon registers its format, tab, commands, and patches', async () => {
  class FakeDocument {
    execCommand() {}
  }
  globalThis.Document = FakeDocument

  const formats = []
  const views = []
  const commands = []
  const patches = []
  const disposed = []
  let disposedView = false
  const disposer = () => disposed.push(true)
  const React = {
    createElement: () => null,
    useMemo: (fn) => fn(),
    useState: () => [null, () => {}],
    useEffect: () => {},
  }

  const addon = create({ React, ui: { Button: () => null } })
  const document = {
    tabId: 'tab-1',
    name: 'drawing.excalidraw',
    markdown: '{}',
    revision: 1,
    contentVersion: 1,
  }
  await addon.start({
    editor: {
      registerDocumentFormat: (format) => {
        formats.push(format)
        return disposer
      },
      onDocumentChange: (listener) => {
        listener(document)
        return disposer
      },
      getDocument: () => document,
    },
    views: {
      register: (view) => {
        views.push(view)
        return {
          open() {},
          dispose() {
            disposedView = true
          },
        }
      },
    },
    commands: {
      register: (command) => {
        commands.push(command)
        return disposer
      },
    },
    patches: {
      instead: (...args) => {
        patches.push(['instead', ...args])
        return disposer
      },
      before: (...args) => {
        patches.push(['before', ...args])
        return disposer
      },
    },
    app: { runAction() {} },
    notify() {},
    colorschemes: {
      getActive: () => ({ appearance: 'light' }),
      subscribe: () => disposer,
    },
    documents: {
      listOpen: () => [],
      readSource: () => ({ status: 'missing' }),
      subscribe: () => disposer,
    },
    workspace: {},
  })

  assert.equal(globalThis.__hibiExcalidrawReact, React)
  assert.deepEqual(
    formats.map(({ id, extensions, views: viewsToUse }) => ({
      id,
      extensions,
      views: viewsToUse,
    })),
    [
      {
        id: 'excalidraw',
        extensions: ['excalidraw'],
        views: ['side-by-side', 'markdown'],
      },
    ],
  )
  assert.equal(formats[0].Preview instanceof Function, true)
  assert.equal(views[0].location, 'tab')
  assert.equal(views[0].lifetime, 'visible')
  assert.deepEqual(
    commands.map(({ id }) => id),
    ['open-editor', 'new-drawing', 'new-json-drawing', 'repair-obsidian'],
  )
  assert.equal(
    patches.some(
      ([kind, target, method]) =>
        kind === 'instead' && target === FakeDocument.prototype && method === 'execCommand',
    ),
    true,
  )
  assert.equal(
    patches.some(
      ([kind, target, method]) =>
        kind === 'before' && target !== undefined && method === 'runAction',
    ),
    true,
  )

  addon.stop()
  assert.equal(disposedView, true)
  assert.equal(globalThis.__hibiExcalidrawReact, undefined)
  assert.equal(disposed.length > 0, true)
  delete globalThis.Document
})

test('the new drawing command avoids overwriting existing files', async () => {
  class FakeDocument {
    execCommand() {}
  }
  globalThis.Document = FakeDocument
  const commands = new Map()
  const created = []
  const opened = []
  const notices = []
  const disposer = () => {}
  const React = {
    createElement: () => null,
    useMemo: (fn) => fn(),
    useState: () => [null, () => {}],
    useEffect: () => {},
  }
  const addon = create({ React, ui: { Button: () => null } })
  await addon.start({
    editor: {
      registerDocumentFormat: () => disposer,
      onDocumentChange: () => disposer,
      getDocument: () => null,
    },
    views: { register: () => ({ open() {}, dispose() {} }) },
    commands: {
      register: (command) => {
        commands.set(command.id, command)
        return () => commands.delete(command.id)
      },
    },
    patches: {
      instead: () => disposer,
      before: () => disposer,
    },
    app: { runAction() {} },
    notify: (message) => notices.push(message),
    colorschemes: {
      getActive: () => ({ appearance: 'light' }),
      subscribe: () => disposer,
    },
    documents: {
      listOpen: () => [],
      readSource: () => ({ status: 'missing' }),
      subscribe: () => disposer,
    },
    workspace: {
      get: async () => ({ id: 'workspace', workspaceGeneration: 1 }),
      createText: async (_target, path) => {
        created.push(path)
        return path === 'Untitled.excalidraw.md'
          ? { ok: false, code: 'conflict', message: 'exists' }
          : { ok: true, value: { path } }
      },
      openFile: async (path) => opened.push(path),
    },
  })

  await commands.get('new-drawing').run()
  assert.deepEqual(created, ['Untitled.excalidraw.md', 'Untitled 2.excalidraw.md'])
  assert.deepEqual(opened, ['Untitled 2.excalidraw.md'])
  assert.deepEqual(notices, [])
  addon.stop()
  delete globalThis.Document
})
