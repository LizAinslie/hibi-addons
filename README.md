# Mey's Hibi addons

This repository contains my addon packages for Hibi. Each package has its own README, license, and build notes.

## Addons

- [Excalidraw](addons/excalidraw/README.md) - edit `.excalidraw` files and Obsidian `.excalidraw.md` drawings as Hibi documents.

## Development

You need Node.js 22.18 or later to run the checks. Run these commands from the repository folder:

```sh
pnpm install
pnpm build
pnpm run check
pnpm test
```

`pnpm build` builds every workspace package into its `addons/<id>/` package. `pnpm run check` finds every package the way Hibi does and reports common mistakes, such as a missing readme, a missing entry file, or a file type that Hibi will not install. `pnpm test` runs the workspace tests. Run an addon's documented build before committing generated assets. For the Excalidraw package, `pnpm dev:excalidraw` rebuilds on change; Hibi still needs the addon reinstalled or reloaded. Hibi's installer has the final say, so also install your package in Hibi before you share it.

## Try it in Hibi

Packages from this repository are unsigned. Before you install one, turn on **Allow unsigned addons** under **Settings → Addon Manager → Security**.

1. Run **Install addon…** from Hibi's command palette.
2. Select this repository's folder, or the addon's folder under `addons/`.
3. Review the extension and install it. Hibi installs addons turned off.
4. Enable the addon in **Settings → Addons**.
5. Open a file it supports. See the addon's README for its commands and usage.

After you change a package, install it again. Hibi replaces the installed copy after you confirm.

## Add another addon

Source packages live under `packages/<id>/`; their installable output lives under `addons/<id>/`. Add each package and update its `hibi-addon.json`:

- `id` must be unique. Use up to 48 lowercase letters, numbers, and hyphens, starting with a letter. Hibi refuses IDs that belong to its built-in addons.
- Change `name`, `description`, and `authors` to describe your addon.
- Increase `version` whenever you share a new release.

Then edit the package's `README.md`. Hibi shows it as the addon's documentation, so write it for the people who will use the addon. Keep package-specific installation, build, and usage details there. Add the source package to `packages/<id>/` and configure its `vite.config.mjs` with the shared `build/vite-addon.mjs` helper.

Do not put a `hibi-addon.json` at the repository root next to packages in subfolders, because Hibi will refuse packages whose folders overlap. If your repository holds one package, you can move its files to the root instead.

### Extensions

`index.js` exports a function that returns `start` and `stop`. Hibi calls `start` with a context when the addon turns on, and `stop` when it turns off. Undo everything `start` registered in `stop`.

The manifest controls when the extension loads and which parts of Hibi it can use. Keep command IDs in `hibi-addon.json` and `index.js` the same. The entry file must be JavaScript (`.js` or `.mjs`). If you prefer TypeScript or a bundler, compile to JavaScript and commit the output.

See [adding functionality](https://docs.hibi.garden/#page=development%2Faddons%2Fadding-functionality.md), [storage](https://docs.hibi.garden/#page=development%2Faddons%2Fstorage.md), and the [addon API reference](https://docs.hibi.garden/#page=development%2Faddon-api-reference%2FAddonContext.md) for what extensions can do.

### Files Hibi installs

Hibi installs only these file types: `.js`, `.mjs`, `.json`, `.css`, `.md`, `.txt`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff`, `.woff2`, `.ttf`, `.mp3`, `.ogg`, and `.wav`. Each package needs `README.md` and `hibi-addon.json`. Hibi skips hidden files and `node_modules`. A file without an extension, such as `LICENSE`, stops the installation, so each package keeps its license in `LICENSE.txt`.

## Share it

Push your repository to a public HTTPS Git host such as GitHub. Anyone can then choose **Install from URL** in Hibi's Addon Manager and enter the repository URL, for example `https://github.com/you/your-addon`. Hibi lists every package it finds and lets them choose which to install.

You can also attach a ZIP file of your packages to a release and share its download link. ZIP files install the same way as repositories.

To list an addon in Hibi's addon directory, open a pull request in [hibigarden/addons-repository](https://github.com/hibigarden/addons-repository). The directory can link to your repository or release, so you do not need to copy your files there.

After a maintainer reviews and merges your listing, Hibi garden signs the listed files automatically, so you do not need a signing key. People who install from Hibi garden do not need to allow unsigned addons. Installing from your own repository URL stays unsigned and needs **Allow unsigned addons**. See [sideloading and sharing](https://docs.hibi.garden/#page=development%2Faddons%2Fsideloading.md) for signatures, package limits, and updates.

## License

The repository is available under the [MIT License](LICENSE). Each package carries its own license in `LICENSE.txt`, because Hibi installs only the package folder. See each addon's README for its third-party notices; Excalidraw's are in [addons/excalidraw/THIRD-PARTY.txt](addons/excalidraw/THIRD-PARTY.txt).
