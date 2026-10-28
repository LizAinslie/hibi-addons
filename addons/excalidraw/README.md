# Excalidraw

Edit Excalidraw drawings as Hibi documents. Both formats are supported:

- `.excalidraw`: standalone Excalidraw JSON.
- `.excalidraw.md`: the Obsidian Excalidraw Markdown format. This is the recommended format for drawings that should link to notes, participate in Hibi's graph, or stay usable in Obsidian.

The drawing stays in the file. Hibi is the only storage layer.

## Install

This package is unsigned. Turn on **Allow unsigned addons** under **Settings → Addon Manager → Security**, then:

1. Run **Install addon…** from Hibi's command palette.
2. Select this folder or its ZIP.
3. Review the extension and install it. Hibi installs addons turned off.
4. Enable **Excalidraw** in **Settings → Addons**.

Hibi asks for confirmation because the package is unsigned. After changing the package, install it again; Hibi replaces the installed copy after you confirm.

## Use

- Open an `.excalidraw` or `.excalidraw.md` file. Hibi opens a named **Excalidraw · filename** tab for that drawing automatically. Each open drawing gets its own editor tab.
- Draw in the Excalidraw tab. Changes are written back to the document and saved through Hibi's document API. **Save** also saves the active drawing.
- For `.excalidraw.md`, Hibi keeps the YAML header, Obsidian text elements, element links, and embedded-file sections in sync with the drawing. Both uncompressed and LZString `compressed-json` blocks are supported. Text in older scenes is re-wrapped and re-measured after the bundled handwriting fonts load so it fits its containers.
- `[[note]]` links on canvas elements open through Hibi's wiki-link handling. The text elements section also keeps those links indexable by Hibi's graph.
- Close the editor tab or switch the document to **Source** to inspect or edit the Markdown/JSON. Selecting the document/source tab hides its named Excalidraw editor tab; click the named Excalidraw tab to return to the canvas. The Markdown tab still renders the Obsidian sections.
- Run **New Excalidraw drawing** to create `Untitled.excalidraw.md`.
- Run **New standalone Excalidraw JSON file** to create `Untitled.excalidraw`.
- Run **Open Excalidraw editor** to reopen the editor after closing its tab.
- Run **Repair Obsidian Excalidraw files** after importing a vault if the Obsidian importer converted wiki links in the generated sections. It regenerates the text and element-link sections from the drawing JSON.

New images from the canvas are written to an `assets/` folder next to the drawing and referenced from `# Embedded Files`, following Hibi's attachment convention. Existing Obsidian attachments are loaded when they can be resolved from the workspace.

## Limits

- Hibi documents are limited to 2 MiB of UTF-8 source. For `.excalidraw.md`, the limit includes the Markdown header and generated sections. Image-heavy drawings should use the compressed drawing block or external attachments.
- Excalidraw collaboration, cloud features, remote libraries, and network access are disabled. Fonts are bundled.
- Export and file-loading actions are disabled in this version.
- Undo/redo is bridged to the canvas. Because `.excalidraw.md` source updates can rewrite the Markdown document, Excalidraw's undo history may reset after an autosave; avoid relying on undo across a save boundary in Obsidian-format files.

## Compatibility

- Hibi 0.2.1 with addon API version 2.
- Excalidraw 0.18.1.
- Obsidian Excalidraw `parsed` files from 2.0.7 and newer. Legacy `# Text Elements` / `# Drawing` and current `## Text Elements` / `## Drawing` heading levels are read; existing structure is preserved when writing.
- The editor uses Hibi's React instance. The package does not ship a second React.

## Development

The installed package lives in `addons/excalidraw/`. Source lives in `packages/excalidraw/src/`. Edit the source, then regenerate the package:

```sh
pnpm install
pnpm build:excalidraw
pnpm run check
pnpm test
```

`pnpm build:excalidraw` runs Vite and enforces Hibi's package limits. `pnpm dev:excalidraw` rebuilds on change. Vite watch does not hot-reload Hibi; reinstall or reload the addon in Hibi after a rebuild. Do not edit the generated `index.js`, `editor.js`, `chunks/`, `fonts/`, `excalidraw.css`, or `host.css` by hand; edit `packages/excalidraw/src/` instead.

## License

This addon is available under the [MIT License](LICENSE.txt). Excalidraw is MIT licensed. The bundled fonts are distributed under the SIL Open Font License. Excalidraw's runtime dependencies remain under their upstream licenses. See [THIRD-PARTY.txt](THIRD-PARTY.txt) and the license list shown in Hibi.
