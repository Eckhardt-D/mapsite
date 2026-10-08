#!/usr/bin/env bash
# Release the 2.x maintenance line from the v2 branch.
#
# Usage: npm run release -- <patch|minor> [--dry-run]
#
# Add the CHANGELOG.md entry and commit it before running this. The script
# checks the branch, runs the checks, bumps the version (commit + tag), publishes
# to npm, and pushes the branch and tag.
set -euo pipefail

BRANCH=v2
MAJOR=2
REMOTE=origin

bump="${1:-}"
dry_run=false
[[ "${2:-}" == "--dry-run" ]] && dry_run=true

if [[ "$bump" != "patch" && "$bump" != "minor" ]]; then
  echo "Usage: npm run release -- <patch|minor> [--dry-run]" >&2
  echo "Major releases belong on the main branch, not on $BRANCH." >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "Releases from this script must run on '$BRANCH' (on '$current_branch')." >&2
  exit 1
fi

current_version="$(node -p "require('./package.json').version")"
if [[ "${current_version%%.*}" != "$MAJOR" ]]; then
  echo "package.json is at $current_version, expected a $MAJOR.x version." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash your changes first." >&2
  exit 1
fi

git fetch "$REMOTE" "$BRANCH" --tags --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$REMOTE/$BRANCH")" ]]; then
  echo "$BRANCH is not in sync with $REMOTE/$BRANCH. Push or pull first." >&2
  exit 1
fi

# Once a newer major owns `latest`, 2.x releases must not take it over.
latest="$(npm view mapsite dist-tags.latest)"
if [[ "${latest%%.*}" -gt "$MAJOR" ]]; then
  dist_tag="v$MAJOR"
else
  dist_tag="latest"
fi

npm ci
npm run lint
npm run typecheck
npm test

if $dry_run; then
  echo "Dry run: would bump $current_version ($bump), publish with --tag $dist_tag, and push."
  npm publish --dry-run --tag "$dist_tag"
  exit 0
fi

npm version "$bump"
npm publish --tag "$dist_tag"
git push "$REMOTE" "$BRANCH" --follow-tags

echo "Published $(node -p "require('./package.json').version") to npm with tag '$dist_tag'."
