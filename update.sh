#!/usr/bin/env bash

cd -- "$(dirname -- "${BASH_SOURCE[0]}")" || exit
git pull --ff-only && docker compose up -d --build
