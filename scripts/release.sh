#!/usr/bin/env bash
# Release from the v3 line (the v3 branch, or master once v3 has merged).
#
# Usage: npm run release -- <bump> [--preid <id>] [--dry-run]
#   <bump> is any `npm version` increment: patch, minor, major, prepatch,
#   preminor, premajor, prerelease.
#
# Pre-release versions (e.g. 3.0.0-beta.0) are published under the `next`
# dist-tag, stable versions under `latest`. 2.x releases are made from the v2
# branch with its own script and never from here.
#
# Add the CHANGELOG.md entry and commit it before running this.
set -euo pipefail

REMOTE=origin

bump=""
preid=""
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preid) preid="${2:?--preid needs a value}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) bump="$1"; shift ;;
  esac
done

case "$bump" in
  patch|minor|major|prepatch|preminor|premajor|prerelease) ;;
  *)
    echo "Usage: npm run release -- <patch|minor|major|prepatch|preminor|premajor|prerelease> [--preid <id>] [--dry-run]" >&2
    exit 1
    ;;
esac

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "v3" && "$branch" != "master" ]]; then
  echo "Releases from this script run on 'v3' or 'master' (on '$branch')." >&2
  exit 1
fi

current_version="$(node -p "require('./package.json').version")"
if [[ "$branch" == "master" && "${current_version%%.*}" -lt 3 ]]; then
  echo "master is still at $current_version; v3 has not been merged yet." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

git fetch "$REMOTE" "$branch" --tags --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$REMOTE/$branch")" ]]; then
  echo "$branch is not in sync with $REMOTE/$branch. Push or pull first." >&2
  exit 1
fi

npm ci
npm run lint
npm run typecheck
npm test

version_args=("$bump")
[[ -n "$preid" ]] && version_args+=(--preid "$preid")

if $dry_run; then
  echo "Dry run: would run 'npm version ${version_args[*]}' on $current_version, publish, and push."
  npm pack --dry-run
  exit 0
fi

npm version "${version_args[@]}"
new_version="$(node -p "require('./package.json').version")"
if [[ "$new_version" == *-* ]]; then dist_tag="next"; else dist_tag="latest"; fi

npm publish --tag "$dist_tag"
git push "$REMOTE" "$branch" --follow-tags

echo "Published $new_version to npm with tag '$dist_tag'."
