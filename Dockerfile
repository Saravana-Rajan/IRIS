# Iris on Cloud Run: one container serves the built web app and the API from one origin. With IRIS_ALLOWED_ORIGINS set
# (the GitHub deploy: the web app is on Firebase Hosting) the same image serves the API only (server/iris/origins.py).
#
#   docker build -t iris .            # local
#   deploy/deploy.sh                  # Cloud Build + Cloud Run (see deploy/README.md)
#
# Layout inside the image mirrors the repo, because the server finds its neighbours by path:
#   /app/server/iris   the FastAPI app (iris.app:app)
#   /app/web/dist      the built web app, mounted at / (app.WEB_DIST = parents[2] / "web" / "dist")
#   /app/samples       demo models and optional sample reports (service.SAMPLES = parents[2] / "samples")
# The repo's .env is never copied (.dockerignore): settings come from Cloud Run env vars and Secret Manager.

# ---- 1. web: build the Vite React app --------------------------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
# postinstall (scripts/copy-wasm.mjs) copies web-ifc's .wasm into public/wasm/, so scripts/ must exist before npm ci.
COPY web/package.json web/package-lock.json ./
COPY web/scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. app: Python 3.13 + the server's locked dependencies ----------------------------------------------------
FROM python:3.13-slim-bookworm AS app

# WeasyPrint (PDF reports) needs Pango, HarfBuzz and a font; OpenCASCADE's Python bindings (cadquery-ocp, STEP
# models) link libGL and X11, which libgl1 pulls in. ifcopenshell ships self-contained wheels.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fonts-dejavu-core \
      libgl1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/server/.venv \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/server
# Dependencies first (cached layer), then the code. The server has no build-system, so only deps are installed.
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/iris ./iris

COPY --from=web /app/web/dist /app/web/dist
# Filtered by .dockerignore to .ifc/.step/.stp/.json/.xml/.png/.jpg/.jpeg (the demo file types).
COPY samples /app/samples

RUN useradd --create-home --uid 10001 iris \
 && mkdir -p /mnt/iris \
 && chown -R iris /app/server /mnt/iris
USER iris

ENV PATH="/app/server/.venv/bin:$PATH" \
    PORT=8080
EXPOSE 8080

# One worker: open scenes, edits, caps and spend live in this process's memory. uvicorn adds the cwd (/app/server)
# to sys.path. Proxy headers stay at uvicorn's default (trusted only from 127.0.0.1), so the peer is Google's front
# end and limits.client_id reads X-Forwarded-For via IRIS_TRUST_FORWARDED instead.
CMD ["sh", "-c", "exec uvicorn iris.app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --timeout-keep-alive 75"]
