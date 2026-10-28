const sessions = new Set()

export function registerEditorSession(session) {
  sessions.add(session)
  return () => sessions.delete(session)
}

export function flushEditorSessions(exceptTabId) {
  for (const session of [...sessions]) {
    if (exceptTabId !== undefined && session.tabId === exceptTabId) continue
    try {
      session.flush()
    } catch (error) {
      console.error('Could not flush an Excalidraw document:', error)
    }
  }
}

export function saveEditorSessions() {
  let saved = 0
  for (const session of [...sessions]) {
    try {
      session.flush()
      session.save()
      saved++
    } catch (error) {
      console.error('Could not save an Excalidraw document:', error)
    }
  }
  return saved
}

export function shouldHandleSave() {
  if (sessions.size === 0) return false
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return true
  for (const session of sessions) {
    if (session.container?.contains(active)) return true
  }
  if (active.closest('[contenteditable="true"], textarea, input, select')) {
    return false
  }
  return true
}

function focusedSession() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return null
  for (const session of sessions) {
    if (session.container?.contains(active)) return session
  }
  return null
}

function historyTarget() {
  const focused = focusedSession()
  if (focused) return focused
  return sessions.size === 1 ? [...sessions][0] : null
}

function isMac() {
  return /mac|iphone|ipad|ipod/i.test(
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent,
  )
}

function dispatchHistory(session, direction) {
  const active = document.activeElement
  const target =
    active instanceof HTMLElement && session.container?.contains(active)
      ? active
      : session.container?.querySelector('.excalidraw')
  if (!target) return false
  const mac = isMac()
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    code: 'KeyZ',
    keyCode: 90,
    which: 90,
    ctrlKey: !mac,
    metaKey: mac,
    shiftKey: direction === 'redo',
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return true
}

/** Hibi intercepts undo/redo before the renderer, so forward it to a focused canvas. */
export function installHistoryBridge(context) {
  const undo = context.patches.instead(
    Document.prototype,
    'execCommand',
    (args, next) => {
      const command = args[0]
      if (command !== 'undo' && command !== 'redo') return next(...args)
      const session = historyTarget()
      if (!session) return next(...args)
      return dispatchHistory(session, command) || next(...args)
    },
  )

  // Markdown documents route history through beforeinput on the focused rich editor.
  const onBeforeInput = (event) => {
    if (
      event.inputType !== 'historyUndo' &&
      event.inputType !== 'historyRedo'
    ) {
      return
    }
    const session = focusedSession()
    if (!session) return
    event.preventDefault()
    event.stopPropagation()
    dispatchHistory(
      session,
      event.inputType === 'historyRedo' ? 'redo' : 'undo',
    )
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('beforeinput', onBeforeInput, true)
  }

  return () => {
    undo()
    if (typeof document !== 'undefined') {
      document.removeEventListener('beforeinput', onBeforeInput, true)
    }
  }
}
