import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkRepository } from '../scripts/check.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hibi-addons-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  cpSync(join(root, 'addons'), join(directory, 'addons'), { recursive: true })
  return directory
}

test('the repository contains an installable extension', () => {
  assert.deepEqual(
    checkRepository(root).map(({ folder, manifest }) => [
      folder,
      manifest.kind,
    ]),
    [['addons/excalidraw', 'extension']],
  )
})

test('each package also installs on its own from its folder', () => {
  for (const folder of ['addons/excalidraw'])
    assert.deepEqual(
      checkRepository(join(root, folder)).map((item) => item.folder),
      [''],
    )
})

test('the check rejects files Hibi would refuse', (t) => {
  const directory = scratch(t)
  renameSync(
    join(directory, 'addons/excalidraw/LICENSE.txt'),
    join(directory, 'addons/excalidraw/LICENSE'),
  )
  assert.throws(() => checkRepository(directory), /does not install LICENSE/)
})

test('the check rejects a top-level package next to nested packages', (t) => {
  const directory = scratch(t)
  cpSync(join(directory, 'addons/excalidraw'), directory, {
    recursive: true,
  })
  assert.throws(() => checkRepository(directory), /Package folders overlap/)
})
