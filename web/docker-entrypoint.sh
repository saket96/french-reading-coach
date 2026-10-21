#!/bin/sh
set -e

# Named volume web_node_modules can lag behind package-lock after pulls.
# Reinstall when the lockfile hash is missing or out of date.
LOCK_HASH_FILE=node_modules/.package-lock.hash
need_install=0
if [ ! -d node_modules ] || [ ! -f "$LOCK_HASH_FILE" ]; then
  need_install=1
elif ! cmp -s package-lock.json "$LOCK_HASH_FILE" 2>/dev/null; then
  need_install=1
fi

if [ "$need_install" -eq 1 ]; then
  echo "Installing web dependencies (package-lock changed)…"
  npm ci
  cp package-lock.json "$LOCK_HASH_FILE"
fi

exec "$@"
