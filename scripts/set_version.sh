#!/usr/bin/env bash
#
# Sync a single version number into every file that carries one.
# Usage: scripts/set_version.sh <version>   e.g. scripts/set_version.sh 0.2.0
#
# Used by the release workflow so the Docker image, the desktop installer, and the
# committed version bump all agree. Run from the repository root.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <version>" >&2
  exit 1
fi
version="$1"

# Source of truth
echo "$version" > VERSION

# Root pyproject.toml — the first top-level `version = "..."` ([project]).
sed -i -E '0,/^version = ".*"/s//version = "'"$version"'"/' pyproject.toml

# frontend/package.json — top-level "version".
tmp=$(mktemp); jq --arg v "$version" '.version = $v' frontend/package.json > "$tmp"; mv "$tmp" frontend/package.json

# desktop/src-tauri/tauri.conf.json — drives the installer filename.
tmp=$(mktemp); jq --arg v "$version" '.version = $v' desktop/src-tauri/tauri.conf.json > "$tmp"; mv "$tmp" desktop/src-tauri/tauri.conf.json

# desktop/src-tauri/Cargo.toml — the [package] version (first `version = "..."`).
sed -i -E '0,/^version = ".*"/s//version = "'"$version"'"/' desktop/src-tauri/Cargo.toml

echo "Set version to $version in VERSION, pyproject.toml, frontend/package.json, tauri.conf.json, Cargo.toml"
