#!/bin/bash

# Target filenames (order matters)
TARGET_NAMES=(
  "icon.png"
  "icon.ico"
  "icon-online.png"
  "icon-offline.png"
  "connected.png"
  "disconnected.png"
  "checkmark.png"
  "error.png"
  "logs.png"
  "port.png"
  "quit.png"
  "restart.png"
  "window.png"
)

for dir in IconSet*; do
  [ -d "$dir" ] || continue
  echo "Processing $dir"

  i=0
  for file in "$dir"/*.png "$dir"/*.ico; do
    [ -f "$file" ] || continue

    new_name="${TARGET_NAMES[$i]}"
    [ -z "$new_name" ] && break

    mv -v "$file" "$dir/$new_name"
    ((i++))
  done
done
