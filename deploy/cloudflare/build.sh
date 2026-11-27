#!/bin/sh
# Build the TxStory website for Cloudflare from an exact commit.
#
#   ./build.sh            # builds the v0.4.0 release
#   ./build.sh <git ref>  # any tag or commit of this repository
#
# The app is built from a clean `git archive` of that commit with its own
# lockfile (no local edits, no ignored files, no existing build output).
# Then this directory's _headers is added, and the source commit is written to
# public/source-commit.txt. Nothing else is changed. Output: ./public
set -eu
REF="${1:-v0.4.0}"
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
COMMIT=$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git -C "$ROOT" archive "$COMMIT" | tar -x -C "$WORK"
(cd "$WORK" && npm ci --no-audit --no-fund >/dev/null && npm run -s build:site)

rm -rf "$HERE/public"
cp -R "$WORK/dist/site" "$HERE/public"
cp "$HERE/_headers" "$HERE/public/_headers"
printf '%s\n' "$COMMIT" > "$HERE/public/source-commit.txt"
echo "Built $REF ($COMMIT) into $HERE/public"
