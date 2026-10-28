# Hibi addons

This repository contains the Excalidraw addon for Hibi 0.2.1. It makes `.excalidraw` files and Obsidian `.excalidraw.md` drawings editable Hibi documents.

To make a theme, start from the [theme starter](https://github.com/hibigarden/theme-starter) instead.

Hibi installs the files exactly as they are in this repository. It does not run build scripts or install dependencies, so every file a package needs must be committed. The Excalidraw package is built from `src/excalidraw/` into `addons/excalidraw/`.

## Development

You need Node.js 22.18 or later to run the checks. Run these commands from the repository folder:

```sh
pnpm install
pnpm run build:excalidraw
pnpm run check
pnpm test
```

`pnpm run build:excalidraw` regenerates the Excalidraw package and enforces Hibi's package limits. `pnpm run check` finds every package the way Hibi does and reports common mistakes, such as a missing readme, a missing entry file, or a file type that Hibi will not install. `pnpm test` runs the tests in `test/`. Hibi's installer has the final say, so also install your package in Hibi before you share it.

## Try it in Hibi

Packages from this repository are unsigned. Before you install one, turn on **Allow unsigned addons** under **Settings → Addon Manager → Security**.

1. Run **Install addon…** from Hibi's command palette.
2. Select this repository's folder, or the `addons/excalidraw` folder.
3. Review the extension and install it. Hibi installs addons turned off.
4. Enable **Excalidraw** in **Settings → Addons**.
5. Open an `.excalidraw` or `.excalidraw.md` file. Hibi opens a named Excalidraw editor tab for that drawing automatically.

After you change a package, install it again. Hibi replaces the installed copy after you confirm.

## Make it yours

The Excalidraw integration source lives in `src/excalidraw/`. Edit it, then run `pnpm run build:excalidraw` and commit the regenerated files under `addons/excalidraw/`. Do not edit the generated `index.js`, `editor.js`, `chunks/`, `fonts/`, `excalidraw.css`, or `host.css` by hand.

For a new package, add a folder under `addons/` and update its `hibi-addon.json`:

- `id` must be unique. Use up to 48 lowercase letters, numbers, and hyphens, starting with a letter. Hibi refuses IDs that belong to its built-in addons.
- Change `name`, `description`, and `authors` to describe your addon.
- Increase `version` whenever you share a new release.

Then edit the package's `README.md`. Hibi shows it as the addon's documentation, so write it for the people who will use the addon.

To ship more than one extension from this repository, add each one in its own folder under `addons/`. Do not put a `hibi-addon.json` at the repository root next to packages in subfolders, because Hibi will refuse packages whose folders overlap. If your repository holds one package, you can move its files to the root instead.

### Extensions

`index.js` exports a function that returns `start` and `stop`. Hibi calls `start` with a context when the addon turns on, and `stop` when it turns off. Undo everything `start` registered in `stop`, as the Excalidraw addon does with its document format, editor tab, commands, and patches.

The manifest controls when the extension loads and which parts of Hibi it can use. Excalidraw has no `activation` because it must register its document format at startup, and it lists `"capabilities": ["ui"]` because it needs React and Hibi's shared controls. New drawings are created as Obsidian-compatible `.excalidraw.md` files; a separate command creates standalone `.excalidraw` JSON. Keep command IDs in `hibi-addon.json` and `index.js` the same.

The entry file must be JavaScript (`.js` or `.mjs`). If you prefer TypeScript or a bundler, compile to JavaScript and commit the output. See [adding functionality](https://docs.hibi.garden/#page=development%2Faddons%2Fadding-functionality.md), [storage](https://docs.hibi.garden/#page=development%2Faddons%2Fstorage.md), and the [addon API reference](https://docs.hibi.garden/#page=development%2Faddon-api-reference%2FAddonContext.md) for what extensions can do.

### Files Hibi installs

Hibi installs only these file types: `.js`, `.mjs`, `.json`, `.css`, `.md`, `.txt`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff`, `.woff2`, `.ttf`, `.mp3`, `.ogg`, and `.wav`. Each package needs `README.md` and `hibi-addon.json`. Hibi skips hidden files and `node_modules`. A file without an extension, such as `LICENSE`, stops the installation, so each package keeps its license in `LICENSE.txt`.

## Share it

Push your repository to a public HTTPS Git host such as GitHub. Anyone can then choose **Install from URL** in Hibi's Addon Manager and enter the repository URL, for example `https://github.com/you/your-addon`. Hibi lists every package it finds and lets them choose which to install.

You can also attach a ZIP file of your packages to a release and share its download link. ZIP files install the same way as repositories.

To list your addon in Hibi's addon directory, open a pull request in [hibigarden/addons-repository](https://github.com/hibigarden/addons-repository). The directory can link to your repository or release, so you do not need to copy your files there.

After a maintainer reviews and merges your listing, Hibi garden signs the listed files automatically, so you do not need a signing key. People who install your addon from Hibi garden do not need to allow unsigned addons. Installing it from your own repository URL stays unsigned and needs **Allow unsigned addons**. See [sideloading and sharing](https://docs.hibi.garden/#page=development%2Faddons%2Fsideloading.md) for signatures, package limits, and updates.

## License

The addon is available under the [MIT License](LICENSE). Each package carries its own copy in `LICENSE.txt`, because Hibi installs only the package folder. Excalidraw and its bundled fonts have their own notices in `addons/excalidraw/THIRD-PARTY.txt`.
