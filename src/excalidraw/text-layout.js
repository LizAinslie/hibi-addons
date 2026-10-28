const FONT_FAMILIES = {
  1: 'Virgil',
  2: 'Helvetica',
  3: 'Cascadia',
  5: 'Excalifont',
  6: 'Nunito',
  7: 'Lilita One',
  8: 'Comic Shanns',
  9: 'Liberation Sans',
}

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])

export function fontFamilyName(fontFamily) {
  return FONT_FAMILIES[fontFamily] ?? FONT_FAMILIES[1]
}

export function fontCss(fontFamily, fontSize) {
  return `${fontSize}px "${fontFamilyName(fontFamily)}", "Segoe UI Emoji", sans-serif`
}

function breakWord(word, maxWidth, measure) {
  const chunks = []
  let chunk = ''
  for (const character of word) {
    const next = chunk + character
    if (chunk && measure(next) > maxWidth) {
      chunks.push(chunk)
      chunk = character
    } else {
      chunk = next
    }
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

export function wrapText(text, maxWidth, measure) {
  const paragraphs = String(text ?? '').split('\n')
  const lines = []
  let width = 0

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    for (const originalWord of paragraph.split(' ')) {
      let words =
        measure(originalWord) > maxWidth
          ? breakWord(originalWord, maxWidth, measure)
          : [originalWord]
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (line && measure(candidate) > maxWidth) {
          lines.push(line)
          width = Math.max(width, measure(line))
          line = word
        } else {
          line = candidate
        }
      }
    }
    if (line) {
      lines.push(line)
      width = Math.max(width, measure(line))
    }
  }

  return {
    text: lines.join('\n'),
    lines: Math.max(1, lines.length),
    width,
  }
}

export function layoutBoundText(data, measure) {
  const elements = data.elements.map((element) =>
    element ? { ...element } : element,
  )
  const byId = new Map(
    elements.filter(Boolean).map((element) => [element.id, element]),
  )

  for (const element of elements) {
    if (!element || element.type !== 'text' || !element.containerId) continue
    const container = byId.get(element.containerId)
    if (!container || !SHAPE_TYPES.has(container.type)) continue
    if (
      typeof container.width !== 'number' ||
      typeof container.height !== 'number'
    ) {
      continue
    }

    const fontSize = element.fontSize ?? 20
    const lineHeight = (element.lineHeight ?? 1.25) * fontSize
    const source = String(
      element.originalText ?? element.rawText ?? element.text ?? '',
    )
    const maxWidth = Math.max(40, container.width - 10)
    const wrapped = wrapText(source, maxWidth, (value) =>
      measure(value, fontCss(element.fontFamily, fontSize)),
    )

    element.text = wrapped.text
    element.width = Math.max(1, wrapped.width)
    element.height = wrapped.lines * lineHeight

    const inset = 5
    if (element.textAlign === 'left') {
      element.x = container.x + inset
    } else if (element.textAlign === 'right') {
      element.x = container.x + container.width - element.width - inset
    } else {
      element.x = container.x + (container.width - element.width) / 2
    }

    if (element.verticalAlign === 'top') {
      element.y = container.y + inset
    } else if (element.verticalAlign === 'bottom') {
      element.y = container.y + container.height - element.height - inset
    } else {
      element.y = container.y + (container.height - element.height) / 2
    }
  }

  return { ...data, elements }
}

export function canvasMeasure() {
  if (typeof document === 'undefined') {
    return (text) => text.length * 10
  }
  const context = document.createElement('canvas').getContext('2d')
  return (text, font) => {
    context.font = font
    return context.measureText(text).width
  }
}
