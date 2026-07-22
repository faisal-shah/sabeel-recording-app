#!/usr/bin/env bash
set -euo pipefail

# The Firebase emulators require JDK 21+. Locally we keep JDK 17 as the default (for the
# Android/Gradle build) and point only the emulators at a user-local JDK 21.
# Resolution order: explicit SR_JDK21_HOME → user-local ~/opt/jdk-21 → whatever java is
# already on PATH (CI provides JDK 21 via setup-java).
if [ -n "${SR_JDK21_HOME:-}" ]; then
  export JAVA_HOME="$SR_JDK21_HOME"
elif [ -d "$HOME/opt/jdk-21" ]; then
  export JAVA_HOME="$HOME/opt/jdk-21"
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

bash "$(dirname "$0")/free-emulator-ports.sh"

exec firebase emulators:exec \
  --project demo-sabeel \
  --only firestore,auth,storage \
  "npm run test:integration -w functions"
