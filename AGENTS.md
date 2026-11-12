# Repository instructions

- Git commits are signed through Secretive without fingerprint approval. Run Git non-interactively and never allocate a PTY for commit or push commands. If signing unexpectedly blocks, diagnose the process instead of assuming user approval is pending.
- Never connect to another machine with SSH or execute commands on another machine unless the user has given explicit prior approval for that specific remote access. Deployment or validation requirements do not imply SSH approval.
- Keep imported word lists and saved games in the ignored `data/` directory. Do not put them in Git, the Docker build context, or a public deployment.
- Run `npm test` and `npm run build` after changes to rules, solving, persistence, or deployment.
