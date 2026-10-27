import { isExcalidrawName } from './scene.js'

export function isObsidianExcalidrawName(name) {
  return typeof name === 'string' && /\.excalidraw\.md$/i.test(name)
}

export function looksLikeObsidianExcalidraw(source) {
  if (typeof source !== 'string') return false
  const head = source.slice(0, 65536)
  return (
    /^---[\s\S]*?^excalidraw-plugin\s*:/m.test(head) ||
    /^excalidraw-plugin\s*:/m.test(head)
  )
}

export function detectDocumentKind(name, source) {
  if (isExcalidrawName(name)) return 'native'
  if (isObsidianExcalidrawName(name)) return 'obsidian'
  if (name?.toLowerCase().endsWith('.md') && looksLikeObsidianExcalidraw(source)) {
    return 'obsidian'
  }
  return 'unknown'
}

export function canOpenExcalidrawDocument(name, source) {
  return detectDocumentKind(name, source) !== 'unknown'
}
