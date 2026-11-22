#!/usr/bin/env bash
# Build Iris with Cloud Build, push it to Artifact Registry, and deploy it to Cloud Run as the service "iris-api".
#
#   GOOGLE_CLOUD_PROJECT=my-project deploy/deploy.sh
#
# One-time setup (APIs, Artifact Registry repo, service account, secrets) is in deploy/README.md or deploy/setup.sh.
# Every setting below can be overridden from the environment. CI (.github/workflows/deploy.yml) builds the image itself
# and passes IMAGE, which skips the Cloud Build step, plus IRIS_PUBLIC_URL and IRIS_ALLOWED_ORIGINS (the Firebase site).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] || { echo "Set GOOGLE_CLOUD_PROJECT (or gcloud config set project ...)" >&2; exit 1; }

REGION="${REGION:-asia-south1}"                 # where Cloud Run, Artifact Registry and the build run
SERVICE="${SERVICE:-iris-api}"
AR_REPO="${AR_REPO:-iris}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-iris-run@${PROJECT}.iam.gserviceaccount.com}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d-%H%M%S)}"
# IMAGE set: an image already pushed (CI builds it); deploy it as it is, no Cloud Build.
BUILD=1; [ -z "${IMAGE:-}" ] || BUILD=0
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/iris:${TAG}}"
IRIS_VERSION="${IRIS_VERSION:-$TAG}"             # what GET /api/health reports (CI: the commit SHA)

# Vertex AI (Gemini). The service account's identity is used: no key file. GOOGLE_CLOUD_LOCATION is the Vertex
# location, independent of REGION ("global" serves the newest Gemini models).
GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-global}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"            # owner decision Nov 22: Flash for every role
GEMINI_FAST_MODEL="${GEMINI_FAST_MODEL:-gemini-3.8-flash}"
GEMINI_ESCALATION_MODEL="${GEMINI_ESCALATION_MODEL:-gemini-3.8-flash}"   # with thinking level high
GEMINI_IMAGE_MODEL="${GEMINI_IMAGE_MODEL:-gemini-3.1-flash-image}"
GEMINI_THINKING_LEVEL="${GEMINI_THINKING_LEVEL:-low}"
GEMINI_ESCALATION_THINKING_LEVEL="${GEMINI_ESCALATION_THINKING_LEVEL:-high}"

# Secret Manager secret names (values never pass through this script).
OWNER_TOKEN_SECRET="${OWNER_TOKEN_SECRET:-iris-owner-token}"
GEMINI_API_KEY_SECRET="${GEMINI_API_KEY_SECRET-iris-gemini-api-key}"   # optional; used only if it exists; "" never

# Optional Cloud Storage bucket, mounted with Cloud Storage FUSE at /mnt/iris: keeps the owner's settings for
# everyone and the Show it built picture cache across restarts. Empty: nothing persists outside the process.
BUCKET="${BUCKET:-}"

# Container shape, kept minimal: at most one instance (state is in memory), scaled to zero when idle, 2 CPU and 4 GiB
# (the geometry needs them) allocated only while a request is open, 64 concurrent requests, 10-minute requests.
# Scale to zero means a cold start (a few seconds) after an idle spell, and it loses the open models; MIN_INSTANCES=1
# keeps one warm (billed all the time). CPU_THROTTLING=0 keeps CPU between requests (billed all the time too), for
# work that outlives its request.
CPU="${CPU:-2}"
MEMORY="${MEMORY:-4Gi}"
CONCURRENCY="${CONCURRENCY:-64}"
TIMEOUT="${TIMEOUT:-600}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
CPU_THROTTLING="${CPU_THROTTLING:-1}"
MAX_INSTANCES=1                                  # never more: a second instance answers "Model not loaded"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-1}"   # public demo
# The web app's other origins (Firebase Hosting), comma-separated: CORS with credentials and the cross-site owner
# cookie (server/iris/origins.py), and the service is then the API only ("/" answers with where to look). Empty: the
# service serves the web app itself, on one origin.
IRIS_ALLOWED_ORIGINS="${IRIS_ALLOWED_ORIGINS:-}"

echo "Project $PROJECT, region $REGION, service $SERVICE"
echo "Image   $IMAGE"

# 1. Build and push (skipped when IMAGE was given).
if [ "$BUILD" = "1" ]; then
  gcloud builds submit "$ROOT" \
    --project "$PROJECT" \
    --region "$REGION" \
    --config "$ROOT/cloudbuild.yaml" \
    --ignore-file deploy/.gcloudignore \
    --substitutions "_REGION=${REGION},_REPO=${AR_REPO},_IMAGE=iris,_TAG=${TAG}"
fi

# 2. Env vars: the caps in deploy/env.yaml plus the Vertex AI settings and the public URL.
if [ -n "${IRIS_PUBLIC_URL:-}" ]; then
  PUBLIC_URL="$IRIS_PUBLIC_URL"
else
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  PUBLIC_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
fi

ENV_FILE="$(mktemp -t iris-env.XXXXXX)"
trap 'rm -f "$ENV_FILE"' EXIT
cat "$ROOT/deploy/env.yaml" > "$ENV_FILE"
{
  echo "GOOGLE_CLOUD_PROJECT: \"$PROJECT\""
  echo "GOOGLE_CLOUD_LOCATION: \"$GOOGLE_CLOUD_LOCATION\""
  echo "GOOGLE_GENAI_USE_VERTEXAI: \"true\""
  echo "GEMINI_MODEL: \"$GEMINI_MODEL\""
  echo "GEMINI_FAST_MODEL: \"$GEMINI_FAST_MODEL\""
  echo "GEMINI_ESCALATION_MODEL: \"$GEMINI_ESCALATION_MODEL\""
  echo "GEMINI_IMAGE_MODEL: \"$GEMINI_IMAGE_MODEL\""
  echo "GEMINI_THINKING_LEVEL: \"$GEMINI_THINKING_LEVEL\""
  echo "GEMINI_ESCALATION_THINKING_LEVEL: \"$GEMINI_ESCALATION_THINKING_LEVEL\""
  echo "IRIS_PUBLIC_URL: \"$PUBLIC_URL\""
  echo "IRIS_VERSION: \"$IRIS_VERSION\""
  if [ -n "$IRIS_ALLOWED_ORIGINS" ]; then
    echo "IRIS_ALLOWED_ORIGINS: \"$IRIS_ALLOWED_ORIGINS\""
  fi
  if [ -n "$BUCKET" ]; then
    echo "IRIS_SETTINGS_FILE: \"/mnt/iris/settings.json\""
    echo "IRIS_BUILT_CACHE: \"/mnt/iris/built\""
  fi
} >> "$ENV_FILE"

# 3. Secrets from Secret Manager.
SECRETS="IRIS_OWNER_TOKEN=${OWNER_TOKEN_SECRET}:latest"
if [ -n "$GEMINI_API_KEY_SECRET" ] &&
   gcloud secrets describe "$GEMINI_API_KEY_SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  SECRETS="${SECRETS},GEMINI_API_KEY=${GEMINI_API_KEY_SECRET}:latest"
  echo "Using optional secret $GEMINI_API_KEY_SECRET as GEMINI_API_KEY"
fi

ARGS=(
  --project "$PROJECT"
  --region "$REGION"
  --image "$IMAGE"
  --service-account "$SERVICE_ACCOUNT"
  --port 8080
  --cpu "$CPU"
  --memory "$MEMORY"
  --concurrency "$CONCURRENCY"
  --timeout "$TIMEOUT"
  --min-instances "$MIN_INSTANCES"
  --max-instances "$MAX_INSTANCES"
  --cpu-boost                      # faster cold starts
  --execution-environment gen2     # needed for the Cloud Storage volume
  --env-vars-file "$ENV_FILE"
  --set-secrets "$SECRETS"
  --clear-volumes
  --clear-volume-mounts
)
if [ "$CPU_THROTTLING" = "1" ]; then
  ARGS+=(--cpu-throttling)         # CPU only while a request is open (billed per request)
else
  ARGS+=(--no-cpu-throttling)      # CPU between requests too: background work keeps going (billed all the time)
fi
if [ -n "$BUCKET" ]; then
  ARGS+=(--add-volume "name=iris-data,type=cloud-storage,bucket=${BUCKET}"
         --add-volume-mount "volume=iris-data,mount-path=/mnt/iris")
fi
if [ "$ALLOW_UNAUTHENTICATED" = "1" ]; then
  ARGS+=(--allow-unauthenticated)
else
  ARGS+=(--no-allow-unauthenticated)
fi

# 4. Deploy.
ARGS+=(--cpu-boost)              # extra CPU while an instance starts: faster cold starts, no idle cost
gcloud run deploy "$SERVICE" "${ARGS[@]}"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo "Deployed: $URL"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "url=$URL" >> "$GITHUB_OUTPUT"            # for the workflow's next steps
fi
if [ "$URL" != "$PUBLIC_URL" ] && [ -z "${IRIS_PUBLIC_URL:-}" ]; then
  echo "Note: the service URL differs from IRIS_PUBLIC_URL ($PUBLIC_URL); redeploy with IRIS_PUBLIC_URL=$URL" >&2
fi
