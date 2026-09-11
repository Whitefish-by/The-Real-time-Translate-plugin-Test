#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/../extension"
npm run build:safari
cd "$SCRIPT_DIR"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install it with: brew install xcodegen" >&2
  exit 1
fi
xcodegen generate --spec project.yml
echo "Generated $SCRIPT_DIR/LiveBilingualSubtitles.xcodeproj"
