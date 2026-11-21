# Repository instructions

## Architecture

- Keep game rules, scoring, solving, and analysis in `shared/` as TypeScript that can run without React, the DOM, or SQLite. Reuse the same rules across live play and review.
- Use `src/` for React UI, browser storage, and worker coordination. Keep `App.tsx` focused on composing views. Put feature state and asynchronous workflows in the component or hook that owns them.
- Highlight every displayed bingo and show the trophy, including both sides of endgame lines. Use the active rules and tiles placed or the recorded bingo flag.
- Use green and red for favorable and unfavorable values from the player’s perspective. Use the [UI guide](docs/ui-guide.md) for panel and control names, and update it when those names change.
- Run expensive analysis in workers with typed messages and bounded work. Keep large result sets in the worker and send summaries or pages to the UI. Ignore stale responses after the position changes.
- Keep HTTP validation and SQLite persistence in `server/`. Preserve compatibility with existing saves. Poll compact summaries, load full histories on demand, and keep unsynced drafts separate from the read cache.

## Verification

- Before every minor release, review all code changes through the release candidate since the last completed full review. Record the reviewed commit range and any outstanding findings.
- Run `npm run verify` for changes to rules, solving, persistence, UI, imports, or deployment. It runs the tests, type check, and production build, and is the GitHub CI gate.
- Keep solver, API, sync, and UI tests in the default suite. Add targeted regression coverage for behavior changes. Check changed UI interactions in an isolated browser workspace with test data.
- Preserve the 38 px height of the **Possible moves** header unless the user explicitly requests a height change. For changes that affect the header or its controls, measure it in a browser at desktop and phone widths before and after **Find moves**, including with the close button visible.

## Playing-style models

- Keep Casual, Word-List Learner, and Strong Club Player simple. Rank the moves each style spots with an additive utility and use special cases sparingly.
- Casual and Word-List Learner use static evaluation of the generated moves. Keep sampling and extra board solves out of those profiles. Strong may use bounded extra computation after cheap screening, on a shortlist of at most five candidates.
- After changing a profile, run paired self-play with shared bag shuffles and swapped opening seats. Report all three head-to-head matchups with wins, losses, ties, and final spread. Include mean and median points per placement, points per turn, available, spotted, and played bingos, passes with legal moves, exchanges, top-score choice rate, representative decisions, and separate move generation and profile timings. Keep top raw score and sampled reply-adjusted points as separate baselines.

## Development research

- Keep development research local. Save research reports, experiment notes, benchmark results, and raw self-play logs under the ignored `data/` directory when they are useful for future work. Share findings in the conversation. Keep research artifacts out of Git, release notes, and public builds.

## Git and deployment

- Bump the Tilemaxx patch version by one in `version.json` before staging each commit. Bump major or minor only when the user explicitly asks, and set the patch to `1` for either bump. Keep `package.json` and `package-lock.json` stable for app version bumps so Docker can reuse installed dependencies.
- Git commits are signed through Secretive without fingerprint approval. Run Git non-interactively and never allocate a PTY for commit or push commands. If signing unexpectedly blocks, diagnose the process instead of assuming user approval is pending.
- After verifying and committing Tilemaxx changes, push them to GitHub's `origin/main` with a fast-forward push. The NAS pulls updates from that branch.
- Regenerate the illustrated UI guide screenshots and their callout positions only when preparing a new GitHub release.
- Tilemaxx is self-hosted on a trusted local network. The manual NAS updater fast-forwards the checkout. The scheduled DSM updater follows upstream rewrites. Both rebuild with Docker Compose. Keep `compose.yaml` local and preserve the bind-mounted `data/` directory across updates. See [README.md](README.md) for setup and recovery.
- Never connect to another machine with SSH or execute commands on another machine unless the user has given explicit prior approval for that specific remote access. Deployment or validation requirements do not imply SSH approval.
- Keep imported word lists and saved games in the ignored `data/` directory. Do not put them in Git, the Docker build context, or a public deployment.

## Updating the README

1. Keep the opening to a short hook, one concrete description, and the quick links. Put walkthroughs and setup details below the main screenshot.
2. Start Tilemaxx with a temporary `DATA_DIR` and use a fictional game with a bundled word list. Switch the app to **Dark** before taking any README screenshot.
3. Open **Settings** with the gear below the sidebar theme controls. Turn off **Highlight rack tiles on move preview** and **Pulse move previews**, then find moves and preview a play on the board.
4. Replace the WebP files in `docs/screenshots/` with real captures of the desktop workspace, phone preview, and reply heatmap. Use the same sample position for all three, check their crops at README width, and update the alt text to match.

## Debugging production games

- Use the read-only HTTP debugging API to retrieve NAS games. Set `TILEMAXX_DEBUG_SERVER` to the instance origin (for example `http://NAS:4173`), or pass `--server`. Ask for the origin if it is unknown; do not guess or use SSH/scp.
- List games with `npm run debug:games -- --server http://NAS:4173`. Optional `--profile NAME_OR_ID` and `--name TEXT` filters narrow the list; archived games are included.
- Download a game with `npm run debug:game -- GAME_ID --server http://NAS:4173`. Each download creates a new directory under ignored `data/debug/` containing `snapshot.json` and `dictionary.txt`. The snapshot includes the complete saved game, server version, game revision, timestamps, source origin, and the dictionary with its SHA-256 hash. It contains server-saved state only; unsynced browser drafts are unavailable.
- Use `snapshot.game` with the functions in `shared/` and load `dictionary.txt` through `parseWords`/the shared lexicon for local reproduction. Archived games retain their final position in `archivedBoard`/`archivedState`; use the shared review helpers to interpret history. Keep all experiments local and never commit downloaded games or word lists.
- `/api/debug/games` lists games; `/api/debug/games/:id` exports a snapshot. This namespace accepts GET/HEAD only and rejects every other method with 405 before body parsing. It does not change games or backfill the summary cache. The CLI uses GET only, refuses redirects, and times out after 30 seconds. The normal app API still supports saving games.
- These endpoints require deploying this version to the NAS first. A 404 can mean an older deployment or a missing game; a 409 means the game's dictionary is unavailable. The debugging API shares the app's trusted-LAN access model; keep its port closed to the internet.
