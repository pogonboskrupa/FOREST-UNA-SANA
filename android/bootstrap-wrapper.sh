#!/bin/sh
set -eu
wrapper_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/gradle/wrapper" && pwd)
wrapper_temp=$(mktemp "$wrapper_dir/gradle-wrapper.XXXXXX")
trap 'rm -f "$wrapper_temp"' EXIT HUP INT TERM
curl --fail --location --connect-timeout 10 --max-time 60 \
  https://raw.githubusercontent.com/gradle/gradle/v8.4.0/gradle/wrapper/gradle-wrapper.jar -o "$wrapper_temp"
wrapper_expected=$(curl --fail --location --connect-timeout 10 --max-time 30 \
  https://services.gradle.org/distributions/gradle-8.4-wrapper.jar.sha256)
printf '%s  %s\n' "$wrapper_expected" "$wrapper_temp" | sha256sum --check --status
mv "$wrapper_temp" "$wrapper_dir/gradle-wrapper.jar"
