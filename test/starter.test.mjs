import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkRepository } from '../scripts/check.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = (folder) =>
  JSON.parse(readFileSync(join(root, folder, 'hibi-addon.json'), 'utf8'))

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hibi-starter-'))
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
    [['addons/excalidraw', 'extension'], ['addons/hello', 'extension']],
  )
})

test('the extension registers its declared command and stops cleanly', async () => {
  const { default: create } = await import('../addons/hello/index.js')
  const commands = new Map()
  const messages = []
  let stored = { status: 'missing', revision: 0 }
  const addon = create()
  await addon.start({
    storage: {
      global: async (key, version) => {
        assert.deepEqual([key, version], ['greetings', 1])
        return {
          snapshot: () => stored,
          set: async (value) => {
            stored = { status: 'ready', revision: stored.revision + 1, value }
            return { status: 'saved', ...stored }
          },
        }
      },
    },
    commands: {
      register: (command) => {
        commands.set(command.id, command)
        return () => commands.delete(command.id)
      },
    },
    notify: (message) => messages.push(message),
  })
  assert.deepEqual(
    [...commands.values()].map(({ id, label }) => ({ id, label })),
    manifest('addons/hello').commands,
  )
  await commands.get('greet').run()
  await commands.get('greet').run()
  assert.deepEqual(messages, [
    'Hello from your Hibi addon.',
    'Hello again. You have said hello 2 times.',
  ])
  addon.stop()
  assert.equal(commands.size, 0)
})

test('each package also installs on its own from its folder', () => {
  for (const folder of ['addons/excalidraw', 'addons/hello'])
    assert.deepEqual(
      checkRepository(join(root, folder)).map((item) => item.folder),
      [''],
    )
})

test('the check rejects files Hibi would refuse', (t) => {
  const directory = scratch(t)
  renameSync(
    join(directory, 'addons/hello/LICENSE.txt'),
    join(directory, 'addons/hello/LICENSE'),
  )
  assert.throws(() => checkRepository(directory), /does not install LICENSE/)
})

test('the check rejects a top-level package next to nested packages', (t) => {
  const directory = scratch(t)
  cpSync(join(directory, 'addons/hello'), directory, { recursive: true })
  assert.throws(() => checkRepository(directory), /Package folders overlap/)
})
