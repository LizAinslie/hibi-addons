# Excalidraw document format + editor tab

## Goal

Add an installable Hibi addon that recognizes `.excalidraw` files as Hibi documents. The document source is standard Excalidraw JSON stored by Hibi. A full-size addon tab hosts the real Excalidraw editor and reads/writes the document through Hibi's `context.documents` API.

## Constraints and decisions

- Hibi's documented document-format API only permits a **read-only preview**. Custom formats cannot own the editable normal pane. Do not make `Preview` rewrite source.
- The editable canvas is a `context.views.register({ location: 'tab' })` view, opened automatically when a `.excalidraw` file is opened.
- Hibi is the only storage. Do not keep scene JSON in addon storage.
- Target Hibi API v2, installed extension package, `capabilities: ["ui"]`.
- Package everything needed at install time. Hibi does not run builds or install dependencies.
- Reference checkout: `/mnt/dev/repos/github.com/schmayterling/hibi` (`src/addons/api.ts`, `docs/ai-agents/development/document-formats.md`, `docs/ai-agents/development/addons/settings-and-sidebar-views.md`). Do not modify it.
- `.excalidraw` files remain readable in source view when the addon is disabled.

## Architecture

### Document format

Register from `start(context)`:

```js
context.editor.registerDocumentFormat({
  id: 'excalidraw',
  name: 'Excalidraw',
  extensions: ['excalidraw'],
  views: ['side-by-side', 'markdown'],
  Preview, // read-only SVG/card + "Edit drawing" button
  render,  // optional async SVG for documentation export
})
```

- `editing` is omitted; this is not Markdown.
- `codeLanguage: 'json'` only if the host resolves JSON highlighting; otherwise omit.
- `Preview` reads `value` and never calls an edit API.
- `Preview` may open the editor tab through the captured `context.views` registration.

### Editor tab

Register:

```js
context.views.register({
  id: 'canvas',
  label: 'Excalidraw',
  location: 'tab',
  lifetime: 'visible',
  Content: EditorView,
})
```

- Open with `binding: 'follow'` so it follows the active document.
- Auto-open only when a `.excalidraw` document **opens**, not every time it gains focus:
  - On start, `context.documents.listOpen()` and open if the active document is `.excalidraw`.
  - Subscribe to `context.documents.subscribe`; open for `kind: 'opened'` with a `.excalidraw` name.
  - The Preview button and a command always open/focus it.
- Do not auto-open on ordinary document focus changes; users must still be able to view the source/split tab.
- `lifetime: 'visible'` ensures the canvas unmounts and flushes when hidden. Reload from source on return.

### Source synchronization

Canonical flow:

1. Load: `document.markdown` -> `JSON.parse` -> validate -> Excalidraw `restore` -> `initialData`.
2. Edit: Excalidraw `onChange(elements, appState, files)` -> debounce about 400 ms -> `serializeAsJSON(elements, appState, files, 'local')`.
3. Persist:
   - Find target with `context.documents.listOpen()` matching `document.tabId`.
   - `readSource(target)` for the latest `VersionedDocumentTarget` and exact `source`.
   - Apply one full/partial replacement with `context.documents.applyEdits`.
   - Use a fresh `crypto.randomUUID()` request ID per attempt.
4. Echo handling: store the serialized JSON as `lastSyncedSource`; ignore the resulting `document.markdown` prop when it equals that value.
5. External change: if `document.markdown !== lastSyncedSource`, parse and call `api.updateScene(...)` (or remount after a document switch). Never overwrite silently.
6. Flush pending edits:
   - On component unmount/visibility loss.
   - Before Hibi `save`, `saveAs`, and `close-tab` via `context.patches.before(context.app, 'runAction', ...)`.
   - On addon `stop()`.
   - Apply synchronously and report failures; do not drop canvas changes silently.

Use a minimal replacement (common prefix/suffix of old/new JSON) instead of always replacing the entire source. Keep `expectedText` exact and avoid splitting surrogate pairs.

Hibi's Save action does not target the bound document while a full-size addon tab is active. Persist through `context.documents.save()`:
- Debounced auto-save after an applied edit.
- Immediate save on unmount/stop and when Hibi's Save command runs.
- Intercept `runAction('save')` while an Excalidraw session is mounted so Hibi saves the drawing, not an unrelated draft.

Keep Hibi's dirty state / autosave semantics otherwise. Do not call `documents.save()` from `Preview`.

### Undo/redo

Hibi intercepts Ctrl/Cmd+Z before the renderer and calls `document.execCommand`. Excalidraw would otherwise never see undo/redo.

- Patch `Document.prototype.execCommand` with `context.patches.instead`.
- Only intercept `undo`/`redo` when `document.activeElement` is inside a registered Excalidraw container.
- Dispatch a synthetic `keydown` on the active element inside the Excalidraw container:
  - undo: `z` with Ctrl (or Cmd on macOS)
  - redo: `z` with Ctrl/Cmd + Shift
- Return without calling `next` when dispatched; otherwise call `next`.
- Remove the patch on `stop()`.
- Verify source-pane and text-editing undo are unchanged.

### New drawing command

- Command `new-drawing`: requires an open workspace.
- Build `WorkspaceTarget` from `context.workspace.get()`.
- Try `Untitled.excalidraw`, `Untitled 2.excalidraw`, etc. with `context.workspace.createText`.
- Write a standard blank scene (`type`, `version: 2`, `elements: []`, `appState`, `files: {}`).
- `context.workspace.openFile(path)`; the `opened` event auto-opens the editor tab.
- If no workspace is open, notify the user to open one.

### Commands

- `open-editor`: open/focus the Excalidraw tab for the active `.excalidraw` document.
- `new-drawing`: create and open a drawing in the current workspace.
- Optionally `copy-drawing-json` for recovery, using `navigator.clipboard.writeText` if available.

### Preview and export

- `Preview`: parse and render a static SVG with Excalidraw's `exportToSvg` in a lazily imported module; debounce source changes. Fall back to a card with element/file counts and an "Edit drawing" button if export fails.
- Never write source from `Preview`.
- `render(source, documentId?)`: use the same SVG helper for documentation export. Hibi sanitizes the HTML. If fonts/workers fail under CSP, return a safe summary and mark SVG export as a follow-up.

### Excalidraw UI policy

- Theme follows `context.colorschemes.getActive().appearance`; subscribe to changes.
- Disable collaboration, AI, and all network-dependent features. Hibi blocks arbitrary network.
- `UIOptions`: disable `loadScene` and `saveToActiveFile`; decide on local export after the spike. Keep only features that work fully offline under Hibi's CSP.
- Hide or trim the main menu if it exposes external links or unsupported actions.
- Do not implement Excalidraw libraries from the network.

## Bundling and packaging

### Source layout (not installed)

```text
src/excalidraw/
  index.js            addon factory, manifest wiring, format, view, commands, preview
  editor.jsx          Excalidraw editor tab
  scene.js            pure parse/serialize/validate/minimal-edit helpers
  preview.jsx         read-only preview component
  render.js           lazy exportToSvg helper
  shims/react.js      host React named exports
  shims/jsx-runtime.js
  shims/react-dom.js  createPortal + best-effort flushSync
  styles/host.css
scripts/build-excalidraw.mjs
scripts/check-excalidraw-package.mjs
```

### Build

- Add dev dependencies: `@excalidraw/excalidraw@0.18.1`, `esbuild`, `postcss`, `postcss-prefix-selector`.
- Build output into `addons/excalidraw/`:
  - `index.js`: small entry, no Excalidraw import at startup.
  - `view.js` + chunks: lazily imported Excalidraw bundle.
  - `excalidraw.css`: copied `dist/prod/index.css`, prefixed/scoped, plus host styles.
  - `fonts/`: copied `dist/prod/fonts` preserving paths.
- Alias `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, and `react-dom/client` to local shims with an esbuild plugin resolving absolute paths.
- `start(context)` sets, before any dynamic import:
  - `globalThis.__hibiExcalidrawReact = React` from the SDK factory.
  - `window.EXCALIDRAW_ASSET_PATH = new URL('./', import.meta.url).href`.
- Shims read the global at module evaluation. Never bundle a second React.
- React shim exports every React 19 name Excalidraw imports; add missing names from build errors.
- ReactDOM shim: implement `createPortal` with the standard `Symbol.for('react.portal')` object; `flushSync = fn => fn()` is acceptable initially. If it breaks, bundle ReactDOM 19.3.1 with `react` still aliased to the host shim, never a second React.
- Scope CSS to `.hibi-excalidraw-root` with PostCSS:
  - Prefix all selectors, including global `:root`, `body`, and `@font-face` exclusions.
  - Rewrite `:root[dir=ltr]/[dir=rtl]` to `.hibi-excalidraw-root[dir=...]`.
  - Prefix `@keyframes` names and animation references to avoid Hibi collisions.
  - Portal targets must be inside the scoped root; the ReactDOM shim may redirect `document.body` portals to a host element inside the root.
- Set `langCode="en"` and bundle required locale chunks, or hide the language menu.
- Package manifest `styles` lists the compiled CSS files so relative font URLs resolve against the package path.

### Manifest

Create `addons/excalidraw/hibi-addon.json`:

```json
{
  "id": "excalidraw",
  "name": "Excalidraw",
  "description": "Edit Excalidraw drawings as Hibi documents.",
  "version": "0.1.0",
  "apiVersion": 2,
  "kind": "extension",
  "capabilities": ["ui"],
  "fileExtensions": ["excalidraw"],
  "entry": "index.js",
  "styles": ["excalidraw.css", "host.css"],
  "commands": [
    { "id": "open-editor", "label": "Open Excalidraw editor" },
    { "id": "new-drawing", "label": "New Excalidraw drawing" }
  ],
  "authors": [{ "displayName": "Liz Ainslie" }],
  "licenses": []
}
```

- Verify `excalidraw` is not a reserved built-in ID; otherwise use `excalidraw-drawing`.
- Add Excalidraw MIT and font notices to `licenses` and `THIRD-PARTY.txt`.
- Add `README.md` and `LICENSE.txt` in the package.
- No `activation`, because the format must be registered when the addon is enabled.
- No `network` declarations.

### Size limits

Hibi limits: 1,000 entries, 25 MiB total, 5 MiB per file, 64 KiB manifest.

- Expected: ~12 MB fonts, ~3–4 MB JS, <1 MB CSS.
- Build script must fail if limits are exceeded.
- If `view.js` exceeds 5 MiB, split more chunks; do not silently truncate fonts without updating licenses/docs.

## Implementation tasks

1. **Spike the editor rendering**
   - Add build scripts and minimal manifest/package.
   - Bundle Excalidraw with the React/ReactDOM/JSX shims.
   - Register a `.excalidraw` format and an addon tab that renders a blank `<Excalidraw>`.
   - Verify in Hibi: no CSP errors, no network requests, local fonts, drawing works, React 19 hooks work, package size limits pass.
   - If the host-React shim or CSP makes this impossible, stop and report before building the rest.

2. **Harden the bundle**
   - Scope CSS; verify dialogs, color pickers, menus, and portals are styled and do not leak into Hibi.
   - Confirm `EXCALIDRAW_ASSET_PATH` loads all fonts from the package.
   - Decide export visibility based on what works offline.

3. **Document I/O**
   - Implement `scene.js`: robust parse/validate, blank document, minimal diff, invalid/unsupported errors.
   - Load with `restore`; serialize with `serializeAsJSON`.
   - Implement debounced `applyEdits`, target lookup, echo suppression, external-change handling, flush on unmount/save/stop.
   - Verify panning/zooming does not dirty the document; strip transient appState fields if it does.

4. **Format, view, commands**
   - Register format with source + side-by-side view and read-only preview.
   - Register follow tab and auto-open on `opened` events.
   - Add Preview "Edit drawing" button and commands.
   - Add new-drawing command.

5. **Undo/redo**
   - Patch `Document.prototype.execCommand`; test undo/redo, text editing, and source-pane undo.
   - Flush before save/close via `runAction` patch.

6. **Preview/export**
   - Lazy static SVG preview with fallback card.
   - Optional `render` for documentation export; fallback if unsupported.

7. **Tests and docs**
   - Unit tests for parse/validate, blank document, minimal diff, surrogate safety, size boundary, extension detection.
   - `npm run check`, `npm test`, build size/file-count check, `node --check` all output JS.
   - README: install/enable, auto-open behavior, source/split preview, Hibi storage, 2 MiB document limit, offline/no collaboration, why editing is a companion tab, licenses.
   - Manual Hibi validation.

## Failure handling

- Invalid JSON or unsupported shape: show an error panel in the tab; do not write; keep source accessible.
- `applyEdits` returns `stale`/`conflict`: stop overwriting, show "changed elsewhere", reload from source after user confirmation.
- `applyEdits` returns `invalid` for size: persistent banner, keep the canvas alive, offer retry/export/copy; never silently discard.
- `busy`/`composing`: retry with backoff; do not drop the pending scene.
- Target closed: flush fails; notify and keep the tab usable/readable.
- Preview export failure: fallback card, no source writes.
- Undo patch must not intercept text inputs or source editors.
- Document switch while pending: flush old document before loading the new one.

## Validation

Automated:

- `npm run build:excalidraw`
- `npm run check`
- `npm test`
- package limit check and all-output `node --check`

Manual in Hibi:

1. Install unsigned package, enable, open a `.excalidraw` file: editor tab opens automatically.
2. Draw rectangles, arrows, text, freedraw, and a small image; undo/redo; save; close/reopen.
3. Switch to source and back; edit valid JSON whitespace; editor reflects it.
4. Open invalid JSON: error shown, source unchanged.
5. Switch tabs, hide/show, theme light/dark, split view; no network/CSP errors.
6. Confirm fonts render offline and CSS does not alter Hibi chrome.
7. Create a new drawing from the command; file appears in the workspace.
8. Push source over 2 MiB: banner appears and no silent loss.
9. Disable addon: `.excalidraw` files remain readable as source.
10. Install from a ZIP/folder and verify package limits.

## Out of scope

- An editable normal-pane preview. Blocked by Hibi's preview contract; user will discuss with May. This also blocks equivalent DOCX/ODT editor-pane addons.
- Externalized images or documents over Hibi's 2 MiB source limit.
- Collaboration, Excalidraw+ cloud, network libraries, AI features.
- Native addon windows (installed packages cannot register them).
- Full-fidelity site export with custom fonts; follow-up if the SVG path works.
- Multiple simultaneous Excalidraw editor instances.

## Implementation verification

Verified on 2026-10-26 against the local Hibi checkout with an installed unsigned package:

- Format recognition and auto-open of the Excalidraw tab.
- Rectangle + text drawing, auto-save, Hibi Save, undo, redo.
- Source contains standard Excalidraw JSON with elements, text, appState, and files.
- Side-by-side preview renders the read-only card; "Edit drawing" reopens the tab.
- Excalifont loads locally; zero external requests and zero console/CSP errors.
- Package: 421 entries, 20.5 MiB total, largest file 1.78 MiB.
- `npm test`, `npm run check`, and `node --check` on all bundled JS pass.

Implementation notes:
- The Excalidraw font fallback URL is filtered through a temporary `FontFace` proxy so the browser never requests the esm.sh fallback under Hibi's CSP.
- Hibi only loads addon styles from install records with `resources: true`; the smoke fixture set this like a real install.
- The editor saves through `documents.save()` because Hibi's active-document Save does not reliably target the followed document while the addon tab is active.
