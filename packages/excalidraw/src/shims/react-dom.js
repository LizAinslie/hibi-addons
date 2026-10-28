import React from './react.js'

const PORTAL = Symbol.for('react.portal')

let portalHost = null

export function setPortalHost(host) {
  portalHost = host ?? null
}

export function createPortal(children, container, key = null) {
  const target = resolveContainer(container)
  return {
    $$typeof: PORTAL,
    key: key == null ? null : String(key),
    children,
    containerInfo: target,
    implementation: null,
  }
}

function resolveContainer(container) {
  if (!portalHost) return container
  if (typeof Node === 'undefined' || !(container instanceof Node)) {
    return portalHost
  }
  const root = portalHost.parentElement
  return root && root.contains(container) ? container : portalHost
}

export function flushSync(callback, ...args) {
  return callback ? callback(...args) : undefined
}

export function unstable_batchedUpdates(callback, ...args) {
  return callback(...args)
}

export const version = React.version

export default {
  createPortal,
  flushSync,
  unstable_batchedUpdates,
  version,
}
