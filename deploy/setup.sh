#!/usr/bin/env bash
# One-time setup for deploying Iris to Cloud Run. Safe to run again: existing resources are left as they are.
#
#   GOOGLE_CLOUD_PROJECT=my-project deploy/setup.sh
#
# Secret values are read from the environment (IRIS_OWNER_TOKEN, optional GEMINI_API_KEY) and piped to Secret
# Manager; they are never printed.
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] || { echo "Set GOOGLE_CLOUD_PROJECT (or gcloud config set project ...)" >&2; exit 1; }
REGION="${REGION:-asia-south1}"
AR_REPO="${AR_REPO:-iris}"
SA_NAME="${SA_NAME:-iris-run}"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
OWNER_TOKEN_SECRET="${OWNER_TOKEN_SECRET:-iris-owner-token}"
GEMINI_API_KEY_SECRET="${GEMINI_API_KEY_SECRET:-iris-gemini-api-key}"
BUCKET="${BUCKET:-}"

gcloud config set project "$PROJECT" >/dev/null

echo "Enabling APIs"
gcloud services enable run.googleapis.com aiplatform.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com storage.googleapis.com

echo "Artifact Registry repository $AR_REPO in $REGION"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION" \
    --description "Iris container images"
# Keep storage minimal: the newest KEEP_IMAGES images stay, older ones are deleted (Artifact Registry applies cleanup
# policies about once a day). The image a revision serves is one of the newest, so it is never removed.
KEEP_IMAGES="${KEEP_IMAGES:-5}"
POLICY="$(mktemp -t iris-cleanup.XXXXXX)"
trap 'rm -f "$POLICY"' EXIT
cat > "$POLICY" <<JSON
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": $KEEP_IMAGES}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" --policy "$POLICY" \
  --no-dry-run >/dev/null
echo "Cleanup policy: keep the newest $KEEP_IMAGES images"

echo "Service account $SA"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" --display-name "Iris on Cloud Run"
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
  --role roles/aiplatform.user --condition None >/dev/null

put_secret() {  # name, value
  local name="$1" value="$2"
  gcloud secrets describe "$name" >/dev/null 2>&1 ||
    gcloud secrets create "$name" --replication-policy automatic
  if [ -n "$value" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "Added a version to $name"
  fi
  gcloud secrets add-iam-policy-binding "$name" --member "serviceAccount:$SA" \
    --role roles/secretmanager.secretAccessor --condition None >/dev/null
}

echo "Secret $OWNER_TOKEN_SECRET"
if [ -z "${IRIS_OWNER_TOKEN:-}" ] &&
   ! gcloud secrets versions list "$OWNER_TOKEN_SECRET" --limit 1 --format='value(name)' 2>/dev/null | grep -q .; then
  echo "IRIS_OWNER_TOKEN is not set and $OWNER_TOKEN_SECRET has no version. Make one with" >&2
  echo "  export IRIS_OWNER_TOKEN=\$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" >&2
  exit 1
fi
put_secret "$OWNER_TOKEN_SECRET" "${IRIS_OWNER_TOKEN:-}"

if [ -n "${GEMINI_API_KEY:-}" ]; then
  echo "Secret $GEMINI_API_KEY_SECRET (optional)"
  put_secret "$GEMINI_API_KEY_SECRET" "$GEMINI_API_KEY"
fi

if [ -n "$BUCKET" ]; then
  echo "Bucket gs://$BUCKET"
  gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 ||
    gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" \
    --role roles/storage.objectUser >/dev/null
fi

echo "Done. Deploy with: GOOGLE_CLOUD_PROJECT=$PROJECT REGION=$REGION ${BUCKET:+BUCKET=$BUCKET }deploy/deploy.sh"
