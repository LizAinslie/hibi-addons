export const MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const MAX_EDIT_CHARS = 4 * 1024 * 1024

const blank = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [],
  appState: {
    gridSize: null,
    viewBackgroundColor: '#ffffff',
  },
  files: {},
}

export const blankDocument = () => `${JSON.stringify(blank, null, 2)}\n`

export function isExcalidrawName(name) {
  return typeof name === 'string' && /\.excalidraw$/i.test(name)
}

function failure(reason, message) {
  return { ok: false, reason, message }
}

export function parseScene(source) {
  if (typeof source !== 'string') {
    return failure('invalid-source', 'The document source is not text.')
  }
  if (!source.trim()) {
    return {
      ok: true,
      empty: true,
      data: { elements: [], appState: {}, files: {} },
    }
  }
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return failure(
      'invalid-json',
      error instanceof Error ? error.message : 'This is not valid JSON.',
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failure('invalid-scene', 'The drawing must be a JSON object.')
  }
  if (parsed.type !== undefined && parsed.type !== 'excalidraw') {
    return failure(
      'invalid-scene',
      'This file is not an Excalidraw drawing. Expected "type": "excalidraw".',
    )
  }
  if (
    parsed.elements !== undefined &&
    parsed.elements !== null &&
    !Array.isArray(parsed.elements)
  ) {
    return failure('invalid-scene', '"elements" must be an array.')
  }
  if (
    parsed.appState !== undefined &&
    parsed.appState !== null &&
    (typeof parsed.appState !== 'object' || Array.isArray(parsed.appState))
  ) {
    return failure('invalid-scene', '"appState" must be an object.')
  }
  if (
    parsed.files !== undefined &&
    parsed.files !== null &&
    (typeof parsed.files !== 'object' || Array.isArray(parsed.files))
  ) {
    return failure('invalid-scene', '"files" must be an object.')
  }
  return {
    ok: true,
    empty: false,
    data: {
      elements: parsed.elements ?? [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    },
  }
}

const highSurrogate = (code) => code >= 0xd800 && code <= 0xdbff
const lowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff

/** UTF-16 offsets for the smallest middle replacement between two strings. */
export function minimalChange(previous, next) {
  if (previous === next) return null

  let prefix = 0
  const limit = Math.min(previous.length, next.length)
  while (prefix < limit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++
  }
  if (prefix > 0 && highSurrogate(previous.charCodeAt(prefix - 1))) prefix--

  let suffix = 0
  while (
    suffix < limit - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) ===
      next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix++
  }
  if (
    suffix > 0 &&
    lowSurrogate(previous.charCodeAt(previous.length - suffix)) &&
    highSurrogate(previous.charCodeAt(previous.length - suffix - 1))
  ) {
    suffix--
  }

  return {
    from: prefix,
    to: previous.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
    expectedText: previous.slice(prefix, previous.length - suffix),
  }
}

export function summariseScene(data) {
  const elements = Array.isArray(data?.elements) ? data.elements : []
  const files = data?.files && typeof data.files === 'object' ? data.files : {}
  return {
    elements: elements.filter((element) => element && !element.isDeleted).length,
    images: Object.keys(files).length,
  }
}

const VOLATILE_ELEMENT_KEYS = new Set(['version', 'versionNonce', 'updated'])
const EXPORTED_APP_STATE_KEYS = [
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'viewBackgroundColor',
]

function stableElement(element) {
  if (!element || typeof element !== 'object') return element
  const copy = {}
  for (const key of Object.keys(element)) {
    if (!VOLATILE_ELEMENT_KEYS.has(key)) copy[key] = element[key]
  }
  return copy
}

function exportedAppState(appState) {
  const result = {}
  for (const key of EXPORTED_APP_STATE_KEYS) {
    if (appState?.[key] !== undefined) result[key] = appState[key]
  }
  return result
}

export function scenesEquivalent(left, right) {
  if (!left || !right) return false
  const leftElements = left.elements ?? []
  const rightElements = right.elements ?? []
  if (leftElements.length !== rightElements.length) return false
  for (let index = 0; index < leftElements.length; index++) {
    if (
      JSON.stringify(stableElement(leftElements[index])) !==
      JSON.stringify(stableElement(rightElements[index]))
    ) {
      return false
    }
  }
  return (
    JSON.stringify(exportedAppState(left.appState)) ===
      JSON.stringify(exportedAppState(right.appState)) &&
    JSON.stringify(left.files ?? {}) === JSON.stringify(right.files ?? {})
  )
}
