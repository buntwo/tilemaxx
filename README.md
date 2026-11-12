# Tilewise

A self-hosted Scrabble companion for desktop and mobile browsers. Enter a board and rack, find every legal placement, preview a suggestion, then play it. Profiles and games live on a small SQLite server; solving runs in a browser worker.

## Run locally

Requires Node 22.13+ (Node 24 LTS recommended).

```sh
npm ci
npm run dev
```

Open [http://localhost:4173](http://localhost:4173) on the host. To use another device on the same network, open the host's LAN address on port 4173. No internet connection is needed after dependencies and word lists are installed.

For production without Docker:

```sh
npm run build
npm start
```

`PORT` defaults to `4173`, `HOST` to `0.0.0.0`, and `DATA_DIR` to `./data`. To restrict access to the host, set `HOST=127.0.0.1`. There are no accounts, passwords, analytics, or cloud services. Profiles are a convenience, not an access restriction; use this on a trusted local network, without forwarding its port to the internet.

## Everyday use

- **Enter the board:** select a square, type a word, and press Enter or Add. Press **Shift+Enter** in the word input to toggle Across/Down. Tapping the direction button while typing keeps focus in that input (including on iPhone). A dot skips one square. The entry replaces the specified cells and does not consume your rack. An empty entry field supports arrow keys to move the cursor and Backspace/Delete to erase the selected square.
- **Import a screenshot:** use the image icon above the board. Choose a PNG/JPEG/WebP/HEIF/HEIC, let the app detect the board, check the overlaid grid, then choose **Read board**. If detection is uncertain or the grid needs adjustment, tap the top-left and bottom-right corners or fine-tune the crop fields. Review the recognized board alongside the original, correct letters, and mark assigned blanks before **Use this board**. Import replaces the board, preserves the rack, and is undoable. Recognition runs locally with bundled Tesseract assets. Designed for straight-on Scrabble GO screenshots; decorative tile skins, low resolution and inaccurate crops can need corrections. HEIF/HEIC files use native browser decoding when available, otherwise a local libheif worker converts the primary image to PNG. Conversion can be cancelled and stops after 20 seconds; the existing 20 MB / 32-megapixel image limits still apply. No automatic rack or blank recognition. Tested with synthetic images; real Scrabble GO samples will help tune accuracy.
- **Existing blanks:** select their square and switch “Blank tile” on. They display zero points and retain their assigned letter.
- **Rack:** type up to seven letters (or the custom board's rack size). `?` represents a blank. Find moves searches the whole board.
- **Suggestions:** desktop hover previews and clicking plays. On a phone, tap once to preview, then tap again or use Play. Filter words or sort by score, alphabet, word length, tiles used, rack leave A–Z, or blanks used. Rack leave A–Z compares the unused letters alphabetically, with higher move scores breaking ties; it is not a strategic leave valuation. An empty leave sorts first. All moves remain available in the scrolling list; only the visible rows are rendered.
- **Continue playing:** add your new rack letters manually, then transcribe the opponent's move. This is a companion, not a full game with a bag or automated opponents.
- **Undo/redo:** restores both board and rack. Move history includes board edits and the last 100 changes. Rack text edits save immediately without adding separate history entries.
- **Switch devices:** select the same profile and game on the same server. Wait for “All changes saved” before switching. Open tabs refresh about every four seconds and when brought back to the foreground.
- **Rename a profile:** use the pencil next to the profile picker in the sidebar (open the games menu on phone). The new name syncs to your other devices; game ownership and selection stay intact.
- **Conflicts:** if two devices edit the same revision, neither silently wins. Choose the server's version or preserve your local version as a separate game.
- **Board studio:** choose **New custom board**, start from a preset, choose size (5–25), paint bonuses, set the opening square, rack size (1–10), tile values, and full-rack bonus. Mirroring paints both axes. Saved custom boards have an **Edit** button; built-in boards are read-only. Template edits apply to future games. Existing games retain the layout they started with.
- **Delete:** Game options → Delete game → Delete permanently removes the game, rack and history from the server and connected devices. Confirmation is required; this cannot be undone. Profiles, dictionaries and saved board templates are retained.
- **Archive:** hide completed games and restore them later. Duplicate a game to explore alternatives. Clearing the board can be undone.
- **Theme:** light, dark, and system-following settings are saved per browser.

## Dictionaries

- **CSW24:** import a Collins Scrabble Words 2024 text file you have permission to use under **Word lists**. It is not bundled.
- **ENABLE:** bundled open word-game list. It is not identical to the current Words With Friends lexicon.
- **Wordnik (2021):** bundled MIT-licensed English word-game list; not an official tournament list.
- **Other lists:** Word lists → Import word list accepts a `.txt` file with one word per line, including NWL or other CSW editions you provide. Blank lines, duplicates, and nonalphabetic entries are removed. Quotes are stripped and words are normalized to uppercase; a definition after whitespace is ignored. Accepted word lengths are 2–25.

Word lists are shared by profiles on this server. Each game chooses its own list. Imported files and game state persist independently of the browser. See [THIRD_PARTY.md](THIRD_PARTY.md) for sources and attribution.

## Deploy on Synology with Docker

Use Container Manager's **Project** feature; no SSH is required.

1. Copy this project to a folder on the NAS. You can omit `.git`, `node_modules`, `dist`, `dist-server`, `.local`, and `data` for a fresh deployment.
2. Open **Container Manager → Project → Create**. Name it `tilewise`, select that folder, and use the included `compose.yaml`.
3. Build and start the project. The first build needs internet access to download Node and npm dependencies.
4. Open `http://YOUR-NAS-IP:4173` from a browser on the same network. If DSM's firewall is enabled, allow this port from your local subnet.
5. Open **Word lists → Import word list** to add a supported dictionary, then select it when creating or editing a game.
6. On iPhone, use Safari's **Share → Add to Home Screen** for a shortcut.

The default Compose configuration uses the persistent Docker volume `tilewise-data` (Compose prefixes its actual name with the project name). It survives container rebuilds and ordinary project stops. Do not delete the volume when updating.

If you have a prebuilt image for your NAS architecture, import it under **Container Manager → Image → Add → Add from file**. Use `compose.prebuilt.yaml` in place of `compose.yaml`, with the image name and tag set to match the imported image.

If you prefer an ordinary NAS folder for backup, replace the volume mapping with `./data:/app/data`. Create `data/dictionaries` first and grant UID/GID `1000:1000` read/write access to that folder; the image runs as the unprivileged `node` user. Alternatively set Compose's `user` to the UID:GID of a NAS user that owns the data folder. Avoid granting broad permissions to unrelated NAS directories.

### Move saved games to another server

Stop the source server and copy its entire data directory (default: `./data`) to an empty data directory on the destination. Keep the database and word-list files together. For Docker, use the data mount described above and set its permissions before starting the destination server. Connect all devices to the destination server to keep games in sync.

### Backup and update

Stop the container before backing up its data volume/folder, including `tilewise.sqlite`, any SQLite `-wal`/`-shm` files, and `dictionaries/`. Restart afterward. Restore into an empty data volume/folder with the same permissions. For updates, replace the source and rebuild the project while keeping the volume.

Equivalent Docker commands on a machine with Docker running:

```sh
docker compose up -d --build
docker compose logs -f
docker compose down
```

Use `docker compose down` without `-v` to preserve saved data.

## Development and verification

```sh
npm run verify       # all tests, TypeScript, production build
npm run test:unit    # solver, persistence, sync and actual OCR
npm run test:ui      # repeatable React interaction workflows
npm run benchmark   # optional local CSW24 performance check
```

Tests compare every generated placement and score against an independent exhaustive enumerator over 30 small positions; they also cover cross words, blank assignments, premiums, opening rules, bingo bonuses, undo/redo, dictionary parsing, validation, stale writes, and persistence after restart. All previous tests remain part of `npm test`. The UI suite exercises word entry, direction shortcuts/focus, blanks, erase, solver/play/undo/redo, sorting/filtering, desktop and touch-style previews, multiple games, profile renaming, custom template editing, and screenshot review/correction/cancellation. UI tests use jsdom with a real solver and simulated server/worker transport; they complement browser testing rather than replacing it. The OCR fixture test runs the real recognition engine. Automatic crop tests cover portrait, landscape, smaller phone images and already-cropped boards, plus no-grid fallback; detection uses a bounded-resolution grid-edge search and may need adjustment for unusual themes or angled photos. Deletion tests cover confirmation/cancel, the last-game empty state, durable removal, stale saves and in-flight polling. A GitHub Actions workflow runs `npm run verify` on pushes and pull requests if the repository is hosted on GitHub.

Benchmark times are machine-specific and exclude network loading and UI rendering.

Searches are bounded to 2 million traversal steps, 150,000 accumulated results and a 2-second traversal budget (checked periodically). Exceeding any limit stops the search with a clear message; partial results are discarded. Changing the board, rack or dictionary terminates any active search worker. Cancel remains available. These limits apply to custom boards and blank-heavy racks as well.

The compact trie avoids hundreds of thousands of per-node objects. The current CSW24 index uses about 5.9 MiB of typed arrays. Dictionary parsing temporarily uses additional memory. A worker keeps search off the UI thread, and a virtual result list keeps large result sets scrollable.

Browser drafts are written immediately to local storage; server writes are debounced by 300 ms. A dropped connection preserves drafts and retries when the server returns. This is not a fully offline-installable PWA: loading the app and a new dictionary still needs the home server. A browser storage warning means drafts could not be cached; wait for server confirmation before closing that tab.

Source map: `shared/` contains game rules and solver; `server/` contains the SQLite API; `src/` contains the React UI and worker. The server uses Node's built-in SQLite API, which may print an experimental-feature warning on older supported Node versions.
