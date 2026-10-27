import LZString from 'lz-string'

export {
  detectDocumentKind,
  isObsidianExcalidrawName,
  looksLikeObsidianExcalidraw,
} from './detect.js'

const GENERATED_HEADINGS = new Map([
  ['text elements', 'texts'],
  ['element links', 'links'],
  ['embedded files', 'files'],
  ['drawing', 'drawing'],
  ['excalidraw data', 'data'],
])

const CHUNK = 256

function failure(reason, message) {
  return { ok: false, reason, message }
}

function sourceLines(source) {
  const lines = []
  let start = 0
  for (;;) {
    const newline = source.indexOf('\n', start)
    const end = newline === -1 ? source.length : newline
    lines.push({
      start,
      end,
      next: newline === -1 ? source.length : newline + 1,
      text: source.slice(start, end).replace(/\r$/, ''),
    })
    if (newline === -1) break
    start = newline + 1
  }
  return lines
}

function frontmatter(source, lines) {
  if (!lines.length || lines[0].text.trim() !== '---') return null
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].text.trim() === '---') {
      return {
        start: 0,
        end: lines[index].next,
        text: source.slice(lines[0].next, lines[index].start),
      }
    }
  }
  return null
}

function heading(line) {
  const match = line.text.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/)
  if (!match) return null
  const name = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim()
  return { level: match[1].length, name }
}

function isFence(line) {
  return /^\s*(`{3,}|~{3,})/.test(line.text)
}

function fenceOpen(line) {
  return line.text.match(/^\s*(`{3,}|~{3,})\s*(json|compressed-json)\s*$/i)
}

function fenceClose(line, marker, length) {
  const match = line.text.match(/^\s*(`{3,}|~{3,})\s*$/)
  return (
    match &&
    match[1][0] === marker &&
    match[1].length >= length
  )
}

function parseTextElements(content) {
  const map = new Map()
  let buffer = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(.*?)\s\^([A-Za-z0-9_-]{8})\s*$/)
    if (!match) {
      buffer.push(line)
      continue
    }
    const text = [...buffer, match[1]].join('\n').trim()
    if (text) map.set(match[2], text)
    buffer = []
  }
  return map
}

function parseElementLinks(content) {
  const map = new Map()
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_-]{8})\s*:\s*(.+?)\s*$/)
    if (match) map.set(match[1], match[2])
  }
  return map
}

function parseEmbeddedFiles(content) {
  const map = new Map()
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([^\s:]+)\s*:\s*(.+?)\s*$/)
    if (match) map.set(match[1], match[2])
  }
  return map
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return failure('invalid-scene', 'The drawing must be a JSON object.')
  }
  if (data.type !== undefined && data.type !== 'excalidraw') {
    return failure(
      'invalid-scene',
      'This file is not an Excalidraw drawing. Expected "type": "excalidraw".',
    )
  }
  if (
    data.elements !== undefined &&
    data.elements !== null &&
    !Array.isArray(data.elements)
  ) {
    return failure('invalid-scene', '"elements" must be an array.')
  }
  if (
    data.appState !== undefined &&
    data.appState !== null &&
    (typeof data.appState !== 'object' || Array.isArray(data.appState))
  ) {
    return failure('invalid-scene', '"appState" must be an object.')
  }
  if (
    data.files !== undefined &&
    data.files !== null &&
    (typeof data.files !== 'object' || Array.isArray(data.files))
  ) {
    return failure('invalid-scene', '"files" must be an object.')
  }
  return {
    ok: true,
    data: {
      elements: data.elements ?? [],
      appState: data.appState ?? {},
      files: data.files ?? {},
    },
  }
}

function parseSceneBlock(raw, mode) {
  let text = raw
  if (mode === 'compressed') {
    try {
      text = LZString.decompressFromBase64(raw.replace(/\s+/g, ''))
    } catch (error) {
      return failure(
        'invalid-json',
        error instanceof Error
          ? error.message
          : 'The compressed drawing could not be decompressed.',
      )
    }
    if (!text) {
      return failure(
        'invalid-json',
        'The compressed drawing could not be decompressed.',
      )
    }
  }
  try {
    const parsed = JSON.parse(text)
    const validated = validate(parsed)
    if (!validated.ok) return validated
    return {
      ...validated,
      source: parsed.source,
      version: parsed.version,
    }
  } catch (error) {
    return failure(
      'invalid-json',
      error instanceof Error ? error.message : 'This is not valid JSON.',
    )
  }
}

export function parseObsidianDrawing(source) {
  if (typeof source !== 'string') {
    return failure('invalid-source', 'The document source is not text.')
  }
  const lines = sourceLines(source)
  const fm = frontmatter(source, lines)
  const pluginMatch = fm?.text.match(/^excalidraw-plugin\s*:\s*(.+?)\s*$/m)
  const plugin = pluginMatch
    ? pluginMatch[1].trim().replace(/^["']|["']$/g, '')
    : null

  const headings = []
  let inFence = null
  for (let index = fm ? 1 : 0; index < lines.length; index++) {
    const line = lines[index]
    if (inFence) {
      if (fenceClose(line, inFence.marker, inFence.length)) inFence = null
      continue
    }
    if (isFence(line)) {
      const match = line.text.match(/^\s*(`{3,}|~{3,})/)
      inFence = { marker: match[1][0], length: match[1].length }
      continue
    }
    const info = heading(line)
    if (!info) continue
    const kind = GENERATED_HEADINGS.get(info.name.toLowerCase())
    if (kind) headings.push({ ...info, kind, index, start: line.start, next: line.next })
  }

  const drawingHeading = headings.find((item) => item.kind === 'drawing')
  if (!drawingHeading) {
    return failure(
      'missing-drawing',
      'This Markdown file does not contain an Excalidraw "Drawing" section.',
    )
  }

  let commentStart = drawingHeading.start
  for (let index = drawingHeading.index - 1; index >= 0; index--) {
    const text = lines[index].text.trim()
    if (!text) continue
    if (text === '%%') commentStart = lines[index].start
    break
  }

  let openIndex = -1
  let openMatch = null
  for (let index = drawingHeading.index + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line.text.trim() === '%%' || !line.text.trim()) continue
    openMatch = fenceOpen(line)
    if (openMatch) {
      openIndex = index
      break
    }
    if (index > drawingHeading.index + 20) break
  }
  if (!openMatch || openIndex === -1) {
    return failure(
      'missing-drawing',
      'The Excalidraw Drawing section has no JSON code block.',
    )
  }

  const marker = openMatch[1][0]
  const length = openMatch[1].length
  let closeIndex = -1
  for (let index = openIndex + 1; index < lines.length; index++) {
    if (fenceClose(lines[index], marker, length)) {
      closeIndex = index
      break
    }
  }
  if (closeIndex === -1) {
    return failure(
      'missing-drawing',
      'The Excalidraw Drawing code block is not closed.',
    )
  }

  const mode = openMatch[2].toLowerCase() === 'compressed-json' ? 'compressed' : 'json'
  const contentStart = lines[openIndex].next
  const contentEnd = lines[closeIndex].start
  const raw = source.slice(contentStart, contentEnd)
  const scene = parseSceneBlock(raw, mode)
  if (!scene.ok) return scene

  const sections = {}
  for (const item of headings) {
    if (item.kind === 'drawing' || item.kind === 'data') continue
    const nextKnown = headings.find(
      (candidate) =>
        candidate.index > item.index &&
        (candidate.kind === 'texts' ||
          candidate.kind === 'links' ||
          candidate.kind === 'files' ||
          candidate.kind === 'drawing' ||
          candidate.kind === 'data'),
    )
    let end = nextKnown ? nextKnown.start : source.length
    if (nextKnown?.kind === 'drawing') end = Math.min(end, commentStart)
    const body = source.slice(item.next, end)
    sections[item.kind] = {
      ...item,
      end,
      body,
    }
  }

  const headerEnd = headings.reduce(
    (minimum, item) => Math.min(minimum, item.start),
    source.length,
  )

  return {
    ok: true,
    source,
    plugin,
    sections,
    drawing: {
      ...drawingHeading,
      commentStart,
      contentStart,
      contentEnd,
      closeIndex,
      mode,
      marker,
      length,
    },
    headerEnd,
    sceneSource: scene.source,
    textElements: parseTextElements(sections.texts?.body ?? ''),
    elementLinks: parseElementLinks(sections.links?.body ?? ''),
    embeddedFiles: parseEmbeddedFiles(sections.files?.body ?? ''),
    data: scene.data,
  }
}

function parseWikiLink(raw) {
  const match = raw.match(/^\s*\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]\s*$/)
  if (!match) return null
  return {
    target: match[1].trim(),
    heading: match[2]?.trim() ?? '',
    alias: match[3]?.trim() ?? '',
  }
}

function textBlock(raw) {
  const link = parseWikiLink(raw)
  if (link) {
    const display = link.alias || link.target
    return {
      text: display,
      originalText: display,
      rawText: display,
      link: raw.trim(),
    }
  }
  const inline = raw.match(/\[\[[^\]]+\]\]/)
  return {
    text: raw,
    originalText: raw,
    rawText: raw,
    ...(inline ? { link: inline[0] } : {}),
  }
}

export function applyObsidianMarkdown(scene, parsed) {
  const elements = scene.elements.map((element) => {
    if (!element || element.isDeleted) return element
    const raw = parsed.textElements.get(element.id)
    if (raw !== undefined) {
      if (element.type === 'text') {
        return { ...element, ...textBlock(raw) }
      }
      const wiki = raw.match(/\[\[[^\]]+\]\]/)
      if (wiki) return { ...element, link: wiki[0] }
    }
    const link = parsed.elementLinks.get(element.id)
    if (link !== undefined) return { ...element, link }
    return element
  })
  return { ...scene, elements }
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

function hashId(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  let result = ''
  let state = hash >>> 0
  for (let index = 0; index < 8; index++) {
    result += ID_CHARS[state % ID_CHARS.length]
    state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0
  }
  return result
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8}$/.test(id)
}

export function normalizeObsidianIds(scene) {
  const elements = scene.elements.map((element) =>
    element ? { ...element } : element,
  )
  const used = new Set()
  const remap = new Map()
  const needsRemap = (element) => {
    if (!element || element.isDeleted) return false
    if (element.type === 'text' || element.link) return true
    return false
  }
  for (const element of elements) {
    if (!element || needsRemap(element) || !validId(element.id)) continue
    used.add(element.id)
  }
  for (const element of elements) {
    if (!needsRemap(element)) continue
    if (validId(element.id) && !used.has(element.id)) {
      used.add(element.id)
      continue
    }
    let next = hashId(`${element.id}:${element.type ?? 'element'}`)
    let suffix = 0
    while (used.has(next) || !validId(next)) {
      next = hashId(`${element.id}:${suffix++}`)
    }
    used.add(next)
    if (element.id !== next) remap.set(element.id, next)
  }
  if (!remap.size) return scene

  const mapId = (id) => (id && remap.has(id) ? remap.get(id) : id)
  for (const element of elements) {
    if (!element) continue
    element.id = mapId(element.id)
    if (element.containerId) element.containerId = mapId(element.containerId)
    if (element.frameId) element.frameId = mapId(element.frameId)
    if (Array.isArray(element.boundElements)) {
      element.boundElements = element.boundElements.map((bound) =>
        bound && remap.has(bound.id) ? { ...bound, id: remap.get(bound.id) } : bound,
      )
    }
    if (element.startBinding?.elementId) {
      element.startBinding = {
        ...element.startBinding,
        elementId: mapId(element.startBinding.elementId),
      }
    }
    if (element.endBinding?.elementId) {
      element.endBinding = {
        ...element.endBinding,
        elementId: mapId(element.endBinding.elementId),
      }
    }
  }
  return { ...scene, elements }
}

function textBlocks(elements, includeLegacyLinks = false, order = []) {
  const blocks = []
  const seen = new Set()
  const inlineLinks = new Set()
  const byId = new Map(elements.map((element) => [element.id, element]))
  const add = (element) => {
    if (!element || element.isDeleted || seen.has(element.id)) return
    if (element.type === 'text') {
      seen.add(element.id)
      const raw = String(
        element.rawText ?? element.originalText ?? element.text ?? '',
      )
      const link = typeof element.link === 'string' ? element.link : ''
      let line = raw
      if (link.startsWith('[[') && (!raw || !raw.includes(link))) line = link
      if (link && line.includes(link)) inlineLinks.add(element.id)
      blocks.push(`${line} ^${element.id}`)
      return
    }
    if (includeLegacyLinks && element.link) {
      seen.add(element.id)
      inlineLinks.add(element.id)
      blocks.push(`${element.link} ^${element.id}`)
    }
  }
  for (const id of order) add(byId.get(id))
  for (const element of elements) add(element)
  return { body: blocks.join('\n\n'), inlineLinks }
}

function elementLinksBody(elements, inlineLinks) {
  const lines = []
  for (const element of elements) {
    if (!element || element.isDeleted || !element.link) continue
    if (element.type === 'text' && inlineLinks.has(element.id)) continue
    if (element.type !== 'text' && inlineLinks.has(element.id)) continue
    lines.push(`${element.id}: ${element.link}`)
  }
  return lines.join('\n\n')
}

export function sceneTextSections(scene, options = {}) {
  const legacyLinks = options.legacyLinks === true
  const text = textBlocks(
    scene.elements,
    legacyLinks,
    options.textOrder ?? [],
  )
  return {
    textElements: text.body,
    elementLinks: legacyLinks
      ? ''
      : elementLinksBody(scene.elements, text.inlineLinks),
  }
}

export function embeddedFilesBody(parsed, files) {
  const entries = new Map(parsed.embeddedFiles)
  for (const [id, file] of Object.entries(files ?? {})) {
    if (entries.has(id)) continue
    if (file?.dataURL) entries.set(id, `[[assets/${assetName(id, file)}]]`)
  }
  return [...entries].map(([id, link]) => `${id}: ${link}`).join('\n\n')
}

export function assetName(fileId, file) {
  const mime = typeof file?.mimeType === 'string' ? file.mimeType : ''
  const extension =
    mime === 'image/svg+xml'
      ? 'svg'
      : mime.startsWith('image/')
        ? mime.slice('image/'.length).replace('jpeg', 'jpg')
        : 'bin'
  const safe = String(fileId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${safe || 'image'}.${extension}`
}

function compressed(value) {
  const encoded = LZString.compressToBase64(value)
  return encoded.match(new RegExp(`.{1,${CHUNK}}`, 'g'))?.join('\n\n') ?? encoded
}

function sectionText(body) {
  return body ? `${body}\n\n` : ''
}

export function obsidianEdits(parsed, scene, options = {}) {
  if (!parsed.ok) throw new Error('Cannot compose an invalid Obsidian drawing.')
  const sections = sceneTextSections(scene, {
    legacyLinks: !parsed.sections.links,
    textOrder: [...parsed.textElements.keys()],
  })
  const links = options.elementLinks ?? sections.elementLinks
  const text = options.textElements ?? sections.textElements
  const files = options.embeddedFiles ?? embeddedFilesBody(parsed, scene.files)
  const mode = options.mode ?? parsed.drawing.mode
  const json = options.sceneJson
  if (typeof json !== 'string') throw new Error('Missing scene JSON.')

  const edits = []
  let missing = ''
  const replaceSection = (key, body) => {
    const section = parsed.sections[key]
    if (section) {
      const expectedText = parsed.source.slice(section.next, section.end)
      const insert = sectionText(body)
      if (insert !== expectedText) {
        edits.push({
          from: section.next,
          to: section.end,
          insert,
          expectedText,
        })
      }
    } else if (body) {
      const label =
        key === 'texts'
          ? 'Text Elements'
          : key === 'links'
            ? 'Element Links'
            : 'Embedded Files'
      missing += `# ${label}\n${body}\n\n`
    }
  }

  replaceSection('texts', text)
  replaceSection('links', links)
  replaceSection('files', files)
  if (missing) {
    edits.push({
      from: parsed.drawing.commentStart,
      to: parsed.drawing.commentStart,
      insert: missing,
      expectedText: '',
    })
  }

  const drawingText = mode === 'compressed' ? compressed(json) : json
  const drawingInsert = `${drawingText}\n`
  const drawingExpected = parsed.source.slice(
    parsed.drawing.contentStart,
    parsed.drawing.contentEnd,
  )
  if (drawingInsert !== drawingExpected) {
    edits.push({
      from: parsed.drawing.contentStart,
      to: parsed.drawing.contentEnd,
      insert: drawingInsert,
      expectedText: drawingExpected,
    })
  }

  return edits.sort((left, right) => left.from - right.from || left.to - right.to)
}

export function applyObsidianEdits(source, edits) {
  let output = ''
  let cursor = 0
  for (const edit of edits) {
    if (edit.from < cursor) continue
    output += source.slice(cursor, edit.from)
    output += edit.insert
    cursor = edit.to
  }
  output += source.slice(cursor)
  return output
}

export function composeObsidianDrawing(parsed, scene, options = {}) {
  return applyObsidianEdits(
    parsed.source,
    obsidianEdits(parsed, scene, options),
  )
}

export function blankObsidianDocument(sceneJson) {
  return `---
excalidraw-plugin: parsed
tags: [excalidraw]
---

# Text Elements

%%
# Drawing
\`\`\`json
${sceneJson.trimEnd()}
\`\`\`
%%
`
}

export function repairObsidianSource(source) {
  const parsed = parseObsidianDrawing(source)
  if (!parsed.ok) return { ok: false, error: parsed }
  const normalized = normalizeObsidianIds(parsed.data)
  const legacyLinks = !parsed.sections.links
  const sections = sceneTextSections(normalized, {
    legacyLinks,
    textOrder: [...parsed.textElements.keys()],
  })
  const sceneJson = JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: parsed.sceneSource ?? 'https://excalidraw.com',
      elements: normalized.elements,
      appState: normalized.appState,
      files: normalized.files,
    },
    null,
    '\t',
  )
  const markdown = composeObsidianDrawing(parsed, normalized, {
    ...sections,
    sceneJson,
  })
  return { ok: true, markdown, changed: markdown !== source }
}
