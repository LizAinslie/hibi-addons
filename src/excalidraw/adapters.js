import { serializeAsJSON } from '@excalidraw/excalidraw'
import { detectDocumentKind } from './detect.js'
import {
  applyObsidianEdits,
  applyObsidianMarkdown,
  normalizeObsidianIds,
  obsidianEdits,
  parseObsidianDrawing,
  sceneTextSections,
} from './obsidian.js'
import { parseScene } from './scene.js'

export function documentKind(name, source) {
  return detectDocumentKind(name, source)
}

export function loadDocument(kind, source) {
  if (kind === 'obsidian') {
    const parsed = parseObsidianDrawing(source)
    if (!parsed.ok) return { ok: false, error: parsed }
    const data = applyObsidianMarkdown(parsed.data, parsed)
    return { ok: true, data, parsed, empty: false }
  }
  const parsed = parseScene(source)
  if (!parsed.ok) return { ok: false, error: parsed }
  return { ok: true, data: parsed.data, parsed: null, empty: parsed.empty }
}

function obsidianSceneJson(scene, mode, source) {
  const parsed = JSON.parse(
    serializeAsJSON(scene.elements, scene.appState, scene.files, 'local'),
  )
  if (typeof source === 'string' && source) parsed.source = source
  return mode === 'compressed'
    ? JSON.stringify(parsed)
    : JSON.stringify(parsed, null, '\t')
}

export function serializeDocument(kind, scene, options = {}) {
  if (kind === 'obsidian') {
    const normalized = normalizeObsidianIds(scene)
    const legacyLinks = !options.parsed?.sections?.links
    const sections = sceneTextSections(normalized, {
      legacyLinks,
      textOrder: [...(options.parsed?.textElements?.keys?.() ?? [])],
    })
    const mode = options.parsed?.drawing?.mode ?? 'json'
    const edits = obsidianEdits(options.parsed, normalized, {
      ...sections,
      sceneJson: obsidianSceneJson(
        normalized,
        mode,
        options.parsed?.sceneSource,
      ),
      mode,
    })
    const source = applyObsidianEdits(options.parsed.source, edits)
    return { source, scene: normalized, edits }
  }
  return {
    source: `${serializeAsJSON(
      scene.elements,
      scene.appState,
      scene.files,
      'local',
    )}\n`,
    scene,
  }
}
