#!/bin/sh
# Checks out the sakalya-mobile release pinned in mobile/sakalya-mobile.version into
# mobile/.deps/sakalya-mobile (git-ignored), which mobile/settings.gradle.kts includes as a
# composite build. Refuses a tag whose commit differs from the pin (a moved tag).
#   scripts/mobile-deps.sh                                  # from GitHub
#   SAKALYA_MOBILE_PATH=../sakalya-mobile scripts/mobile-deps.sh   # from a local clone
set -eu
# Inside a git hook, GIT_DIR and GIT_INDEX_FILE point at the aarogyam repository; `git -C` would
# then check sakalya-mobile out over aarogyam's HEAD and index. Talk only to the checkout's own repo.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
root=$(cd "$(dirname "$0")/.." && pwd)
tag=$(sed -n 's/^tag=//p' "$root/mobile/sakalya-mobile.version")
commit=$(sed -n 's/^commit=//p' "$root/mobile/sakalya-mobile.version")
[ -n "$tag" ] && [ -n "$commit" ] || { echo "mobile-deps: tag or commit missing in mobile/sakalya-mobile.version" >&2; exit 1; }
src=${SAKALYA_MOBILE_PATH:-https://github.com/sakalyatechnologies/sakalya-mobile.git}
case $src in /* | *://*) ;; *) src=$(cd "$src" && pwd) ;; esac
dest=$root/mobile/.deps/sakalya-mobile

if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD 2>/dev/null)" = "$commit" ] &&
  [ -z "$(git -C "$dest" status --porcelain --untracked-files=no)" ]; then
  echo "mobile-deps: sakalya-mobile $tag already checked out"
else
  [ -d "$dest/.git" ] || git init --quiet "$dest"
  git -C "$dest" fetch --quiet --force --no-tags "$src" "refs/tags/$tag:refs/tags/$tag" ||
    { echo "mobile-deps: could not fetch tag $tag from $src" >&2; exit 1; }
  actual=$(git -C "$dest" rev-parse "refs/tags/$tag^{commit}")
  if [ "$actual" != "$commit" ]; then
    echo "mobile-deps: $tag points at $actual, but mobile/sakalya-mobile.version pins $commit; refusing" >&2
    exit 1
  fi
  git -C "$dest" -c advice.detachedHead=false checkout --quiet --force "$commit"
  echo "mobile-deps: sakalya-mobile $tag ($commit) checked out"
fi

# The included build's Android modules look for the SDK in their own local.properties.
if [ -f "$root/mobile/local.properties" ]; then
  cp "$root/mobile/local.properties" "$dest/local.properties"
fi
