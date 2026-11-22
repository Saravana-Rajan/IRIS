# Deploying Iris by Techjays to Google Cloud

Iris runs on **Cloud Run** as one container that serves the built web app and the API from one origin. Cloud Build
builds the root `Dockerfile` and pushes the image to **Artifact Registry**. The model calls go to **Vertex AI**
(Gemini) using the service's own service account, so there is no key file. **Secret Manager** holds the secrets, and
an optional **Cloud Storage** bucket keeps settings across restarts.

| File | What it does |
|---|---|
| `../Dockerfile` | Two stages. Node 22 builds `web/` (`npm ci && npm run build`). Then Python 3.13 slim gets the WeasyPrint and OpenCASCADE system libraries, runs `uv sync --frozen`, and copies the server, `web/dist` and `samples/`. The container runs `uvicorn iris.app:app` on `$PORT`. |
| `../.dockerignore` | Keeps `.env`, `.git`, `node_modules`, tests and docs out of the image, and keeps only the demo file types from `samples/`. |
| `../cloudbuild.yaml` | Builds the image and pushes `REGION-docker.pkg.dev/PROJECT/iris/iris:TAG` and `:latest`. Use it from `deploy.sh` or from a CI trigger. |
| `.gcloudignore` | The upload filter for `gcloud builds submit`. Without it, gcloud would use `.gitignore` and leave out the optional sample reports and STEP cache. |
| `setup.sh` | One-time setup: APIs, the Artifact Registry repo, the service account and its role, the secrets, and the optional bucket. |
| `deploy.sh` | Builds the image and runs `gcloud run deploy iris` with the settings below. |
| `env.yaml` | The demo's caps and limits, set as plain env vars on the service. |

## Prerequisites

- The `gcloud` CLI, signed in (`gcloud auth login`), with a project that has billing enabled.
- You need Owner, or Editor plus Project IAM Admin and Secret Manager Admin, for the one-time setup. For later deploys
  you need `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/iam.serviceAccountUser` on the service account,
  and `roles/artifactregistry.writer`.
- Optional files go in `samples/` before you build (see `samples/README.md`): `samples/reports/<name>/` for sample
  clash reports and `samples/step-cache/` for the converted STEP demo. They are gitignored but are still uploaded and
  baked into the image.

## One-time setup

You can run the script:

```bash
export GOOGLE_CLOUD_PROJECT=my-project
export REGION=asia-south1                       # Cloud Run, Artifact Registry, Cloud Build
export IRIS_OWNER_TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')   # 24+ characters
# export GEMINI_API_KEY=...                     # optional, only if the server should use an API key over Vertex AI
# export BUCKET=$GOOGLE_CLOUD_PROJECT-iris-data # optional: settings and picture cache survive restarts
deploy/setup.sh
```

Or run the same steps by hand:

```bash
PROJECT=$GOOGLE_CLOUD_PROJECT; REGION=asia-south1; SA=iris-run@$PROJECT.iam.gserviceaccount.com

# 1. APIs
gcloud services enable run.googleapis.com aiplatform.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com storage.googleapis.com

# 2. Artifact Registry repository for the images
gcloud artifacts repositories create iris --repository-format docker --location $REGION

# 3. A dedicated runtime service account that may call Vertex AI (Gemini). Cloud Run gives the container this
#    identity through the metadata server: no key file is created or mounted.
gcloud iam service-accounts create iris-run --display-name "Iris on Cloud Run"
gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/aiplatform.user

# 4. Secrets. Values are piped in and never echoed.
gcloud secrets create iris-owner-token --replication-policy automatic
printf '%s' "$IRIS_OWNER_TOKEN" | gcloud secrets versions add iris-owner-token --data-file=-
gcloud secrets add-iam-policy-binding iris-owner-token --member serviceAccount:$SA \
  --role roles/secretmanager.secretAccessor
#    Optional API key (deploy.sh mounts it as GEMINI_API_KEY only if the secret exists):
# gcloud secrets create iris-gemini-api-key --replication-policy automatic
# printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add iris-gemini-api-key --data-file=-
# gcloud secrets add-iam-policy-binding iris-gemini-api-key --member serviceAccount:$SA \
#   --role roles/secretmanager.secretAccessor

# 5. Optional bucket, mounted at /mnt/iris with Cloud Storage FUSE
# gcloud storage buckets create gs://$PROJECT-iris-data --location $REGION --uniform-bucket-level-access
# gcloud storage buckets add-iam-policy-binding gs://$PROJECT-iris-data --member serviceAccount:$SA \
#   --role roles/storage.objectUser
```

**The Cloud Build service account.** Builds run as the project's Cloud Build service account. On newer projects
that is the Compute Engine default service account. It must be able to push to the repo. If a build fails with a
permission error on push, grant it access:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud artifacts repositories add-iam-policy-binding iris --location $REGION \
  --member serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com --role roles/artifactregistry.writer
```

## Deploy

```bash
GOOGLE_CLOUD_PROJECT=my-project deploy/deploy.sh
# with the bucket:
GOOGLE_CLOUD_PROJECT=my-project BUCKET=my-project-iris-data deploy/deploy.sh
```

`deploy.sh` runs `gcloud builds submit` with `cloudbuild.yaml`, then `gcloud run deploy iris`. You can override
any of its settings from the environment:

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | `gcloud config get-value project` | the project. It is also passed to the service. |
| `REGION` | `asia-south1` | the region for Cloud Run, Artifact Registry and Cloud Build |
| `GOOGLE_CLOUD_LOCATION` | `global` | the Vertex AI location for Gemini calls. It is independent of `REGION`. |
| `GEMINI_MODEL` | `gemini-4-argon` | the main model (proposals, chat, plans, reports) |
| `GEMINI_FAST_MODEL` | `gemini-3.8-flash` | bulk and quick work (triage, titles) |
| `GEMINI_ESCALATION_MODEL` | `gemini-4-argon` | second tries and picture judges |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | Show it built |
| `GEMINI_THINKING_LEVEL` | `low` | thinking level sent with Gemini calls |
| `GEMINI_ESCALATION_THINKING_LEVEL` | `high` | thinking level for the escalation model |
| `SERVICE_ACCOUNT` | `iris-run@PROJECT.iam.gserviceaccount.com` | the runtime identity |
| `OWNER_TOKEN_SECRET` / `GEMINI_API_KEY_SECRET` | `iris-owner-token` / `iris-gemini-api-key` | Secret Manager names |
| `BUCKET` | empty | the Cloud Storage bucket to mount at `/mnt/iris`. It sets `IRIS_SETTINGS_FILE` and `IRIS_BUILT_CACHE`. |
| `MIN_INSTANCES` | `1` | `0` lets the service scale to zero. A cold start then loses open models. |
| `CPU` / `MEMORY` / `CONCURRENCY` / `TIMEOUT` | `2` / `4Gi` / `64` / `600` | the container shape |
| `IRIS_PUBLIC_URL` | `https://iris-PROJECT_NUMBER.REGION.run.app` | the site URL that MCP clients show |
| `ALLOW_UNAUTHENTICATED` | `1` | `0` makes the service private (IAM-only) |
| `TAG` | `<git short sha>-<timestamp>` | the image tag |

`--max-instances` is always 1. Open scenes, edits, caps and the day's spend all live in the one process's memory, so a
second instance would answer "Model not loaded" to half the requests.

## CI

To build in CI, create a Cloud Build trigger on the main branch that uses `cloudbuild.yaml` and has the substitution
`_REGION=asia-south1`. When `_TAG` is empty, the tag is the commit's short SHA. To deploy an image the trigger built:

```bash
gcloud run deploy iris --region asia-south1 \
  --image asia-south1-docker.pkg.dev/$PROJECT/iris/iris:<sha>
```

Only the image changes in that case. The env vars, secrets, scaling and volume stay as the last `deploy.sh` run set
them.

## After a deploy

```bash
URL=$(gcloud run services describe iris --region asia-south1 --format='value(status.url)')
curl -sI "$URL" | head -1                         # 200: the web app is served
gcloud run services logs read iris --region asia-south1 --limit 50
```

Next, open the URL, open the Northbank demo, and propose a fix once. Then test that a stream is not buffered (see
`docs/architecture/17-deployment-and-operations.md`).

## Running the image locally

```bash
docker build -t iris .
docker run --rm -p 8080:8080 \
  -e GOOGLE_CLOUD_PROJECT=my-project -e GOOGLE_CLOUD_LOCATION=global \
  -v "$HOME/.config/gcloud:/home/iris/.config/gcloud:ro" \
  iris
```

The `-v` line lets the container use your own Application Default Credentials (`gcloud auth application-default
login`). Leave it out to run without model calls.
