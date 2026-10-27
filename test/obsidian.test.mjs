import assert from 'node:assert/strict'
import test from 'node:test'
import LZString from 'lz-string'
import {
  applyObsidianMarkdown,
  composeObsidianDrawing,
  detectDocumentKind,
  normalizeObsidianIds,
  parseObsidianDrawing,
  repairObsidianSource,
  sceneTextSections,
} from '../src/excalidraw/obsidian.js'
import { scenesEquivalent } from '../src/excalidraw/scene.js'
import {
  loadObsidianFiles,
  writeObsidianFiles,
} from '../src/excalidraw/obsidian-files.js'

const scene = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    {
      id: 'aaaa1111',
      type: 'text',
      text: 'Hello',
      originalText: 'Hello',
      rawText: 'Hello',
      link: null,
      isDeleted: false,
      version: 1,
      versionNonce: 1,
      updated: 1,
    },
    {
      id: 'bbbb2222',
      type: 'rectangle',
      link: '[[Other Note]]',
      isDeleted: false,
      version: 1,
      versionNonce: 2,
      updated: 2,
    },
  ],
  appState: {
    gridSize: 20,
    gridStep: 5,
    gridModeEnabled: false,
    viewBackgroundColor: '#ffffff',
  },
  files: {},
}

const json = JSON.stringify(scene, null, '\t')

function fixture(block = json, language = 'json') {
  return `---
excalidraw-plugin: parsed
tags: [excalidraw]
---

# Text Elements
Hello ^aaaa1111

[[Other Note]] ^bbbb2222

%%
# Drawing
\`\`\`${language}
${block}
\`\`\`
%%
`
}

test('parses and applies Obsidian text and link sections', () => {
  const parsed = parseObsidianDrawing(fixture())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.drawing.mode, 'json')
  assert.equal(parsed.textElements.size, 2)
  assert.equal(parsed.textElements.get('bbbb2222'), '[[Other Note]]')
  assert.equal(parsed.sceneSource, 'https://excalidraw.com')

  const applied = applyObsidianMarkdown(parsed.data, parsed)
  assert.equal(applied.elements[0].text, 'Hello')
  assert.equal(applied.elements[1].link, '[[Other Note]]')
})

test('round-trips the header and generated text section', () => {
  const source = fixture()
  const parsed = parseObsidianDrawing(source)
  const sections = sceneTextSections(parsed.data, {
    legacyLinks: !parsed.sections.links,
    textOrder: [...parsed.textElements.keys()],
  })
  const output = composeObsidianDrawing(parsed, parsed.data, {
    ...sections,
    sceneJson: json,
  })
  assert.equal(
    output.slice(0, parsed.headerEnd),
    source.slice(0, parsed.headerEnd),
  )
  const reparsed = parseObsidianDrawing(output)
  assert.equal(reparsed.ok, true)
  assert.equal(reparsed.textElements.size, 2)
})

test('normalizes new text IDs to Obsidian block references', () => {
  const source = fixture()
  const parsed = parseObsidianDrawing(source)
  const applied = applyObsidianMarkdown(parsed.data, parsed)
  const withNew = {
    ...applied,
    elements: [
      ...applied.elements,
      {
        id: 'new-text-element-with-a-long-id',
        type: 'text',
        text: 'New text',
        originalText: 'New text',
        rawText: 'New text',
        link: null,
        isDeleted: false,
      },
    ],
  }
  const normalized = normalizeObsidianIds(withNew)
  const newText = normalized.elements.at(-1)
  assert.match(newText.id, /^[A-Za-z0-9_-]{8}$/)
  const sections = sceneTextSections(normalized, {
    legacyLinks: true,
    textOrder: [...parsed.textElements.keys()],
  })
  assert.match(sections.textElements, /New text \^[A-Za-z0-9_-]{8}/)
  const output = composeObsidianDrawing(parsed, normalized, {
    ...sections,
    sceneJson: JSON.stringify(
      { ...scene, elements: normalized.elements },
      null,
      '\t',
    ),
  })
  assert.match(output, /New text \^[A-Za-z0-9_-]{8}/)
})

test('reads compressed-json blocks', () => {
  const compressed = LZString.compressToBase64(JSON.stringify(scene))
    .match(/.{1,256}/g)
    .join('\n\n')
  const parsed = parseObsidianDrawing(fixture(compressed, 'compressed-json'))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.drawing.mode, 'compressed')
  assert.equal(parsed.data.elements.length, 2)
})

test('detects Obsidian and native drawings', () => {
  assert.equal(
    detectDocumentKind('Drawing.excalidraw.md', ''),
    'obsidian',
  )
  assert.equal(detectDocumentKind('Drawing.excalidraw', ''), 'native')
  assert.equal(
    detectDocumentKind('Drawing.md', '---\nexcalidraw-plugin: parsed\n---\n'),
    'obsidian',
  )
  assert.equal(detectDocumentKind('Notes.md', '# Notes'), 'unknown')
})

test('scene equivalence ignores volatile fields only', () => {
  const left = {
    ...scene,
    elements: scene.elements.map((element) => ({ ...element })),
  }
  const right = {
    ...scene,
    elements: scene.elements.map((element) => ({
      ...element,
      version: 99,
      versionNonce: 99,
      updated: 99,
    })),
  }
  assert.equal(scenesEquivalent(left, right), true)
  right.elements[0].text = 'Changed'
  assert.equal(scenesEquivalent(left, right), false)
})

test('loads and writes Obsidian attachments through the workspace', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const readPaths = []
  const writes = []
  const context = {
    workspace: {
      get: async () => ({ id: 'workspace', workspaceGeneration: 1 }),
      index: async () => ({
        pages: [
          {
            path: 'Drawings/drawing.excalidraw.md',
            markdown: 'drawing',
          },
        ],
      }),
      readBinary: async (_target, path) => {
        readPaths.push(path)
        return { ok: true, value: { bytes } }
      },
      createBinary: async (_target, path, value) => {
        writes.push({ path, value })
        return { ok: true, value: {} }
      },
    },
  }
  const document = {
    name: 'drawing.excalidraw.md',
    markdown: 'drawing',
  }

  const files = await loadObsidianFiles(context, document, {
    embeddedFiles: new Map([
      ['image1', '[[assets/pixel.png]]'],
      ['remote', 'https://example.com/pixel.png'],
    ]),
  })
  assert.deepEqual(readPaths, ['Drawings/assets/pixel.png'])
  assert.match(files.image1.dataURL, /^data:image\/png;base64,/)

  await writeObsidianFiles(
    context,
    document,
    {
      image2: {
        id: 'image2',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,AQIDBA==',
      },
    },
    { embeddedFiles: new Map() },
  )
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, 'Drawings/assets/image2.png')
  assert.deepEqual([...writes[0].value], [1, 2, 3, 4])

  await writeObsidianFiles(
    context,
    document,
    { image1: files.image1 },
    { embeddedFiles: new Map([['image1', '[[assets/pixel.png]]']]) },
  )
  assert.equal(writes.length, 1)
})

test('repairs converted Obsidian wiki links from the scene JSON', () => {
  const source = fixture().replace(
    '[[Other Note]] ^bbbb2222',
    '[Other Note](Other%20Note.md) ^bbbb2222',
  )
  const repaired = repairObsidianSource(source)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.changed, true)
  assert.match(repaired.markdown, /\[\[Other Note\]\] \^bbbb2222/)
})
