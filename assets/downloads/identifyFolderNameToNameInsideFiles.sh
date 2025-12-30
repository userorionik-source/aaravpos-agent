#!/bin/bash

DEST_ROOT="IconSets"
mkdir -p "$DEST_ROOT"

for src in */; do
  src=${src%/}
  [ -d "$src" ] || continue

  dest="$DEST_ROOT/$src"
  mkdir -p "$dest/png" "$dest/ico"

  # Move PNG files (no overwrite)
  find "$src" -maxdepth 1 -type f -iname "*.png" -exec mv -vn {} "$dest/png/" \;

  # Move ICO files (no overwrite)
  find "$src" -maxdepth 1 -type f -iname "*.ico" -exec mv -vn {} "$dest/ico/" \;
done
