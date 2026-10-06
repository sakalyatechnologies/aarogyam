#!/bin/sh
# Xcode build phase: writes the Supabase URL, publishable key and prod app host into the app
# bundle as BuildSettings.plist. Environment variables win over the git-ignored
# mobile/local.secrets.properties, as on Android. Nothing secret is committed.
set -eu
secrets="$SRCROOT/../local.secrets.properties"
prop() {
  [ -f "$secrets" ] || return 0
  sed -n "s/^$1=//p" "$secrets" | tail -1
}
url="${AAROGYAM_SUPABASE_URL:-$(prop supabase.url)}"
key="${AAROGYAM_SUPABASE_KEY:-$(prop supabase.key)}"
host="${AAROGYAM_PROD_APP_HOST:-$(prop prod.app_host)}"
out="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/BuildSettings.plist"
mkdir -p "$(dirname "$out")"
rm -f "$out"
/usr/libexec/PlistBuddy -c "Add :SupabaseURL string $url" -c "Add :SupabaseKey string $key" \
  -c "Add :ProdAppHost string $host" "$out" >/dev/null
