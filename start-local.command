#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"
cd "$DIR"

if [ ! -d "apps/studio/dist-electron" ]; then
  bun run build:studio
fi

open -n -a "$DIR/node_modules/electron/dist/Electron.app" --args "$DIR/apps/studio"
