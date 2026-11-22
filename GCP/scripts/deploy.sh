#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the Google Cloud project you want to deploy to.}"
test -f "functions/.env.${GCP_PROJECT_ID}" || {
  echo 'Run bash scripts/setup.sh first.' >&2
  exit 1
}
functions/venv/bin/python -m unittest discover -s tests -v
node --check public/app.js
# Deploy backends before activating the website routes.
./node_modules/.bin/firebase deploy --project "$GCP_PROJECT_ID" --only functions,firestore:rules --non-interactive
./node_modules/.bin/firebase deploy --project "$GCP_PROJECT_ID" --only hosting --non-interactive
