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

## Git and deployment

- Bump the Tilemaxx patch version by one in every commit, starting at `0.0.1` in the commit that introduces versioning. Run `npm version patch --no-git-tag-version` before staging and include both package files in the same commit. Bump major or minor only when the user explicitly asks. A minor bump resets the patch to `0`. A major bump sets the patch to `1`.
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
