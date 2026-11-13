# Tilemaxx

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

- **Enter the board:** click/tap a square and type directly onto the board. Each letter replaces that square and advances one cell; your rack is unchanged. Right switches to Across (or advances if already Across); Down switches to Down (or advances if already Down). Left/Up move without changing direction. Tap the selected square again to toggle direction (selection is captured at touch start and keyboard focus is applied on click), or use Shift+Enter/the direction button. The small arrow marks the current direction. Space followed by a letter enters a blue, zero-point blank; Space again cancels that pending blank. A dot skips a square. Backspace clears the current tile, or moves back and clears the previous tile if the current cell is empty; Delete erases in place. Entry stops at the board edge without wrapping. Escape deselects the board. The cursor disappears when focus leaves the board or a move preview is shown; returning to a square preserves direction.
- **Entry history:** uninterrupted typing is one undo step, and uninterrupted deletion is another. Changing direction, moving the cursor manually, choosing a square or leaving the board input ends the group. Letters still save immediately; server acknowledgments do not split a group.
- **Import a screenshot:** use the image icon above the board. Choose a PNG/JPEG/WebP/HEIF/HEIC, let the app detect the board, check the overlaid grid, then choose **Read board**. If detection is uncertain or the grid needs adjustment, tap the top-left and bottom-right corners or fine-tune the crop fields. Tap and type directly on the review board, with auto-advance and a zoomed view of the selected square. Space then a letter marks a blank. **Enter manually** starts with an empty review board if recognition is unusable. **Save corrected example** explicitly saves the cropped board and its labels under `data/screenshot-examples/` for recognition tuning. **Use this board** applies the reviewed position. Import replaces the board, preserves the rack, and is undoable. Recognition runs locally with bundled Tesseract assets. Designed for straight-on Scrabble GO screenshots; decorative tile skins, low resolution and inaccurate crops can need corrections. HEIF/HEIC files use native browser decoding when available, otherwise a local libheif worker converts the primary image to PNG. Conversion can be cancelled and stops after 20 seconds; the existing 20 MB / 32-megapixel image limits still apply. Blue letters on pale Scrabble GO tiles are read as blanks and flagged for review. Rack tiles are entered separately. Compare every row with the original before using the board.
- **Existing blanks:** select their square and switch “Blank tile” on. They display zero points and retain their assigned letter.
- **Rack:** tap a rack tile and type directly into the rack. Letters replace existing tiles and advance; empty slots stay in place and can be filled independently. Space (or `?`) adds an unassigned, blue, zero-point blank. Left/Right move between slots. After selecting a slot, Backspace clears it in place; after typing or deleting, Backspace clears the previous slot and moves there. The cursor stays on the erased slot so you can retype, and neighboring tiles never shift. Delete always clears the current slot. Empty slots persist across reloads and devices and are ignored by the solver. Cmd/Ctrl+A selects the whole rack to replace or clear. Entry stops when the rack is full, including on custom boards. Enter starts the solver. Find moves searches the whole board.
- **Unseen tiles:** expand the panel below your rack to see letter counts for the bag and other players’ racks combined. Filter by vowels, consonants, high-value tiles, or remaining letters. The panel counts assigned blanks as blanks and flags entries that exceed the starting tile counts.
- **Suggestions:** Bingos have a gold trophy badge and row marker, using the selected board’s rack size and bonus. Bold green letters are new tiles; softer letters are already on the board. Newly played blanks have a light blue tile background. Desktop hover previews and clicking plays. On a phone, tap once to preview, then tap again or use Play. Filter words or sort by score, alphabet, word length, tiles used, rack leave A–Z, or blanks used. Rack leave A–Z compares the unused letters alphabetically, with higher move scores breaking ties; it is not a strategic leave valuation. An empty leave sorts first. All moves remain available in the scrolling list; only the visible rows are rendered.
- **Bingo draw %:** every move shows the chance that refilling its rack leave spells a word using only the new rack. Sort by this percentage to compare leaves. **Check bingo after your play** checks the first 20 moves in the current sort and filter for a legal bingo after the refill and before the opponent replies. The default bag count assumes a two-player game and a full opponent rack when possible. You can change the bag count for a this check under **About bingo odds**. An approximation mark indicates sampled odds.
- **Analyze:** after finding moves, select up to three for a comparison. Confirm the tiles in the bag for a two-player game. Exact bingo odds use weighted refills for small draws and otherwise use shared samples. **Bingo after opponent reply** estimates whether a legal bingo is available after the modeled reply. Switch between Strong and Casual reply estimates, preview examples, or refine the sample. The score-plus-leave sort uses a rack heuristic. If the last board edit was the opponent’s play, you can use it to weight possible racks. With the bag empty, Scrabble analysis can search a bounded optimal endgame line using the inferred rack and scoreless-turn count.
- **Continue playing:** add your new rack letters manually, then transcribe the opponent's move. This is a companion, not a full game with a bag or automated opponents.
- **Undo/redo:** restores both board and rack. Move history includes board edits and the last 100 changes. Rack text edits save immediately without adding separate history entries.
- **Switch devices:** select the same profile and game on the same server. Wait for “All changes saved” before switching. Open tabs refresh about every four seconds and when brought back to the foreground.
- **Switch games:** tap or click the game title to choose an active or archived game in your current profile. Use the pencil beside the title to rename the selected game.
- **Rename a profile:** use the pencil next to the profile picker in the sidebar (open the workspace menu on phone). The new name syncs to your other devices; game ownership and selection stay intact.
- **Conflicts:** if two devices edit the same revision, neither silently wins. Choose the server's version or preserve your local version as a separate game.
- **Board studio:** choose **New custom board**, start from a preset, choose size (5–25), paint bonuses, set the opening square, rack size (1–10), tile values, starting tile counts, and full-rack bonus. Mirroring paints both axes. Saved custom boards have an **Edit** button and a trash icon. Deletion asks for confirmation and removes the template across devices; games already using it keep their saved layout. Built-in boards cannot be edited or deleted. Template edits apply to future games. Existing games retain the layout they started with.
- **Delete:** Game options → Delete game → Delete permanently removes the game, rack and history from the server and connected devices. Confirmation is required; this cannot be undone. Profiles, dictionaries and saved board templates are retained.
- **Archive:** hide completed games and restore them later. Duplicate a game to explore alternatives. Clearing the board can be undone.
- **Theme:** light, dark, and system-following settings are saved per browser.

## Dictionaries

- **WOW24:** if installed, new games prefer the WGPO Official Words 2024 list. Download the official text file from [WGPO](https://wordgameplayers.org/wgpo-official-words/) and import it under **Word lists**, or save it as `data/dictionaries/WOW24.txt` and restart. Existing games keep their selected list.
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
5. Open **Word lists → Import word list** and select the WOW24 file from WGPO or another dictionary you use. Imported dictionaries are stored in the persistent data folder.
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
npm run benchmark   # optional local WOW24 performance check
```

Tests compare every generated placement and score against an independent exhaustive enumerator over 30 small positions; they also cover cross words, blank assignments, premiums, opening rules, bingo bonuses, undo/redo, dictionary parsing, validation, stale writes, and persistence after restart. All previous tests remain part of `npm test`. The UI suite exercises direct rack entry/replacement, Space blanks, full-rack limits, mobile deletion, focus/cursor visibility, direct board entry, arrow navigation, repeated taps/focus, mobile input/deletion events, paste/edge handling, grouped undo/redo, blanks, erase, solver/play/undo/redo, sorting/filtering, desktop and touch-style previews, multiple games, profile renaming, custom template editing, and screenshot review/correction/cancellation. UI tests use jsdom with a real solver and simulated server/worker transport; they complement browser testing rather than replacing it. The OCR fixture test runs the real recognition engine. Automatic crop tests cover portrait, landscape, smaller phone images and already-cropped boards, plus no-grid fallback; detection uses a bounded-resolution grid-edge search and may need adjustment for unusual themes or angled photos. Deletion tests cover confirmation/cancel, the last-game empty state, durable removal, stale saves and in-flight polling. A GitHub Actions workflow runs `npm run verify` on pushes and pull requests if the repository is hosted on GitHub.

Benchmark times are machine-specific and exclude network loading and UI rendering.

Searches are bounded to 2 million traversal steps, 150,000 accumulated results and a 2-second traversal budget (checked periodically). Exceeding any limit stops the search with a clear message; partial results are discarded. Changing the board, rack or dictionary terminates any active search worker. Cancel remains available. These limits apply to custom boards and blank-heavy racks as well.

The compact trie stores outgoing letters as bit masks, so search can skip letters that cannot be played. The WOW24 index uses about 4.1 MiB of typed arrays. Analysis reuses the board's compiled constraints across racks, and follow-up searches compute the best score and bingo availability without building a move list. Workers keep search off the UI thread. The optional benchmark reports warm median times for full searches and a 200-scenario comparison.

Browser drafts are written immediately to local storage; server writes are debounced by 300 ms. A dropped connection preserves drafts and retries when the server returns. This is not a fully offline-installable PWA: loading the app and a new dictionary still needs the home server. A browser storage warning means drafts could not be cached; wait for server confirmation before closing that tab.

Source map: `shared/` contains game rules and solver; `server/` contains the SQLite API; `src/` contains the React UI and worker. The server uses Node's built-in SQLite API, which may print an experimental-feature warning on older supported Node versions.

The app is now named Tilemaxx. Existing `tilewise:` browser storage keys, the `tilewise.sqlite` filename, and Docker volume/image identifiers are retained for compatibility with saved games and deployment scripts.
