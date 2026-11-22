# Deploying Iris by Techjays to Google Cloud

Iris deploys as two parts. The FastAPI server (the API, MCP and the voice socket) runs on **Cloud Run** as the
service `iris-api`. The React web app runs on **Firebase Hosting**, expected at https://iris-techjays.web.app, and the
browser calls Cloud Run directly. GitHub Actions deploys both on every push to main ("Deploy on every push").

The image is the root `Dockerfile`, pushed to **Artifact Registry**. The model calls go to **Vertex AI** (Gemini)
using the service's own service account, so there is no key file. **Secret Manager** holds the owner token, and an
optional **Cloud Storage** bucket keeps settings across restarts.

The single-origin deploy still works. Run `deploy.sh` by hand with `IRIS_ALLOWED_ORIGINS` empty, and Cloud Build builds
the image and Cloud Run serves the web app and the API from one origin ("Deploy by hand").

| File | What it does |
|---|---|
| `../Dockerfile` | Two stages. Node 22 builds `web/` (`npm ci && npm run build`, with `VITE_API_BASE` empty, so the page calls its own origin). Then Python 3.13 slim gets the WeasyPrint and OpenCASCADE system libraries, runs `uv sync --frozen`, and copies the server, `web/dist` and `samples/`. The container runs `uvicorn iris.app:app` on `$PORT`. |
| `../.dockerignore` | Keeps `.env`, `.git`, `node_modules`, tests and docs out of the image, and keeps only the demo file types from `samples/`. |
| `../cloudbuild.yaml` | Builds the image and pushes `REGION-docker.pkg.dev/PROJECT/iris/iris:TAG` and `:latest`. `deploy.sh` uses it when you deploy by hand. Pushes to main do not use it. |
| `.gcloudignore` | The upload filter for `gcloud builds submit`. Without it, gcloud would use `.gitignore` and leave out the optional sample reports and STEP cache. |
| `setup.sh` | One-time setup: APIs, the Artifact Registry repo and its cleanup policy, the service account and its role, the secrets, and the optional bucket. |
| `github-setup.sh` | One-time setup for deploying from GitHub: runs `setup.sh`, then creates the deploy service account, Workload Identity Federation, Firebase Hosting and its site, writes `.firebaserc`, and sets the GitHub repository variables. |
| `deploy.sh` | Builds the image with Cloud Build (or takes `IMAGE`) and runs `gcloud run deploy iris-api` with the settings below. |
| `env.yaml` | The demo's caps and limits, set as plain env vars on the service. |
| `../.github/workflows/ci.yml` | CI: server tests, web tests and build, and VisionBench tests, on every pull request and push. |
| `../.github/workflows/deploy.yml` | Deploy: on a push to main, CI first, then the image, Cloud Run, the web build, Firebase Hosting, a smoke test and a summary. |
| `../firebase.json` | Firebase Hosting: target `web` serves `web/dist`, every path falls back to `/index.html`. Headers: `no-cache`, `nosniff` and `strict-origin-when-cross-origin` on everything; `/assets/**` (Vite's hashed files) cached a year, immutable; `**/*.wasm` served as `application/wasm`, cached an hour; `/demos/**` cached an hour. |
| `../.firebaserc` | The Firebase project and the site behind target `web` (`iris-techjays`). `github-setup.sh` writes it, and `deploy.yml` rewrites it from the repository variables on each run. |

## Deploy on every push

### What runs when

| Event | Workflow | What runs |
|---|---|---|
| A pull request | CI (`ci.yml`) | the three test jobs below. A newer push to the pull request cancels the older run. |
| A push to any branch except main | CI | the three test jobs |
| A push to main | Deploy (`deploy.yml`) | the three test jobs (it calls `ci.yml`), then the `deploy` job if they pass |
| `gh workflow run deploy.yml --ref main` | Deploy | the same as a push to main |

CI's jobs run on `ubuntu-24.04`. Each action is pinned to a commit SHA.

- **`server`** installs the system libraries the Dockerfile installs (Pango, HarfBuzz, a font, libGL), so the
  WeasyPrint PDF tests pass. It sets up uv with Python 3.13 (cache keyed on `server/uv.lock`), then runs
  `uv sync --frozen` and `uv run pytest -q --ignore=tests/bench`.
- **`web`** sets up Node 22 with the npm cache, then runs `npm ci`, `npm test` and `npm run build`.
- **`bench`** runs only when `server/tests/bench` exists. When `bench/render/package-lock.json` exists, it installs the
  renderer (`npm ci` and `npx playwright install --with-deps chromium` in `bench/render`). Then it runs
  `uv run pytest -q tests/bench`.

The `deploy` job runs only on `refs/heads/main`, because the identity pool trusts only main. Its steps run in this
order:

1. **Check the repository variables.** `GCP_PROJECT_ID`, `WIF_PROVIDER` and `DEPLOY_SA` must be set. Otherwise the
   job fails and points at `deploy/github-setup.sh`.
2. **Sign in, keyless.** `google-github-actions/auth` v3.0.0 exchanges GitHub's OIDC token through Workload Identity
   Federation (`vars.WIF_PROVIDER`) for the deploy service account (`vars.DEPLOY_SA`). v2 ran on Node 20, which
   GitHub has retired. Then `setup-gcloud` and `gcloud auth configure-docker REGION-docker.pkg.dev`.
3. **Build the image on the runner.** `docker buildx` builds the root `Dockerfile` with the GitHub Actions cache and
   pushes `REGION-docker.pkg.dev/PROJECT/iris/iris:<commit sha>`. No provenance or SBOM manifests are pushed, so the
   cleanup policy counts one image per push. Cloud Build is not used.
4. **Deploy the server.** `deploy/deploy.sh` runs with `IMAGE` (so it skips Cloud Build), `SERVICE=iris-api`,
   `IRIS_PUBLIC_URL=https://SITE.web.app`, `IRIS_ALLOWED_ORIGINS=https://SITE.web.app,https://SITE.firebaseapp.com`
   (plus `WEB_URL` and `EXTRA_ORIGINS` when set), `BUCKET=vars.BUCKET`, `GEMINI_API_KEY_SECRET=""` (no API key in the
   cloud) and `IRIS_VERSION=<commit sha>`. `deploy.sh` writes the service URL to `$GITHUB_OUTPUT`.
5. **Build the web app** with `VITE_API_BASE` set to the Cloud Run URL (or `vars.API_URL`), and check that the bundle
   contains it.
6. **Deploy the web app.** The job writes `.firebaserc` for `vars.FIREBASE_SITE` (default `iris-techjays`), then runs
   `npx firebase-tools@15.35.0 deploy --only hosting:web --project PROJECT --message "iris <short sha>"` with the same
   Workload Identity credentials.
7. **Smoke test.** The web page answers. `GET /api/health` on the API reports this commit. A CORS preflight from
   `https://SITE.web.app` to `/api/owner/unlock` gets `Access-Control-Allow-Origin` back.
8. **Summary.** The web app's URL, the API's URL and the image go to the job summary, even when a step failed.

Deploys share the concurrency group `deploy-<ref>`. A running deploy is never cancelled; a newer push waits its turn.

### One-time setup

Run these once, as a project Owner, from a checkout of the repo:

```bash
gcloud auth login && gcloud auth application-default login
gh auth login                  # lets the script set the repository variables
deploy/github-setup.sh         # defaults: gemini-enterprise-475109, asia-south1, Saravana-Rajan/IRIS
git push origin main           # or: gh workflow run deploy.yml --ref main
```

`github-setup.sh` needs `gcloud`, `curl` and `python3`. It takes these flags, or the same settings from the
environment:

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `--project` | `PROJECT_ID` | `gemini-enterprise-475109` | the Google Cloud project |
| `--region` | `REGION` | `asia-south1` | Cloud Run and Artifact Registry |
| `--repo` | `REPO` | `Saravana-Rajan/IRIS` | the GitHub repository that may deploy |
| `--site` | `FIREBASE_SITE` | see "The Hosting site" below | the Firebase Hosting site |
| `--bucket` | `BUCKET` | empty | an optional bucket for settings and the picture cache |
| `--no-github` | | | print the `gh variable set` commands instead of running them |

Without `gh`, or when it is not signed in, the script prints the commands too. It is safe to run again: what exists is
kept, bindings are added once, and the variables are set to the same values.

### What `github-setup.sh` creates

1. **APIs:** `run`, `artifactregistry`, `cloudbuild`, `iam`, `iamcredentials`, `sts`, `secretmanager`, `aiplatform`,
   `firebase`, `firebasehosting`, `cloudresourcemanager`, `serviceusage` and `storage`.
2. **The runtime, through `deploy/setup.sh`:** the Artifact Registry repo `iris` with its cleanup policy (the newest 5
   images), the runtime service account `iris-run` with `roles/aiplatform.user`, the `iris-owner-token` secret, and
   the bucket when `--bucket` is given. `GEMINI_API_KEY` is removed from `setup.sh`'s environment, so no key secret is
   made. When the owner-token secret has no version yet, the script makes a random token. It is never printed. Read it
   with `gcloud secrets versions access latest --secret iris-owner-token`.
3. **The deploy service account** `iris-deploy@PROJECT.iam.gserviceaccount.com`, with only what a deploy needs:

   | Role | On | For |
   |---|---|---|
   | `roles/run.admin` | the project | deploy the service and keep it public |
   | `roles/firebasehosting.admin` | the project | release the web app |
   | `roles/serviceusage.serviceUsageConsumer` | the project | call the project's APIs |
   | `roles/artifactregistry.writer` | the `iris` repo only | push images |
   | `roles/iam.serviceAccountUser` | `iris-run` only | deploy the service as `iris-run` |

   It has no Secret Manager role. Cloud Run reads the owner token as `iris-run`.
4. **Workload Identity Federation:** the pool `github-actions` and its OIDC provider `iris-github`, with the issuer
   `https://token.actions.githubusercontent.com`. The provider maps `google.subject`, `attribute.repository`,
   `attribute.repository_id` and `attribute.ref`. Its attribute condition is
   `assertion.repository == 'Saravana-Rajan/IRIS' && assertion.ref == 'refs/heads/main'`, plus
   `assertion.repository_id == '<id>'` when `gh` can read the repository's id. That pins the repository even if its
   name is reused later. The principal set
   `principalSet://iam.googleapis.com/projects/NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/Saravana-Rajan/IRIS`
   gets `roles/iam.workloadIdentityUser` on `iris-deploy`. A deleted pool or provider is restored, and a rerun updates
   the provider's mapping and condition.
5. **Firebase:** the script adds Firebase to the project (`addFirebase`) when it is missing, picks the Hosting site
   (below) and writes `.firebaserc`, for a local `firebase deploy` too.
6. **GitHub repository variables**, set with `gh variable set`. They are variables, not secrets, because none of them
   is secret:

   | Variable | Value |
   |---|---|
   | `GCP_PROJECT_ID` | the project |
   | `GCP_REGION` | the region |
   | `WIF_PROVIDER` | `projects/NUMBER/locations/global/workloadIdentityPools/github-actions/providers/iris-github` |
   | `DEPLOY_SA` | `iris-deploy@PROJECT.iam.gserviceaccount.com` |
   | `FIREBASE_SITE` | the Hosting site |
   | `BUCKET` | the bucket, only when `--bucket` is given |

**The Hosting site.** The site is `--site` (or `FIREBASE_SITE`) when given. Otherwise it is the one chosen on an
earlier run (the `FIREBASE_SITE` repository variable). Otherwise the script tries `iris-techjays`, then
`iris-by-techjays`, then `techjays-iris`, and takes the first that already exists in this project or can be created.
Site ids are global, so another project may hold one. When none is free, pass `--site <id>`. `deploy.yml` falls back
to `iris-techjays` when `FIREBASE_SITE` is unset.

**Optional repository variables** you set yourself (`gh variable set NAME --repo Saravana-Rajan/IRIS --body VALUE`):

| Variable | Meaning |
|---|---|
| `BUCKET` | the Cloud Storage bucket `deploy.sh` mounts at `/mnt/iris`. `github-setup.sh --bucket` creates it and sets this. |
| `API_URL` | the API's URL for the web build when it is not the Cloud Run URL (a custom domain). The smoke test checks `/api/health` there. |
| `WEB_URL` | the web app's own URL when it has a custom domain. It becomes `IRIS_PUBLIC_URL`, is added to `IRIS_ALLOWED_ORIGINS`, and is shown in the summary. |
| `EXTRA_ORIGINS` | more web origins for CORS, comma-separated |
| `MIN_INSTANCES` / `CPU_THROTTLING` | `1` / `0` keep one instance warm with CPU between requests (billed all the time); unset is the minimal `0` / `1` |

### Why Firebase does not proxy the API

Firebase Hosting can rewrite paths to Cloud Run, but those rewrites cut a request at 60 s and carry no WebSockets.
Iris streams NDJSON for minutes (proposals, triage, model uploads) and talks voice over a WebSocket. So Firebase serves
only the web app (`web/dist`), and the browser calls Cloud Run directly:

- the web build sets `VITE_API_BASE` to the Cloud Run URL. `web/src/api.ts` sends every server call there, with
  credentials, and opens the voice socket on the API's host;
- static files (the tour, demo clips, logos, `.wasm`) still come from Firebase;
- Cloud Run answers CORS only for the origins in `IRIS_ALLOWED_ORIGINS` (`server/iris/origins.py`).

Setting `IRIS_ALLOWED_ORIGINS` puts the service in split mode. It then serves only the API: `/api/*`, `/docs`,
`/openapi.json`, `/mcp` and the voice socket. It mounts no web app, and `GET /` answers
`{"service": "iris-api", "docs": "/docs", "health": "/api/health"}`. The owner cookie becomes
`SameSite=None; Secure; Partitioned`, so it travels on the page's cross-site calls. The details are in
`docs/architecture/17-deployment-and-operations.md`.

### Check a deploy

- **The job summary** of the Actions run lists the web app's URL, the API's URL and the image.
- **The health check** reports the deployed commit:

  ```bash
  URL=$(gcloud run services describe iris-api --project gemini-enterprise-475109 --region asia-south1 \
    --format='value(status.url)')
  curl -s "$URL/api/health"     # {"status":"ok","version":"<commit sha>"}
  ```

- **The service:** `gcloud run services describe iris-api --region asia-south1` shows the image, the revision, the
  env vars and the scaling. `gcloud run services logs read iris-api --region asia-south1 --limit 50` shows the logs.
- **The web app:** open https://iris-techjays.web.app (or the summary's URL), open the Northbank demo, and propose a
  fix once.

### Roll back

**Cloud Run.** Either send the traffic back to an earlier revision, or deploy an older image:

```bash
# a) An earlier revision serves again at once. Nothing is rebuilt.
gcloud run revisions list --service iris-api --region asia-south1
gcloud run services update-traffic iris-api --region asia-south1 --to-revisions <revision>=100
#    Later, let new revisions serve again:
gcloud run services update-traffic iris-api --region asia-south1 --to-latest

# b) An older image as a new revision. The env vars, secrets and scaling stay as they are.
gcloud run deploy iris-api --region asia-south1 \
  --image asia-south1-docker.pkg.dev/gemini-enterprise-475109/iris/iris:<older sha> \
  --update-env-vars IRIS_VERSION=<older sha>
```

With (a), the traffic stays on that revision until `--to-latest`. A push in between deploys a revision that serves
nothing, and its smoke test fails, because `/api/health` still reports the old commit. With (b), the next push
replaces it as usual. Only the newest 5 images are kept, so the oldest image you can go back to is about four pushes
old, and a revision whose image was deleted cannot start.

**Firebase Hosting.** In the Firebase console, open Hosting, the site, and its release history, and roll back to an
earlier release. Each release's message is `iris <short sha>`. From the CLI, clone an earlier version onto the live
channel: `npx firebase-tools hosting:clone iris-techjays@<version id> iris-techjays:live`.

A rolled-back web app still calls the current API, and the reverse. When a change spans both, roll back both, or
revert the commit and push: the pipeline then redeploys both from the reverted code.

## What it creates (minimal footprint)

The Google Cloud footprint is kept small on purpose (owner decision, 2026-11-22):

| Part | What |
|---|---|
| Cloud Run | one service, `iris-api`: min 0, max 1 instance; 2 vCPU, 4 GiB; CPU only while a request is open |
| Artifact Registry | one repo, `iris`, keeping the newest 5 images |
| Firebase | Hosting only, one site |
| Identity | one Workload Identity pool with one provider, one deploy service account (`iris-deploy`), one runtime service account (`iris-run`) |
| Secrets | `iris-owner-token` only. No Gemini API key in the cloud: Cloud Run reaches Gemini through Vertex AI as `iris-run` (`roles/aiplatform.user`). |
| Keys | no JSON keys anywhere |
| Storage | a bucket only when you ask for one |

There is no load balancer, no custom domain, no Cloud Build trigger and no database.

The trade-offs:

- **Scale to zero.** The first request after an idle spell waits for a cold start (a few seconds; `--cpu-boost`
  helps). The open models, edits and cap counters live in the process's memory, so they are lost then.
- **CPU only during requests.** Work that outlives its request, such as triage and title runs or the work behind a
  stream nobody is reading, runs slowly until the next request.
- **To restore the always-warm behaviour,** deploy with `MIN_INSTANCES=1` and `CPU_THROTTLING=0`. Both are then billed
  all the time. On every push `deploy.yml` passes the repository variables `MIN_INSTANCES` and `CPU_THROTTLING`; unset,
  they are 0 and 1 again. To keep one instance warm through pushes, set them
  (`gh variable set MIN_INSTANCES --body 1`, `gh variable set CPU_THROTTLING --body 0`); delete them to go back. A
  `gcloud run services update iris-api --region asia-south1 --min-instances 1 --no-cpu-throttling` by hand lasts only
  until the next push.

## Custom domains (optional)

The web app can move to `iris.techjays.com` and the API to `api.iris.techjays.com`. Minimal config still applies:
min-instances 0, max 1, no load balancer.

**Frontend on Firebase Hosting.**

1. In the Firebase console, open Hosting, then the site (`iris-techjays`), then **Add custom domain**, and enter
   `iris.techjays.com`.
2. At the DNS host for `techjays.com`, add the TXT and A records Firebase shows. The certificate is automatic.
3. Set the repository variable and push (or run the workflow):

   ```bash
   gh variable set WEB_URL --repo Saravana-Rajan/IRIS --body https://iris.techjays.com
   ```

   `deploy.yml` then uses it as `IRIS_PUBLIC_URL`, adds it to `IRIS_ALLOWED_ORIGINS`, and shows it in the summary.

**Backend through Cloud Run domain mapping.**

```bash
gcloud domains verify techjays.com          # once, if the domain is not yet verified for your account
gcloud beta run domain-mappings create --service iris-api --domain api.iris.techjays.com --region asia-south1
```

Add the DNS records the command prints. Cloud Run domain mapping is not available in every region. If asia-south1
lacks it, keep the backend on its `run.app` URL, which visitors never see because only the page calls it, and put only
the frontend on the custom domain. With the backend mapped, set `API_URL` and push:

```bash
gh variable set API_URL --repo Saravana-Rajan/IRIS --body https://api.iris.techjays.com
```

The web build then calls that URL, and the smoke test checks `/api/health` there, so the mapping must be live first.

**Why both.** With the page and the API both under `techjays.com`, the owner cookie is same-site (first-party), so
browsers that block third-party cookies keep it.

## Limitations

- **The cross-site owner cookie.** In split mode the page and the API are on different sites, so the owner cookie is a
  third-party cookie. Safari and other browsers that block third-party cookies may not send it, even with
  `SameSite=None; Partitioned`. Partitioned cookies (CHIPS) get through where the browser supports them. The split
  Cloud Run service serves no web app, so there is no page to unlock on there. Two fallbacks work: custom domains
  under one site (above), so the cookie is first-party, or the plain one-origin deploy (`deploy.sh` by hand with
  `IRIS_ALLOWED_ORIGINS` empty).
- **CI images have only what git has.** The gitignored, optional `samples/reports/` and `samples/step-cache/` are not
  in them. `deploy.sh` run from a machine that has them still bakes them in, until the next push replaces the image.
- **The first sign-in** after `github-setup.sh` creates the pool or its bindings can fail for a few minutes while they
  propagate. Run the workflow again.
- **Firebase API keys.** If `firebase-tools` ever needs to read the project's API keys during a hosting deploy and
  fails with 403, grant `roles/serviceusage.apiKeysViewer` to `iris-deploy`. It is not granted by default, because
  it can reveal key strings.

## Deploy by hand

`deploy.sh` from your machine builds the image with Cloud Build and deploys it. With `IRIS_ALLOWED_ORIGINS` empty (the
default), the service serves the web app and the API from one origin. The sections below are for that path.

Every deploy replaces the service's env vars (`--env-vars-file`). A run by hand against `iris-api` without
`IRIS_ALLOWED_ORIGINS` therefore turns split mode off, and the Firebase page can no longer call it until the next
push. For a one-origin service next to the pipeline's, set another `SERVICE`. It is a separate instance with its own
memory.

An earlier manual deploy made a service named `iris`. Nothing uses it now, and it can be deleted:
`gcloud run services delete iris --region asia-south1`.

### Prerequisites

- The `gcloud` CLI, signed in (`gcloud auth login`), with a project that has billing enabled.
- You need Owner, or Editor plus Project IAM Admin and Secret Manager Admin, for the one-time setup. For later deploys
  you need `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/iam.serviceAccountUser` on the service account,
  and `roles/artifactregistry.writer`.
- Optional files go in `samples/` before you build (see `samples/README.md`): `samples/reports/<name>/` for sample
  clash reports and `samples/step-cache/` for the converted STEP demo. They are gitignored but are still uploaded and
  baked into the image.

### One-time setup

`github-setup.sh` runs `setup.sh` already. Without it, you can run the script:

```bash
export GOOGLE_CLOUD_PROJECT=gemini-enterprise-475109
export REGION=asia-south1                       # Cloud Run, Artifact Registry, Cloud Build
export IRIS_OWNER_TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')   # 24+ characters
# export GEMINI_API_KEY=...                     # optional, only if the server should use an API key over Vertex AI
# export BUCKET=$GOOGLE_CLOUD_PROJECT-iris-data # optional: settings and picture cache survive restarts
# export KEEP_IMAGES=5                          # images the cleanup policy keeps (default 5)
deploy/setup.sh
```

Or run the same steps by hand:

```bash
PROJECT=$GOOGLE_CLOUD_PROJECT; REGION=asia-south1; SA=iris-run@$PROJECT.iam.gserviceaccount.com

# 1. APIs
gcloud services enable run.googleapis.com aiplatform.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com storage.googleapis.com

# 2. Artifact Registry repository for the images, keeping the newest 5 (applied about once a day)
gcloud artifacts repositories create iris --repository-format docker --location $REGION
cat > /tmp/iris-cleanup.json <<'JSON'
[
  {"name": "keep-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies iris --location $REGION --policy /tmp/iris-cleanup.json \
  --no-dry-run

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

### Deploy

```bash
GOOGLE_CLOUD_PROJECT=gemini-enterprise-475109 deploy/deploy.sh
# with the bucket:
GOOGLE_CLOUD_PROJECT=gemini-enterprise-475109 BUCKET=gemini-enterprise-475109-iris-data deploy/deploy.sh
```

`deploy.sh` runs `gcloud builds submit` with `cloudbuild.yaml` (skipped when `IMAGE` is set), then
`gcloud run deploy iris-api`. You can override any of its settings from the environment:

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | `gcloud config get-value project` | the project. It is also passed to the service. |
| `REGION` | `asia-south1` | the region for Cloud Run, Artifact Registry and Cloud Build |
| `SERVICE` | `iris-api` | the Cloud Run service |
| `AR_REPO` | `iris` | the Artifact Registry repository |
| `GOOGLE_CLOUD_LOCATION` | `global` | the Vertex AI location for Gemini calls. It is independent of `REGION`. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | the main model (proposals, chat, plans, reports). Flash for every role since Nov 22 (owner decision). |
| `GEMINI_FAST_MODEL` | `gemini-3.8-flash` | bulk and quick work (triage, titles) |
| `GEMINI_ESCALATION_MODEL` | `gemini-3.8-flash` | second tries and picture judges, at thinking level `high` |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | Show it built |
| `GEMINI_THINKING_LEVEL` | `low` | thinking level sent with Gemini calls |
| `GEMINI_ESCALATION_THINKING_LEVEL` | `high` | thinking level for the escalation model |
| `SERVICE_ACCOUNT` | `iris-run@PROJECT.iam.gserviceaccount.com` | the runtime identity |
| `OWNER_TOKEN_SECRET` | `iris-owner-token` | the owner token's Secret Manager name |
| `GEMINI_API_KEY_SECRET` | `iris-gemini-api-key` | the optional API key's secret, mounted only if it exists. `""` never mounts one (CI sets that). |
| `BUCKET` | empty | the Cloud Storage bucket to mount at `/mnt/iris`. It sets `IRIS_SETTINGS_FILE` and `IRIS_BUILT_CACHE`. |
| `MIN_INSTANCES` | `0` | the service scales to zero when idle. `1` keeps one instance warm, billed all the time. |
| `CPU_THROTTLING` | `1` | `--cpu-throttling`: CPU only while a request is open. `0` gives `--no-cpu-throttling`: CPU between requests too, billed all the time. |
| `CPU` / `MEMORY` / `CONCURRENCY` / `TIMEOUT` | `2` / `4Gi` / `64` / `600` | the container shape |
| `IMAGE` | `REGION-docker.pkg.dev/PROJECT/AR_REPO/iris:TAG` | set: deploy that image as it is and skip Cloud Build (CI builds its own) |
| `IRIS_PUBLIC_URL` | `https://iris-api-PROJECT_NUMBER.REGION.run.app` | the site URL that MCP clients show. When set, the script skips `gcloud projects describe`. CI sets the web app's URL. |
| `IRIS_ALLOWED_ORIGINS` | empty | the web app's other origins, comma-separated. Set: split mode (CORS with credentials, the cross-site owner cookie, the API only). Empty: one origin. |
| `IRIS_VERSION` | the image tag | what `GET /api/health` reports. CI sets the commit SHA. |
| `ALLOW_UNAUTHENTICATED` | `1` | `0` makes the service private (IAM-only) |
| `TAG` | `<git short sha>-<timestamp>` | the image tag |

`--max-instances` is always 1. Open scenes, edits, caps and the day's spend all live in the one process's memory, so a
second instance would answer "Model not loaded" to half the requests. `--cpu-boost` is always on, for faster cold
starts. When run in GitHub Actions, the script writes `url=<service URL>` to `$GITHUB_OUTPUT`.

### CI

No Cloud Build trigger is used. Pushes to main build the image on the GitHub runner and deploy it: see "Deploy on
every push". `cloudbuild.yaml` is what `deploy.sh` uses when you deploy by hand.

### After a deploy

```bash
URL=$(gcloud run services describe iris-api --region asia-south1 --format='value(status.url)')
curl -s "$URL/api/health"                         # {"status":"ok","version":"<tag>"}
curl -sI "$URL" | head -1                         # 200: the web app is served (one origin)
gcloud run services logs read iris-api --region asia-south1 --limit 50
```

Next, open the URL, open the Northbank demo, and propose a fix once. Then test that a stream is not buffered (see
`docs/architecture/17-deployment-and-operations.md`).

## Running the image locally

```bash
docker build -t iris .
docker run --rm -p 8080:8080 \
  -e GOOGLE_CLOUD_PROJECT=gemini-enterprise-475109 -e GOOGLE_CLOUD_LOCATION=global \
  -v "$HOME/.config/gcloud:/home/iris/.config/gcloud:ro" \
  iris
```

The `-v` line lets the container use your own Application Default Credentials (`gcloud auth application-default
login`). Leave it out to run without model calls.
