import React from './react.js'

export const Fragment = React.Fragment

function withKey(props, key) {
  if (key == null) return props ?? {}
  return Object.assign({}, props, { key })
}

export function jsx(type, props, key) {
  return React.createElement(type, withKey(props, key))
}

export const jsxs = jsx

export function jsxDEV(type, props, key, _isStaticChildren, _source, _self) {
  return React.createElement(type, withKey(props, key))
}
