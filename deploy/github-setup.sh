#!/usr/bin/env bash
# One-time setup for deploying Iris from GitHub on every push to main (.github/workflows/deploy.yml): keyless
# (Workload Identity Federation), the server on Cloud Run, the web app on Firebase Hosting. Safe to run again: what
# exists is kept, bindings are added once, and the GitHub variables are set to the same values.
#
#   gcloud auth login && gcloud auth application-default login     # first, as a project Owner
#   gh auth login                                                   # to set the repository variables
#   deploy/github-setup.sh [--project ID] [--region REGION] [--repo OWNER/NAME] [--site SITE] [--bucket NAME]
#
# The same settings can come from the environment: PROJECT_ID, REGION, REPO, FIREBASE_SITE, BUCKET.
# Minimal footprint (deploy/README.md, "What it creates"): one Artifact Registry repo keeping the newest 5 images, one
# runtime and one deploy service account, one identity pool with one provider, one Hosting site (iris-techjays).
# No JSON keys, no API keys: Cloud Run reaches Gemini through Vertex AI as its service account. Secret values never
# pass through this script's output.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gemini-enterprise-475109}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-Saravana-Rajan/IRIS}"
FIREBASE_SITE="${FIREBASE_SITE:-}"
BUCKET="${BUCKET:-}"
SET_GITHUB=1

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --site) FIREBASE_SITE="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --no-github) SET_GITHUB=0; shift ;;     # print the variables instead of setting them with gh
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AR_REPO="iris"
RUNTIME_SA="iris-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA_NAME="iris-deploy"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github-actions"
PROVIDER="iris-github"
OWNER_TOKEN_SECRET="iris-owner-token"
SITES=(iris-techjays iris-by-techjays techjays-iris)   # Hosting site ids are global: the first one free is ours

for tool in gcloud curl python3; do
  command -v "$tool" >/dev/null || { echo "$tool is needed" >&2; exit 1; }
done
if [ "$SET_GITHUB" = "1" ] && ! { command -v gh >/dev/null && gh auth status >/dev/null 2>&1; }; then
  echo "gh is missing or not signed in: the GitHub variables will be printed for you to set (or run 'gh auth login')." >&2
  SET_GITHUB=0
fi
gcloud auth print-access-token >/dev/null 2>&1 || { echo "Run 'gcloud auth login' first." >&2; exit 1; }

g() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
echo "Project $PROJECT_ID, region $REGION, GitHub repo $REPO"
PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ---- 1. APIs ------------------------------------------------------------------------------------------------------
echo "Enabling APIs"
g services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com storage.googleapis.com

# ---- 2. Runtime: the Artifact Registry repo (+ cleanup policy), runtime service account, owner token, bucket --------
# deploy/setup.sh needs an owner token when its secret has none yet: make a random one and hand it over in the
# environment only. Read it later with: gcloud secrets versions access latest --secret iris-owner-token
if [ -z "${IRIS_OWNER_TOKEN:-}" ] &&
   ! g secrets versions list "$OWNER_TOKEN_SECRET" --limit 1 --format='value(name)' 2>/dev/null | grep -q .; then
  IRIS_OWNER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  echo "Made a new owner token for $OWNER_TOKEN_SECRET (not shown; read it with gcloud secrets versions access)"
fi
# No Gemini API key in the cloud: GEMINI_API_KEY is removed from setup.sh's environment.
env -u GEMINI_API_KEY GOOGLE_CLOUD_PROJECT="$PROJECT_ID" REGION="$REGION" AR_REPO="$AR_REPO" BUCKET="$BUCKET" \
  IRIS_OWNER_TOKEN="${IRIS_OWNER_TOKEN:-}" "$ROOT/deploy/setup.sh"
unset IRIS_OWNER_TOKEN

# ---- 3. The deploy service account: only what a deploy needs --------------------------------------------------------
echo "Deploy service account $DEPLOY_SA"
g iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 ||
  g iam service-accounts create "$DEPLOY_SA_NAME" --display-name "Iris deploys from GitHub Actions"
for role in roles/run.admin roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  # run.admin: deploy the service and keep it public; firebasehosting.admin: release the web app;
  # serviceUsageConsumer: call the project's APIs.
  g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" --role "$role" \
    --condition None >/dev/null
done
# Push images to this one repository only.
g artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer >/dev/null
# Deploy the service as the runtime account, and no other.
g iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser >/dev/null
# No Secret Manager role: Cloud Run reads the owner token as the runtime account, which setup.sh let in.

# ---- 4. Workload Identity Federation: GitHub's OIDC token for this repo's main branch, no keys -----------------------
echo "Workload identity pool $POOL, provider $PROVIDER"
state="$(g iam workload-identity-pools describe "$POOL" --location global --format='value(state)' 2>/dev/null || true)"
if [ -z "$state" ]; then
  g iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
elif [ "$state" = "DELETED" ]; then
  g iam workload-identity-pools undelete "$POOL" --location global
fi
REPO_ID=""
if [ "$SET_GITHUB" = "1" ]; then
  REPO_ID="$(gh api "repos/$REPO" --jq .id 2>/dev/null || true)"   # pins the repo even if its name is reused later
fi
CONDITION="assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'"
[ -z "$REPO_ID" ] || CONDITION="${CONDITION} && assertion.repository_id == '${REPO_ID}'"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref"
pstate="$(g iam workload-identity-pools providers describe "$PROVIDER" --location global \
  --workload-identity-pool "$POOL" --format='value(state)' 2>/dev/null || true)"
if [ -z "$pstate" ]; then
  g iam workload-identity-pools providers create-oidc "$PROVIDER" --location global --workload-identity-pool "$POOL" \
    --display-name "GitHub ${REPO}" --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION"
else
  [ "$pstate" != "DELETED" ] ||
    g iam workload-identity-pools providers undelete "$PROVIDER" --location global --workload-identity-pool "$POOL"
  g iam workload-identity-pools providers update-oidc "$PROVIDER" --location global --workload-identity-pool "$POOL" \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION" >/dev/null
fi
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
g iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  >/dev/null

# ---- 5. Firebase Hosting: Firebase on the project, and the site the web app goes to ---------------------------------
TOKEN="$(gcloud auth print-access-token)"
api() {  # method url [json body]: prints the body, returns non-zero on an HTTP error
  curl -fsS -X "$1" "$2" -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" ${3:+--data "$3"}
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "Firebase on $PROJECT_ID"
if ! api GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}" >/dev/null 2>&1; then
  op="$(api POST "https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}:addFirebase" '{}' | json 'd["name"]')"
  for _ in $(seq 1 30); do
    done_="$(api GET "https://firebase.googleapis.com/v1beta1/${op}" | json 'd.get("done", False)')"
    [ "$done_" = "True" ] && break
    sleep 4
  done
  echo "Added Firebase to $PROJECT_ID"
fi

site_exists() { api GET "https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/$1" >/dev/null 2>&1; }
create_site() { api POST "https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites?siteId=$1" '{}' >/dev/null; }

if [ -z "$FIREBASE_SITE" ] && [ "$SET_GITHUB" = "1" ]; then
  FIREBASE_SITE="$(gh variable get FIREBASE_SITE --repo "$REPO" 2>/dev/null || true)"   # chosen on an earlier run
fi
if [ -z "$FIREBASE_SITE" ]; then
  for site in "${SITES[@]}"; do
    if site_exists "$site" || create_site "$site" 2>/dev/null; then FIREBASE_SITE="$site"; break; fi
    echo "Hosting site $site is taken"
  done
  [ -n "$FIREBASE_SITE" ] || { echo "None of ${SITES[*]} is free: pass --site <id>" >&2; exit 1; }
fi
site_exists "$FIREBASE_SITE" || { create_site "$FIREBASE_SITE"; echo "Created Hosting site $FIREBASE_SITE"; }
echo "Hosting site $FIREBASE_SITE: https://${FIREBASE_SITE}.web.app"

# For a local 'firebase deploy' too (deploy.yml writes its own).
cat > "$ROOT/.firebaserc" <<JSON
{
  "projects": {
    "default": "${PROJECT_ID}"
  },
  "targets": {
    "${PROJECT_ID}": {
      "hosting": {
        "web": ["${FIREBASE_SITE}"]
      }
    }
  }
}
JSON

# ---- 6. GitHub repository variables (not secrets: none of these is one) --------------------------------------------
VARS=(GCP_PROJECT_ID="$PROJECT_ID" GCP_REGION="$REGION" WIF_PROVIDER="$WIF_PROVIDER" DEPLOY_SA="$DEPLOY_SA"
      FIREBASE_SITE="$FIREBASE_SITE")
[ -z "$BUCKET" ] || VARS+=(BUCKET="$BUCKET")
if [ "$SET_GITHUB" = "1" ]; then
  for kv in "${VARS[@]}"; do
    gh variable set "${kv%%=*}" --repo "$REPO" --body "${kv#*=}"
  done
  echo "Set the repository variables on $REPO"
else
  echo "Set these repository variables on $REPO (Settings > Secrets and variables > Actions > Variables):"
  for kv in "${VARS[@]}"; do echo "  gh variable set ${kv%%=*} --repo $REPO --body '${kv#*=}'"; done
fi

cat <<EOF

Done. A push to main now tests, then deploys:
  API and MCP (Cloud Run):     iris-api in $REGION, as $RUNTIME_SA
  Web app (Firebase Hosting):  https://${FIREBASE_SITE}.web.app
Run it now without a push:     gh workflow run deploy.yml --repo $REPO --ref main
A new identity pool or binding can take a few minutes before the first sign-in works.
EOF
