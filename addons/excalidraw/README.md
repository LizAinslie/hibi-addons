# Excalidraw

Edit `.excalidraw` files as Hibi documents. The file remains standard Excalidraw JSON, stored by Hibi.

## Install

Install the folder or ZIP, then enable **Excalidraw** in **Settings → Addons**. Hibi asks for confirmation because the package is unsigned.

## Use

- Open an `.excalidraw` file. Hibi opens a full-size **Excalidraw** tab automatically.
- Draw in the Excalidraw tab. Changes are written back to the document source and saved through Hibi's document API. **Save** also saves the active drawing.
- Close the editor tab and switch the document to **Source** to inspect or edit the raw JSON. **Side-by-side** shows the source and a read-only preview.
- Undo and redo are bridged to the canvas.
- Run **New Excalidraw drawing** from the command palette to create `Untitled.excalidraw` in the current workspace.
- Run **Open Excalidraw editor** to reopen the editor after closing its tab.

The document tab's preview is read-only. Hibi's document-format API only supports read-only previews for custom formats, so editing happens in the companion Excalidraw tab.

## Limits

- Hibi documents are limited to 2 MiB of UTF-8 source. Excalidraw embeds images inside the JSON, so image-heavy drawings reach that limit quickly. The editor shows a warning and keeps the canvas open instead of silently discarding changes.
- Excalidraw collaboration, cloud features, remote libraries, and network access are disabled. Fonts are bundled.
- Export and file-loading actions are disabled in this version.

## Compatibility

- Hibi addon API version 2.
- Excalidraw 0.18.1.
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
