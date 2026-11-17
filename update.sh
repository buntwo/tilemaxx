#!/usr/bin/env bash

set -e
export GIT_TERMINAL_PROMPT=0

# Reserve exit 10 for the explicit DSM notification after a successful update.
if [[ ${1:-} == --notify-if-changed ]]; then
  trap '
    if [[ $? == 10 ]]; then
      printf "%s\n" "Tilemaxx update failed (command exited with 10)." >&2
      exit 1
    fi
  ' ERR
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

state=$(git rev-parse --git-path tilemaxx-update)
lock="$state.lock"
if ! mkdir -- "$lock"; then
  printf '%s\n' "Cannot acquire $lock. Check for another Tilemaxx update." >&2
  exit 1
fi
trap 'rmdir -- "$lock" || exit 1' EXIT
trap 'exit 1' HUP INT TERM

# Keep the starting revision until deployment succeeds so scheduled runs can retry.
if [[ ! -s "$state" ]]; then
  git rev-parse HEAD > "$state"
fi
previous=$(cat -- "$state")
if [[ ${2:-} == --sync-upstream ]]; then
  # The scheduled deployment follows rewrites and rollbacks of its upstream.
  git fetch --force --prune --no-tags
  upstream=$(git rev-parse --verify '@{upstream}')
  if [[ $upstream != "$(git rev-parse HEAD)" ]]; then
    # Git can overwrite ignored files when they are tracked by the target.
    if ! git diff --quiet HEAD "$upstream" -- compose.yaml .env data; then
      printf '%s\n' 'Upstream changes tracked deployment files (compose.yaml, .env, or data/). Sync stopped to protect local files.' >&2
      exit 1
    fi
    git reset --keep "$upstream"
  fi
else
  git pull --ff-only
fi
current=$(git rev-parse HEAD)

if [[ ${1:-} == --notify-if-changed && $current == "$previous" ]]; then
  rm -- "$state"
  printf '%s\n' 'Tilemaxx is up to date. Skipping Docker Compose.'
  exit 0
fi

if [[ ! -f compose.yaml ]]; then
  printf '%s\n' 'Create compose.yaml from compose.prebuilt.yaml and uncomment "build: .". See README.md.' >&2
  exit 1
fi

if command -v docker-compose >/dev/null && ! docker compose version >/dev/null 2>&1; then
  compose=(docker-compose)
else
  compose=(docker compose)
fi

"${compose[@]}" -f compose.yaml up -d --build --remove-orphans
rm -- "$state"

if [[ ${1:-} == --notify-if-changed ]]; then
  printf 'Tilemaxx updated successfully to %s. Exit code 10 triggers the DSM email.\n' "$current"
  exit 10
fi
