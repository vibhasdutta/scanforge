#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$DIR/../.." && pwd)"

if [ -f "$ROOT_DIR/node_bin.txt" ]; then
  NODE_BIN="$(cat "$ROOT_DIR/node_bin.txt" | tr -d '\r\n')"
  if [ -x "$NODE_BIN" ]; then
    exec "$NODE_BIN" "$DIR/native-host.js" "$@"
  fi
fi

for candidate in \
  "$(command -v node 2>/dev/null)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "/usr/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    exec "$candidate" "$DIR/native-host.js" "$@"
  fi
done

exec node "$DIR/native-host.js" "$@"
