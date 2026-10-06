#!/bin/sh
# Xcode build phase: builds the shared Kotlin framework (with SKIE) for this configuration, SDK
# and architecture into shared/build/xcode-frameworks. Two Gradle workers keep the Mac usable.
set -eu
cd "$SRCROOT/.."
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || echo /opt/homebrew/opt/openjdk@17)"
  export JAVA_HOME
fi
./gradlew --quiet --max-workers=2 :shared:embedAndSignAppleFrameworkForXcode
