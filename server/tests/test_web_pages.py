"""The built web app's pages (app._WebApp): a browser asking for one of the app's pages gets index.html; an /api route,
a file or anything that walks up stays a 404."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from iris.app import _WebApp

HTML = {"accept": "text/html,application/xhtml+xml,*/*;q=0.8"}


def _client(tmp_path) -> TestClient:
    (tmp_path / "index.html").write_text("<!doctype html><title>Iris</title>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("x", encoding="utf-8")
    app = FastAPI()

    @app.get("/api/projects/{pid}")
    def project(pid: str):
        return {"id": pid}

    app.mount("/", _WebApp(directory=tmp_path, html=True), name="web")
    return TestClient(app)


def test_the_app_s_pages_are_the_app(tmp_path):
    c = _client(tmp_path)
    for path in ["/", "/home", "/projects", "/projects/abc", "/projects/abc/clashes/3", "/workspace", "/about/fixes", "/settings"]:
        r = c.get(path, headers=HTML)
        assert r.status_code == 200 and "<title>Iris</title>" in r.text, path
    assert c.get("/assets/app.js").text == "x"


def test_api_files_and_anything_else_stay_404(tmp_path):
    c = _client(tmp_path)
    for path in ["/api/nope", "/api/projects/a/b", "/api/projects/..%2F..%2Fetc", "/mcp/x", "/docs/x", "/openapi.json.bak",
                 "/assets/missing.js", "/wasm/web-ifc.wasm", "/favicon.ico", "/projects/abc/app.js", "/elsewhere",
                 "/projects/..%2F..%2Fetc", "/projects/%2e%2e/secret", "/home/..%5c..%5cwin"]:
        assert c.get(path, headers=HTML).status_code == 404, path


def test_only_a_browser_page_request_gets_the_app(tmp_path):
    c = _client(tmp_path)
    assert c.get("/projects/abc", headers={"accept": "application/json"}).status_code == 404
    assert c.post("/projects/abc", headers=HTML).status_code in (404, 405)
