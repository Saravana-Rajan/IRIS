#!/usr/bin/env bash
# Which parts of Iris a deploy has to ship: the server (image + Cloud Run), the web app (Firebase Hosting), both or
# neither. Reads the files changed between BASE (the commit the last successful deploy shipped) and HEAD.
#
#   deploy/changed-parts.sh BASE [HEAD]      prints   server=0|1   web=0|1   (lines for $GITHUB_OUTPUT)
#
# Conservative by design: a file it does not know deploys both, and a missing or unrelated BASE deploys both.
#   none    docs/, bench/, evals/, assets/, spikes/, the tests (server/tests, web/tests), server/iris_bench/ and the
#           root *.md files: none of them reaches the image (.dockerignore, the Dockerfile's COPYs) or web/dist.
#   web     web/ and the Firebase config. The image also carries web/dist, but the Cloud Run service is the API only
#           (IRIS_ALLOWED_ORIGINS set), so a web-only change leaves it alone.
#   server  server/, samples/, Dockerfile, .dockerignore, deploy/, cloudbuild.yaml.
#   both    .github/ (the pipeline itself) and anything else.
set -euo pipefail

BASE="${1:-}"
HEAD="${2:-HEAD}"
server=0
web=0

if [ -z "$BASE" ] || ! git cat-file -e "${BASE}^{commit}" 2>/dev/null \
   || ! git merge-base --is-ancestor "$BASE" "$HEAD" 2>/dev/null; then
  echo "No usable base (${BASE:-none}): deploying both" >&2
  printf 'server=1\nweb=1\n'
  exit 0
fi

# --no-renames: a rename lists both paths, and needs no file contents (the checkout is blobless).
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    docs/*|bench/*|evals/*|assets/*|spikes/*|web/spikes/*|server/tests/*|web/tests/*|server/iris_bench/*) part=none ;;
    */*) case "$f" in
           web/*) part=web ;;
           server/*|samples/*|deploy/*) part=server ;;
           *) part=both ;;   # .github/ and any folder not listed above
         esac ;;
    *.md|.gitignore|.gitattributes|.env.example) part=none ;;
    firebase.json|.firebaserc) part=web ;;
    Dockerfile|.dockerignore|cloudbuild.yaml) part=server ;;
    *) part=both ;;
  esac
  echo "  $part  $f" >&2
  case "$part" in
    web) web=1 ;;
    server) server=1 ;;
    both) server=1; web=1 ;;
  esac
done < <(git diff --name-only --no-renames "$BASE" "$HEAD")

printf 'server=%s\nweb=%s\n' "$server" "$web"
