# Repository instructions

## Architecture

- Keep game rules, scoring, solving, and analysis in `shared/` as TypeScript that can run without React, the DOM, or SQLite. Reuse the same rules across live play and review.
- Use `src/` for React UI, browser storage, and worker coordination. Keep `App.tsx` focused on composing views. Put feature state and asynchronous workflows in the component or hook that owns them.
- Run expensive analysis in workers with typed messages and bounded work. Keep large result sets in the worker and send summaries or pages to the UI. Ignore stale responses after the position changes.
- Keep HTTP validation and SQLite persistence in `server/`. Preserve compatibility with existing saves. Poll compact summaries, load full histories on demand, and keep unsynced drafts separate from the read cache.

## Verification

- Run `npm run verify` for changes to rules, solving, persistence, UI, imports, or deployment. It runs the tests, type check, and production build, and is the GitHub CI gate.
- Keep solver, API, sync, and UI tests in the default suite. Add targeted regression coverage for behavior changes. Check changed UI interactions in an isolated browser workspace with test data.

## Git and deployment

- Git commits are signed through Secretive without fingerprint approval. Run Git non-interactively and never allocate a PTY for commit or push commands. If signing unexpectedly blocks, diagnose the process instead of assuming user approval is pending.
- After verifying and committing Tilemaxx changes, push them to GitHub's `origin/main` with a fast-forward push. The NAS pulls updates from that branch.
- Tilemaxx is self-hosted on a trusted local network. The NAS update script fast-forwards the checkout and rebuilds with Docker Compose. Keep `compose.yaml` local and preserve the bind-mounted `data/` directory across updates. See [README.md](README.md) for setup and recovery.
- Never connect to another machine with SSH or execute commands on another machine unless the user has given explicit prior approval for that specific remote access. Deployment or validation requirements do not imply SSH approval.
- Keep imported word lists and saved games in the ignored `data/` directory. Do not put them in Git, the Docker build context, or a public deployment.
