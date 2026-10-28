# Excalidraw addon: native JSON + Obsidian `.excalidraw.md`

## Status

Phase 1 is implemented and verified in Hibi:

- `addons/excalidraw/` installable package.
- Native `.excalidraw` documents, full-size Excalidraw editor tab, auto-open, autosave, undo/redo, local fonts, offline operation.
- Source: `src/excalidraw/`; build: `scripts/build-excalidraw.mjs`; tests: `test/excalidraw.test.mjs`.
- Verified with a real Hibi Electron smoke test: draw/text/save/undo/redo, no external requests, no CSP errors.

Phase 2 adds Obsidian `.excalidraw.md` support and makes it the canonical interoperable drawing format. Native `.excalidraw` remains supported for standalone JSON, import, and export.

## Goal

A user can point Hibi at an Obsidian vault, open a `.excalidraw.md` file, see the real Excalidraw canvas, edit it, and save it back as a valid Obsidian Excalidraw Markdown file:

- Header/frontmatter preserved.
- `[[note]]` links still work in Obsidian and are indexed by Hibi.
- Text elements, element links, embedded files, and compressed/uncompressed drawing data round-trip.
- New Hibi drawings default to `.excalidraw.md`.

## Hard constraints

- Hibi matches the final filename extension and rejects dotted extensions. `.excalidraw.md` is always a **Markdown document** in Hibi. Do not try to register it with `registerDocumentFormat`.
- Hibi's documented format API only permits a read-only Preview. The editable canvas remains the existing full-size addon tab.
- Hibi documents are capped at 2 MiB UTF-8. Check the whole composed Markdown.
- The Obsidian Excalidraw plugin is GPL-3.0. Implement the file format clean-room from the file structure and public behavior. Do not copy plugin code, regexes, or constants.
- Hibi's Obsidian importer converts wiki links outside fenced code blocks. That includes `# Text Elements` and `# Embedded Files`. Direct vault opening avoids conversion; imported copies need repair or a core-importer exception.
- Hibi addons do not receive the open document's workspace-relative path. Resolve it through `workspace.index()` by basename for now; upstream should add `path` to `DocumentState`/`OpenDocumentMetadata`.
- Installed addons cannot register native importers or addon windows.

## Detection

Add `detectExcalidrawDocument(name, source)`:

- `native-json`: name ends with `.excalidraw`.
- `obsidian-markdown`: name ends with `.excalidraw.md`, or the source has YAML frontmatter with `excalidraw-plugin` and a parseable `Drawing` section.
- `unsupported`: everything else.

Do not auto-open arbitrary `.md` files just because they contain a `# Drawing` heading. Require the filename suffix or the frontmatter key.

Update:

- `isExcalidrawName` / `maybeAutoOpen` in `src/excalidraw/index.js`.
- The editor-tab `Editor` component to choose the native or Obsidian adapter.
- The auto-open dedupe set remains keyed by `tabId`; opening a `.excalidraw.md` selects the Excalidraw tab once per document, not on every focus change.

## Obsidian file format

Support both current and older structures:

- Optional YAML frontmatter.
- Optional `# Excalidraw Data` heading.
- `# Text Elements` or `## Text Elements`; text blocks end with 8-character `^blockid` refs.
- `# Element Links` or `## Element Links`; `elementId: link` entries.
- `# Embedded Files` or `## Embedded Files`; `fileId: [[path]]`, URL, or equation entries.
- `# Drawing` or `## Drawing` inside an optional `%%` comment.
- Fenced code block with language `json` or `compressed-json`.
- CRLF, BOM, and missing optional sections are tolerated.
- Uncompressed JSON is read directly.
- `compressed-json` is LZString base64: strip whitespace, `decompressFromBase64`. On save, `compressToBase64` and split into 256-character chunks separated by `\n\n`. Add `lz-string` (MIT) to the bundle.
- Preserve the existing heading level, section order, compression mode, and optional sections. New files use a sample-compatible structure:

```md
---
excalidraw-plugin: parsed
tags: [excalidraw]
---

# Text Elements
...

# Element Links
...

# Embedded Files
...

%%
# Drawing
```json
{ ... }
```
%%
```

New files default to uncompressed JSON for readability and diffability. Preserve compressed mode when editing an existing compressed file. Add a command later if users want to toggle.

## Parser / writer module

Add a pure module, e.g. `src/excalidraw/obsidian.js`:

```js
parseObsidianDrawing(source) // -> { header, sections, drawingBlock, trailing, scene, mode, errors }
composeObsidianDrawing(parsed, scene, extras) // -> updated Markdown
```

Rules:

- The **header** is everything before the first generated section (`# Excalidraw Data`, `Text Elements`, `Element Links`, `Embedded Files`, or `Drawing`). Preserve it byte-for-byte, including frontmatter and user notes.
- Generated sections are regenerated from the scene on save.
- Preserve trailing content after the drawing block, if present.
- Apply a minimal edit (`minimalChange`) to the composed Markdown; never replace the whole document blindly.
- If the structure cannot be identified, do not write; show an error with source-view access.

Load order:

1. Parse frontmatter and drawing block.
2. Parse `# Text Elements` and apply it to the scene. The Markdown text section is authoritative in Obsidian.
3. Parse `# Element Links` and apply links.
4. Parse `# Embedded Files` and load attachments.
5. Fall back to scene JSON text/links for sections that are absent.

Save order:

1. Normalize IDs.
2. Serialize scene.
3. Externalize new files.
4. Regenerate text/element/file sections.
5. Compose header + sections + drawing block + trailing content.
6. Apply the minimal edit through the existing document sync.

## Text elements and IDs

- Obsidian treats `# Text Elements` as authoritative. Hibi must read it, not just the JSON.
- Parse block refs with `^([A-Za-z0-9_-]{8})`; text is everything since the previous block ref.
- On load:
  - Plain text becomes `text`, `originalText`, and `rawText`.
  - A text block that is exactly a wiki link (`[[target]]`, `[[target|alias]]`, `[[target#heading]]`) sets `element.link` and displays the target text.
  - Inline Markdown formatting is preserved as raw text; full Markdown rendering inside canvas text is out of scope.
- On save:
  - Emit one block per non-deleted text element in scene order.
  - If `element.link` is a wiki link and the raw text does not already contain it, emit the link as the block text.
  - If the link is a URL, emit the raw text and add an `# Element Links` entry.
  - Append `^id`.
- Ensure every text element and every linked non-text element has a valid 8-character block-ref ID before writing sections.
- Deterministic remap: hash the old ID to `[A-Za-z0-9_-]{8}`, resolve collisions, then update:
  - `element.id`
  - all `boundElements[].id`
  - `containerId`
  - `startBinding.elementId` / `endBinding.elementId`
  - any other scene field that references element IDs
- Do not remap unrelated elements. If a reference cannot be updated safely, refuse to save and show an error.

## Embeddings and attachments

Follow Hibi's policy, not Obsidian's attachment-folder setting:

- New files go to `<drawing folder>/assets/`.
- Use `workspace.createBinary(target, path, bytes)`.
- Name files `Pasted image <timestamp>.<ext>` or a sanitized source name; add `-2`, `-3` on collision.
- Write `# Embedded Files` entries as `fileId: [[assets/<name>]]`.
- After externalizing, clear the data URLs from the scene's `files` map, matching Obsidian Excalidraw. Do not keep a second copy in JSON.
- On load, resolve `# Embedded Files` entries relative to the drawing:
  - Local paths: `workspace.readBinary`; convert bytes to a data URL for Excalidraw.
  - Remote URLs: do not fetch; keep the entry and show a broken/placeholder image.
  - Equations and Markdown-image custom elements are preserved but not rendered in phase 1.
- Preserve existing entries whose files cannot be resolved; never delete user attachments.
- `# Embedded Files` may be inside `%%`; preserve the comment wrapper.
- If the drawing's folder cannot be resolved uniquely, fall back to a workspace-root `assets/` folder and use a workspace-root link; show a notice.

## Links

- Pass an `onLinkOpen` handler to Excalidraw and call `event.preventDefault()`.
- Preserve the original link string in the scene and in generated Markdown.
- Resolve `[[target]]` / `[[target#heading]]` links through Hibi:
  - Preferred: `window.hibi.openDocumentLink('obsidian-wiki:' + encodeURIComponent(target), activeRevision)` when the active document revision matches the drawing.
  - Fallback: resolve by basename/path through `workspace.index()` and call `workspace.openFile(path)`.
- HTTP/HTTPS/mailto links use Hibi's external-link handling when available.
- The `# Text Elements` section stays outside fenced code so Hibi's Markdown graph indexes the `[[...]]` links and backlinks.
- The canvas-tab editor is the primary view. The Markdown tab may still show generated text; do not rewrite Hibi's Markdown renderer.

## Editor adapters and sync

Refactor the current editor into an adapter boundary:

```js
loadDocument(source, name) -> { scene, unsupported? }
serializeDocument(scene, context) -> { source, extras }
```

- `native-json`: current `parseScene` + `serializeAsJSON` behavior.
- `obsidian-markdown`: `parseObsidianDrawing` / `composeObsidianDrawing`.
- Keep the existing debounce (about 400 ms), minimal edit, echo suppression, external-change handling, flush-before-save/close, auto-save, and undo/redo bridge.
- For Obsidian Markdown, the external-change check compares the whole Markdown source, not just the JSON block.
- If the user edits the Markdown source while the canvas is hidden, reload the scene on return.
- If the source changes externally while the canvas is dirty, show a conflict; do not overwrite.
- Check the 2 MiB limit on the composed Markdown before applying or saving.
- Never call `documents.save()` from the Preview.

## Commands and new drawings

- `New Excalidraw drawing` creates `Untitled.excalidraw.md` in the current workspace, with the standard header, empty text/links/files sections, and a blank uncompressed JSON scene.
- Add `New standalone Excalidraw JSON file` for `Untitled.excalidraw`.
- `Open Excalidraw editor` works for both native and Obsidian drawings.
- Add `Repair Obsidian Excalidraw files` (see below).

## Vault import and repair

Direct workspace:

- Point Hibi at the Obsidian vault directly. `.excalidraw.md` files open as Markdown and auto-open the canvas tab. No conversion.

Hibi's Obsidian importer:

- Imported `.excalidraw.md` files are copied as Markdown.
- The importer may convert `[[...]]` links in the generated text/file sections to relative Markdown links. The JSON block is safe.
- Add a repair command that:
  1. Finds workspace pages ending `.excalidraw.md` or with `excalidraw-plugin` frontmatter.
  2. Parses the scene from the drawing block.
  3. Regenerates `# Text Elements`, `# Element Links`, and `# Embedded Files` from the scene, restoring wiki links.
  4. Preserves the header and trailing content.
  5. Uses `workspace.updateText` for closed files and the document API for open files; respect file versions and conflicts.
- Report files repaired, skipped, and failed.

Recommended Hibi core changes (separate from this addon):

- Expose the open document's workspace-relative path to addons.
- Make `import-obsidian` skip wiki-link conversion inside `.excalidraw.md` generated sections or preserve `%%` content.
- Longer term, allow content-based or dotted-extension document formats.

## Files to add/change

```text
src/excalidraw/obsidian.js          parser/writer, compression, sections, IDs
src/excalidraw/obsidian-links.js    link resolution helpers
src/excalidraw/obsidian-files.js    attachment read/write, path resolution
src/excalidraw/adapters.js          native vs Obsidian load/serialize
src/excalidraw/editor.jsx           adapter boundary, onLinkOpen, conflicts
src/excalidraw/index.js             detection, auto-open, commands, repair
src/excalidraw/scene.js             shared minimal edit/validation helpers
test/obsidian-format.test.mjs       fixtures and round-trip tests
test/excalidraw.test.mjs            detection/regression tests
addons/excalidraw/README.md         usage, limits, Obsidian behavior
addons/excalidraw/hibi-addon.json   version bump, command metadata
scripts/build-excalidraw.mjs        bundle lz-string, package checks
```

## Implementation tasks

1. **Adapter refactor**
   - Extract native load/serialize behind the adapter interface.
   - Keep all existing tests and the Hibi smoke behavior passing.
   - Add `obsidian-markdown` detection and adapter wiring.

2. **Pure Obsidian parser/writer**
   - Implement header/frontmatter preservation, old/new headings, `%%` comments, CRLF/BOM.
   - Implement `json` and `compressed-json` (LZString).
   - Implement text-element parse/write, element links, embedded files.
   - Implement 8-character ID normalization and reference updates.
   - Add fixture tests using the provided `OS Architecture Overview.excalidraw.md` and a synthetic compressed file.

3. **Detection, auto-open, new drawing**
   - Auto-open the Excalidraw tab for `.excalidraw.md` and frontmatter-detected Markdown.
   - New drawings create `.excalidraw.md`; add the standalone `.excalidraw` command.
   - Update README and manifest version to `0.2.0`.

4. **Sync and save integration**
   - Compose the whole Markdown and apply a minimal edit.
   - Preserve header/trailing content and compression mode.
   - Handle external Markdown edits, dirty conflicts, and the 2 MiB limit.
   - Keep auto-save, Hibi Save interception, undo/redo bridge.

5. **Attachments**
   - Load `# Embedded Files` via `workspace.readBinary`.
   - Externalize new data URLs to `<drawing folder>/assets/` via `workspace.createBinary`.
   - Clear `scene.files`, write `[[assets/...]]` entries, and handle collisions/unresolved paths.

6. **Links**
   - Add `onLinkOpen`.
   - Resolve wiki links through Hibi; open external links through the host.
   - Verify Hibi's graph indexes the text elements and backlinks.

7. **Repair command**
   - Scan, parse, regenerate generated sections, preserve headers.
   - Report results; never rewrite unsupported/encrypted files.

8. **Validation**
   - Unit tests and Hibi smoke tests.
   - Obsidian round-trip on a copy of the real vault file if Obsidian is available; otherwise verify the composed structure against the reference format.

## Failure handling

- Invalid/unknown/encrypted file: show the source, do not write.
- Missing or unparseable drawing block: error banner, no write.
- LZString decode failure: error banner, no write.
- Ambiguous document path: fall back to workspace-root `assets/`; notify.
- Attachment create failure: keep the canvas dirty, show an error, do not silently drop the image.
- Unresolvable element-ID references: refuse to save.
- Hibi importer converted wiki links: repair command; never auto-rewrite the header.
- Apply conflict/stale/busy: no overwrite; retry or reload.
- Over 2 MiB: banner; keep the canvas alive; no silent loss.
- Addon disabled: `.excalidraw.md` remains readable as Markdown; `.excalidraw` as source.

## Validation

Automated:

- `pnpm run build:excalidraw`
- `npm run check`
- `npm test`
- `node --check` all output JS
- Package limits: 1,000 entries, 25 MiB total, 5 MiB/file, 64 KiB manifest

Hibi smoke test:

1. Copy the real `OS Architecture Overview.excalidraw.md` into a temp workspace.
2. Open it; the Excalidraw tab auto-opens and shows the drawing and text.
3. Edit a shape and a text element; save; reopen; verify text and links.
4. Verify the header/frontmatter and non-generated text are byte-identical.
5. Edit the Markdown text section, reopen in Hibi, verify the canvas updates.
6. Undo/redo, save, close/reopen.
7. Add an image; verify `assets/<name>` exists, `# Embedded Files` maps it, and JSON `files` is empty.
8. Open a compressed fixture; edit and save; verify compression mode is preserved.
9. Run the repair command on an imported copy; verify `[[...]]` links are restored.
10. Confirm no network requests and no CSP errors.
11. Create a new `.excalidraw.md` and a standalone `.excalidraw` from commands.

Obsidian round-trip, if available:

- Open the edited file in Obsidian; verify the drawing, text, links, and images.
- Make a text edit in Obsidian; reopen in Hibi; verify it appears.

## Out of scope

- Editable normal-pane previews; blocked by Hibi's preview contract. This also affects DOCX/ODT and similar formats.
- Full Markdown rendering inside Excalidraw text (bold/formatting/embeds) beyond simple wiki-link extraction.
- Mermaid, LaTeX, PDF embeds, Markdown-image custom elements, and Excalidraw+ cloud features.
- Syncing Obsidian plugin settings or `.obsidian` configuration.
- Native addon windows and native importers.
- Perfect round-trip of every legacy Excalidraw-Obsidian feature; unsupported sections are preserved untouched.
- Multi-dot document format registration and content-based format selection in Hibi core.

## Upstream follow-ups

- Hibi: expose the open document's workspace path to addons.
- Hibi: skip wiki-link conversion inside `.excalidraw.md` generated sections in `import-obsidian`.
- Hibi: support content-based/dotted-extension document formats and an editable visual document pane.

## Phase 2 implementation status

Implemented:

- Obsidian `.excalidraw.md` parser/writer with header/frontmatter preservation, old and new heading levels, `json` and LZString `compressed-json`, text elements, element links, embedded files, and 8-character block-ref normalization.
- Filename/frontmatter detection, auto-opening the Excalidraw tab, new `.excalidraw.md` drawings, standalone `.excalidraw` command, and `[[note]]`/external link opening.
- Neighboring `assets/` attachment reads/writes via `workspace.readBinary` / `createBinary`.
- `Repair Obsidian Excalidraw files` command for importer-converted generated sections.
- Native `.excalidraw` regression remains green.

Verified with real Hibi Electron:

- Opened the real `OS Architecture Overview.excalidraw.md`.
- Edited a rectangle and text, saved, and confirmed the header, wiki links, text block refs, and JSON scene were preserved.
- No console errors, CSP errors, or external requests.
- 20 unit tests pass; package and syntax checks pass.

Known limitations:

- Excalidraw undo/redo can reset after a `.excalidraw.md` save because Hibi rewrites the Markdown document; use undo before the save boundary. Native `.excalidraw` undo/redo remains verified.
- Attachment folder resolution uses `workspace.index()` basename matching and falls back to workspace-root `assets/` when ambiguous.
- The repair command skips files that are currently open.
- Compressed-mode writing is unit-tested but not exercised in the Hibi smoke test.
- Full Markdown rendering inside canvas text, Obsidian plugin settings, Mermaid/LaTeX/PDF custom elements, and perfect round-trip of every legacy feature remain out of scope.

### Hibi 0.2.1 verification

Built the Hibi `v0.2.1` tag from source and reran both Hibi Electron smokes against it:

- Native `.excalidraw`: open, draw, save, undo, redo, text, font, preview, reopen — all pass.
- Obsidian `.excalidraw.md`: open real vault file, edit rectangle and text, save — header, wiki links, block refs, and scene JSON preserved; no console/CSP errors or external requests.
- Confirmed `ADDON_API_VERSION = 2` in v0.2.1 and verified every API used (`views`, `documents`, `workspace.readBinary/createBinary/updateText/index`, `editor.updateMarkdown`, `patches`, `openDocumentLink`).

### Follow-up fixes after real-vault testing

- Text elements from older Obsidian scenes are no longer overwritten with unwrapped Markdown text. The editor preserves existing wrapped text when the content matches.
- Bound text is laid out against its container width with the current font metrics, then re-laid out after the bundled Virgil/Excalifont faces load. This fixes the clipped `.excalidraw` text blocks seen in Hibi.
- Each drawing now opens its own pinned, named `Excalidraw · <filename>` tab instead of one follow tab. Selecting a source tab hides that drawing's editor tab; selecting the named tab returns to the same drawing. This fixes multi-drawing tab mix-ups.
- The pinned editor reads the latest document source by `tabId` so it stays current after source edits and hidden-tab remounts.

Verified against the Hibi `v0.2.1` build with two `.excalidraw.md` files open:

- Separate named editor tabs.
- Source switching hides the editor tab without losing the document.
- Returning to each named tab shows the correct drawing.
- Text blocks reflow and fit their containers; no clipping in the tested vault file.
- Native `.excalidraw`, Obsidian open/edit/save, undo/redo (native), fonts, and preview all remain green.

## Build/DX refactor: pnpm workspace + Vite

Goal: make `packages/<id>/` the source package and `addons/<id>/` the committed installable bundle, with Vite as the build tool and pnpm deduping shared tooling. Keep the current Excalidraw behavior and generated package committed.

### Target layout

```text
package.json                         workspace scripts
pnpm-workspace.yaml                  packages/*
packages/excalidraw/
  package.json                       private workspace package
  vite.config.mjs
  src/                               moved from src/excalidraw
  test/                              optional; root tests may remain
addons/excalidraw/                   installable generated package
  hibi-addon.json
  README.md, LICENSE.txt, THIRD-PARTY.txt
  index.js, editor.js, chunks/, fonts/, CSS
scripts/check.mjs                    repository package check
build/                               shared Vite addon plugin/CSS/limit helpers
test/                                cross-cutting repository tests
```

- Source never lives inside `addons/<id>/`; Hibi installs every allowed file in the package folder and may reject unsupported source extensions.
- Keep `addons/excalidraw/hibi-addon.json`, README, and licenses authored, not generated.
- The package name can be private, e.g. `hibi-addon-excalidraw`; the manifest ID stays `excalidraw`.

### Workspace

- `pnpm-workspace.yaml`: add `packages: ['packages/*']`; keep `allowBuilds: { esbuild: true }`.
- `packages/excalidraw/package.json`:
  - `private: true`, `type: "module"`.
  - `dependencies`: `@excalidraw/excalidraw@0.18.1`, `lz-string`.
  - `devDependencies`: `vite`, `postcss`.
  - `scripts`: `build: "vite build"`, `dev: "vite build --watch"`.
- Root `package.json`:
  - Remove `@excalidraw/excalidraw`, `esbuild`, and `lz-string` from root devDependencies; move to the package.
  - Keep `vite`/`postcss` in the package; root only orchestrates.
  - Scripts:
    - `build`: build all workspace packages (`pnpm -r --if-present build`).
    - `build:excalidraw`: `pnpm --filter hibi-addon-excalidraw build`.
    - `dev:excalidraw`: `pnpm --filter hibi-addon-excalidraw dev`.
    - `check`: existing `node scripts/check.mjs`.
    - `test`: existing `node --test`.
- Update lockfile with `pnpm install`; do not commit `node_modules`.

### Vite build

Two entries: `src/index.js` (addon factory, small) and `src/editor.jsx` (lazy Excalidraw editor). Do not statically import the editor or Excalidraw from the addon entry.

`packages/excalidraw/vite.config.mjs`:

- `root` = package directory.
- `base: './'`.
- `build.outDir` = `../../addons/excalidraw`.
- `build.emptyOutDir: false`; the plugin removes only generated files.
- `build.copyPublicDir: false`.
- `build.sourcemap: false`, `build.minify: 'esbuild'`, `build.target: 'es2022'`.
- `build.modulePreload: false`.
- `build.assetsInlineLimit: 0`.
- `build.rollupOptions.preserveEntrySignatures: 'strict'`.
- `build.rollupOptions.input`: absolute paths to `index.js` and `editor.jsx`.
- `build.rollupOptions.output`:
  - `entryFileNames: '[name].js'`
  - `chunkFileNames: 'chunks/[name]-[hash].js'`
  - `assetFileNames: 'assets/[name]-[hash][extname]'`
- `define: { 'process.env.NODE_ENV': '"production"' }`.
- `esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' }`.
- Resolve React/ReactDOM through the existing host shims:
  - `react` -> `src/shims/react.js`
  - `react/jsx-runtime` and `react/jsx-dev-runtime` -> `src/shims/jsx-runtime.js`
  - `react-dom` -> `src/shims/react-dom.js`
  - `react-dom/client` -> `src/shims/react-dom-client.js`
  - Use a Vite `resolveId` plugin for exact/subpath matching, equivalent to the current esbuild alias plugin.
- Verify the built entry does not import the shim chunk before `start()` sets `globalThis.__hibiExcalidrawReact`.

### Shared build plugin

Add `build/vite-addon.mjs` exporting a `hibiAddon` plugin/config helper used by Excalidraw and future addons:

- Cleanup on `buildStart`:
  - Remove `index.js`, `editor.js`, `chunks/`, `assets/`, `fonts/`, `excalidraw.css`, `host.css`.
  - Preserve manifest, README, licenses, and third-party notices.
- On `closeBundle`:
  - Copy `@excalidraw/excalidraw/dist/prod/fonts` to `addons/excalidraw/fonts` preserving `fonts/<family>/<file>` names.
  - Read `@excalidraw/excalidraw/dist/prod/index.css`, apply the existing PostCSS scoping/keyframe transform, write `excalidraw.css`.
  - Copy `src/host.css` to `host.css`.
  - Enforce Hibi limits: 1,000 entries, 25 MiB total, 5 MiB/file, 64 KiB manifest.
  - Reject unsupported output extensions (`.map`, `.wasm`, `.html`, etc.) and fail with the offending path.
- Move the CSS scoping code and package-limit checker out of `scripts/build-excalidraw.mjs` into shared build modules.
- Do not let Vite process/hash Excalidraw CSS or fonts; fixed names and unhashed font paths are required by the manifest and `EXCALIDRAW_ASSET_PATH`.

### Migration tasks

1. Create `packages/excalidraw/` and move `src/excalidraw/*` there with `git mv`; update imports in tests and config.
2. Add workspace/package manifests, lockfile, and root scripts.
3. Add the Vite config and shared plugin; keep the current esbuild build available until the spike passes.
4. Spike:
   - Build Vite output to a temporary directory or rebuild the committed package and use git to restore if needed.
   - Copy manifest/docs into the temp package and install in Hibi.
   - Verify `index.js` doesn't preload the editor/React shim, fonts resolve from the package path, chunks load, and no CSP/network errors.
   - Run native `.excalidraw`, Obsidian `.excalidraw.md`, and two-file tab/source smokes against Hibi v0.2.1 and the nightly build.
5. Replace `addons/excalidraw` generated files with the Vite output; remove `scripts/build-excalidraw.mjs` and esbuild-specific deps once green.
6. Update `README.md` and `addons/excalidraw/README.md`:
   - Source lives in `packages/excalidraw/src`.
   - `pnpm build` / `pnpm build:excalidraw`; `pnpm dev:excalidraw` watch rebuilds.
   - Vite watch does not hot-reload Hibi; after a rebuild, reinstall/reload the addon in Hibi.
7. Update tests:
   - Source tests import `../packages/excalidraw/src/...` (or move to `packages/excalidraw/test`).
   - Built-entry tests continue importing `addons/excalidraw/index.js`.
   - Keep `test/repository.test.mjs` package validation.

### Validation

- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm check`
- `pnpm test`
- Verify output has only Hibi-supported extensions, no source maps/wasm/html, and stays within package limits.
- Hibi v0.2.1 and nightly smokes:
  - Native `.excalidraw`: open, draw, save, undo/redo, text, fonts, preview.
  - Obsidian `.excalidraw.md`: open real vault file, edit/save, preserve header/wiki links/block refs.
  - Multi-file named tabs and source switching.
  - No external network requests or CSP errors.
- Confirm a clean rebuild is reproducible and `git diff` contains only expected generated files.

### Risks / fallback

- Vite/Rollup may emit or externalize workers/wasm/assets that Hibi rejects. If so, configure Vite to inline or omit the offending path, or retain the esbuild bundle temporarily.
- Vite must not bundle a second React or let the addon entry evaluate the host-React shim before `start()`.
- Font path/name rewriting and CSS scoping must stay exact; do not rely on Vite CSS asset hashing.
- `emptyOutDir: false` and cleanup must never delete authored manifest/README/license files.
- If Vite cannot produce a Hibi-compatible package after the spike, keep the workspace layout and revert the Excalidraw build script to esbuild; document the blocker rather than shipping a broken bundle.

### Out of scope

- HMR in Hibi; watch builds still require reinstall/reload.
- TypeScript conversion of the addon source.
- CI publishing/signing or new addon implementations.
- The Hibi nightly `.editor-page`/status-bar collapse bug; file separately.

### Build/DX implementation status

Implemented:

- `packages/excalidraw/` workspace package with `src/`, `test/`, `vite.config.mjs`, and package-local `@excalidraw/excalidraw`/`lz-string`/Vite dependencies.
- `addons/excalidraw/` remains the committed installable bundle; authored manifest/README/licenses are preserved.
- Root `pnpm-workspace.yaml` includes `packages/*`; root scripts provide `build`, `build:excalidraw`, `dev:excalidraw`, `check`, and `test`.
- Shared `build/vite-addon.mjs` provides React-host shims, generated-file cleanup, optional CSS scoping, optional font copying, and package-size/type checks after a successful Vite write. Excalidraw passes its prefix/font/CSS options; future addons can reuse the helper without Excalidraw-specific paths.
- Two-entry ESM Vite output: `index.js`, lazy `editor.js`, chunks, fonts, and fixed CSS names.
- `EXCALIDRAW_ASSET_PATH` is derived from `import.meta.url` without Vite rewriting it as an asset.
- Tests moved into the package; the built-entry registration test still covers `addons/excalidraw/index.js`.
- READMEs updated for the workspace/source layout and Vite commands.

Verified:

- `pnpm build` produces 368 entries, 20.0 MiB total, largest 1778 KiB.
- `npm test` passes 17 package tests + 4 repository tests.
- `npm run check` passes.
- Native `.excalidraw`, Obsidian `.excalidraw.md`, and multi-drawing named-tab/source-switching smokes pass against Hibi v0.2.1 with the Vite bundle.
- Native and Obsidian smokes pass on the local Hibi build; fonts load locally and no external requests/CSP errors occur.

Known build notes:

- A failed Vite build removes the previous generated bundle at `buildStart`; committed output can be restored from git. A future improvement is to build to a temporary directory and sync only on success.
- Vite still resolves peer React 18 inside `@excalidraw/excalidraw`'s package, but the bundle aliases all React imports to Hibi's host shims and does not ship it.
- Vite watch rebuilds the package but Hibi still needs reinstall/reload for changes to appear.
