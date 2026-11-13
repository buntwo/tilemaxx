#!/usr/bin/env bash

cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit
git pull --ff-only || exit

if [[ ! -f compose.yaml ]]; then
  printf '%s\n' 'Create compose.yaml from compose.prebuilt.yaml and uncomment "build: .". See README.md.' >&2
  exit 1
fi

docker compose -f compose.yaml up -d --build --remove-orphans
