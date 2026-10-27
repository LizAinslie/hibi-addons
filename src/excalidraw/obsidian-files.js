const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

function extensionFor(mime) {
  if (mime === 'image/svg+xml') return 'svg'
  if (mime.startsWith('image/')) return mime.slice(6).replace('jpeg', 'jpg')
  return 'bin'
}

function mimeForPath(path) {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[extension] ?? 'application/octet-stream'
}

function localPath(link) {
  const match = link.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/)
  if (!match) return null
  const path = match[1].trim()
  if (!path || /^[a-z]+:/i.test(path) || path.startsWith('/')) return null
  return path
}

function dirname(path) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function join(...parts) {
  return parts.filter(Boolean).join('/').replaceAll('//', '/')
}

function dataUrl(value) {
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!match) return null
  return { mime: match[1], base64: match[2].replace(/\s+/g, '') }
}

function bytesFromDataUrl(value) {
  const info = dataUrl(value)
  if (!info) return null
  const binary = atob(info.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return { ...info, bytes }
}

function dataUrlFromBytes(bytes, mime) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

async function workspaceTarget(context) {
  const workspace = await context.workspace.get()
  if (!workspace?.id || workspace.workspaceGeneration === undefined) {
    return null
  }
  return {
    workspaceId: workspace.id,
    workspaceGeneration: workspace.workspaceGeneration,
  }
}

async function drawingFolder(context, document) {
  const index = await context.workspace.index()
  const pages = index?.pages ?? []
  const candidates = pages.filter(
    (page) =>
      page.path === document.name ||
      page.path.endsWith(`/${document.name}`),
  )
  const page =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((candidate) => candidate.markdown === document.markdown)
  return page ? dirname(page.path) : ''
}

export async function loadObsidianFiles(context, document, parsed) {
  if (!parsed?.embeddedFiles?.size) return {}
  const target = await workspaceTarget(context)
  if (!target) return {}
  const folder = await drawingFolder(context, document)
  const files = {}

  for (const [id, link] of parsed.embeddedFiles) {
    const relative = localPath(link)
    if (!relative) continue
    const candidates = folder
      ? [join(folder, relative), relative]
      : [relative]
    for (const path of candidates) {
      const result = await context.workspace.readBinary(target, path)
      if (!result.ok) continue
      const mime = mimeForPath(path)
      files[id] = {
        id,
        mimeType: mime,
        dataURL: dataUrlFromBytes(result.value.bytes, mime),
        created: Date.now(),
        lastRetrieved: Date.now(),
      }
      break
    }
  }
  return files
}

export async function writeObsidianFiles(context, document, files, parsed) {
  const target = await workspaceTarget(context)
  if (!target) return
  const folder = await drawingFolder(context, document)
  const assets = folder ? join(folder, 'assets') : 'assets'
  const existing = parsed?.embeddedFiles ?? new Map()

  for (const [id, file] of Object.entries(files ?? {})) {
    if (existing.has(id)) continue
    const decoded = bytesFromDataUrl(file?.dataURL ?? '')
    if (!decoded) continue
    const extension = extensionFor(decoded.mime)
    const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    const name = `${safe || 'image'}.${extension}`
    const result = await context.workspace.createBinary(
      target,
      join(assets, name),
      decoded.bytes,
    )
    if (!result.ok && result.code !== 'conflict') {
      throw new Error(result.message)
    }
  }
}
