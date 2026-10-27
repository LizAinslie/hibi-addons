# Excalidraw

Edit Excalidraw drawings as Hibi documents. Both formats are supported:

- `.excalidraw`: standalone Excalidraw JSON.
- `.excalidraw.md`: the Obsidian Excalidraw Markdown format. This is the recommended format for drawings that should link to notes, participate in Hibi's graph, or stay usable in Obsidian.

The drawing stays in the file. Hibi is the only storage layer.

## Install

Install the folder or ZIP, then enable **Excalidraw** in **Settings → Addons**. Hibi asks for confirmation because the package is unsigned.

## Use

- Open an `.excalidraw` or `.excalidraw.md` file. Hibi opens a full-size **Excalidraw** tab automatically.
- Draw in the Excalidraw tab. Changes are written back to the document and saved through Hibi's document API. **Save** also saves the active drawing.
- For `.excalidraw.md`, Hibi keeps the YAML header, Obsidian text elements, element links, and embedded-file sections in sync with the drawing. Both uncompressed and LZString `compressed-json` blocks are supported.
- `[[note]]` links on canvas elements open through Hibi's wiki-link handling. The text elements section also keeps those links indexable by Hibi's graph.
- Close the editor tab and switch the document to **Source** to inspect or edit the Markdown/JSON. The Markdown tab still renders the Obsidian sections; the Excalidraw tab is the drawing editor.
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

```sh
pnpm install
pnpm run build:excalidraw
pnpm run check
pnpm test
```

`pnpm run build:excalidraw` regenerates the installed files under `addons/excalidraw/` and enforces Hibi's package limits. Source lives in `src/excalidraw/`.

## Licenses

Excalidraw is MIT licensed. The bundled fonts are distributed under the SIL Open Font License. Excalidraw's runtime dependencies remain under their upstream licenses. See `THIRD-PARTY.txt` and the license list shown in Hibi.
