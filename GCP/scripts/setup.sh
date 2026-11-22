#!/usr/bin/env bash
# Provision only gallery resources in the explicitly selected project.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the Google Cloud project you want to use.}"
: "${GCP_ACCOUNT:?Set GCP_ACCOUNT to your authenticated Google account.}"
GALLERY_BUCKET="${GALLERY_BUCKET:-${GCP_PROJECT_ID}-gallery-images}"
GALLERY_SA="gallery-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
GCP_ARGS=(--project="$GCP_PROJECT_ID" --account="$GCP_ACCOUNT" --quiet)

if ! GALLERY_BILLING_ENABLED="$(gcloud billing projects describe "$GCP_PROJECT_ID" --account="$GCP_ACCOUNT" --format='value(billingEnabled)')"; then
  echo 'Could not verify billing. Check the preceding API/authentication error and retry.' >&2
  exit 1
fi
if [[ "$GALLERY_BILLING_ENABLED" != "True" ]]; then
  echo 'Enable billing on the selected project before setup.' >&2
  exit 1
fi
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com "${GCP_ARGS[@]}"

if ! ./node_modules/.bin/firebase projects:list --json --non-interactive | \
  python3 -c 'import json,sys; project=sys.argv[1]; result=json.load(sys.stdin); sys.exit(0 if any(p["projectId"]==project for p in result.get("result",[])) else 1)' "$GCP_PROJECT_ID"; then
  ./node_modules/.bin/firebase projects:addfirebase "$GCP_PROJECT_ID" --non-interactive
fi

if ! gcloud firestore databases describe --database='(default)' "${GCP_ARGS[@]}" >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location=us-central1 --type=firestore-native "${GCP_ARGS[@]}"
fi
if ! gcloud storage buckets describe "gs://${GALLERY_BUCKET}" "${GCP_ARGS[@]}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${GALLERY_BUCKET}" --location=us-central1 --uniform-bucket-level-access "${GCP_ARGS[@]}"
fi
if ! gcloud iam service-accounts describe "$GALLERY_SA" "${GCP_ARGS[@]}" >/dev/null 2>&1; then
  gcloud iam service-accounts create gallery-runtime --display-name='Photo gallery runtime' "${GCP_ARGS[@]}"
fi
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${GALLERY_SA}" --role=roles/datastore.user "${GCP_ARGS[@]}" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${GALLERY_BUCKET}" \
  --member="serviceAccount:${GALLERY_SA}" --role=roles/storage.objectUser "${GCP_ARGS[@]}" >/dev/null
# Public photo reads are intentional for this anonymous college demo.
gcloud storage buckets add-iam-policy-binding "gs://${GALLERY_BUCKET}" \
  --member=allUsers --role=roles/storage.objectViewer "${GCP_ARGS[@]}" >/dev/null

printf 'IMAGE_BUCKET=%s\nRUNTIME_SERVICE_ACCOUNT=%s\n' "$GALLERY_BUCKET" "$GALLERY_SA" > "functions/.env.${GCP_PROJECT_ID}"
echo "Ready to deploy to ${GCP_PROJECT_ID}; image bucket: ${GALLERY_BUCKET}"
