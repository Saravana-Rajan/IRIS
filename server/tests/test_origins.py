"""The web app on another origin (Firebase Hosting) calling the API here (Cloud Run): CORS with credentials and the
owner cookie, for exactly the origins in IRIS_ALLOWED_ORIGINS (origins.py), and nothing when none are set."""
import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Route

from iris import app as app_module
from iris import origins

SITE = "https://iris-test.web.app"
OTHER = "https://elsewhere.example"
TOKEN = "t" * 40
ASKED = "content-type,x-iris-settings,x-iris-requirements"


@pytest.fixture
def cross(monkeypatch):
    monkeypatch.setenv("IRIS_ALLOWED_ORIGINS", f"{SITE}, https://iris-test.firebaseapp.com/")
    monkeypatch.setenv("IRIS_OWNER_TOKEN", TOKEN)
    return TestClient(app_module.app, base_url="https://testserver")  # the cookie is Secure


def _preflight(c: TestClient, origin: str):
    return c.options("/api/owner/unlock", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                   "Access-Control-Request-Headers": ASKED})


def test_the_web_apps_preflight_is_allowed_with_credentials(cross):
    r = _preflight(cross, SITE)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == SITE
    assert r.headers["access-control-allow-credentials"] == "true"
    assert {"GET", "POST", "PUT", "DELETE"} <= {m.strip() for m in r.headers["access-control-allow-methods"].split(",")}
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "x-iris-settings" in allowed and "x-iris-requirements" in allowed and "content-type" in allowed
    assert _preflight(cross, "https://iris-test.firebaseapp.com").headers["access-control-allow-origin"] \
        == "https://iris-test.firebaseapp.com"


def test_another_sites_preflight_is_refused(cross):
    r = _preflight(cross, OTHER)
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers


def test_a_credentialed_call_from_the_web_app_is_readable_and_its_owner_cookie_travels_cross_site(cross):
    r = cross.post("/api/owner/unlock", json={"token": TOKEN}, headers={"Origin": SITE})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == SITE and r.headers["access-control-allow-credentials"] == "true"
    assert "x-iris-gone" in r.headers["access-control-expose-headers"].lower()
    cookie = r.headers["set-cookie"].lower()
    assert "samesite=none" in cookie and "secure" in cookie and "partitioned" in cookie
    assert "httponly" in cookie and "path=/api" in cookie and "samesite=strict" not in cookie
    r = cross.get("/api/owner", headers={"Origin": SITE})  # the cookie comes back: the owner
    assert r.json()["owner"] is True and r.headers["access-control-allow-origin"] == SITE
    assert "origin" in r.headers["vary"].lower()  # a cache never hands one origin's answer to another
    cleared = cross.post("/api/owner/lock", headers={"Origin": SITE}).headers["set-cookie"].lower()
    assert "samesite=none" in cleared and "partitioned" in cleared and "max-age=0" in cleared
    assert cross.get("/api/owner").json()["owner"] is False


def test_another_sites_call_gets_no_cors_headers(cross):
    r = cross.get("/api/owner", headers={"Origin": OTHER})
    assert r.status_code == 200  # answered, but with no Allow-Origin the browser keeps it from that page
    assert "access-control-allow-origin" not in r.headers


def test_with_no_origins_configured_there_is_no_cors_and_the_cookie_stays_strict(monkeypatch):
    monkeypatch.delenv("IRIS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("IRIS_OWNER_TOKEN", TOKEN)
    c = TestClient(app_module.app, base_url="https://testserver")
    assert "access-control-allow-origin" not in _preflight(c, SITE).headers
    r = c.post("/api/owner/unlock", json={"token": TOKEN}, headers={"Origin": SITE})
    assert "access-control-allow-origin" not in r.headers
    cookie = r.headers["set-cookie"].lower()
    assert "samesite=strict" in cookie and "partitioned" not in cookie


def test_streams_keep_identity_encoding_across_origins(cross):
    """The real middleware around a stream made the way every route makes one (app._ndjson)."""
    async def stream(_request):
        return app_module._ndjson(iter(['{"type": "progress"}\n', '{"type": "done"}\n']))

    c = TestClient(app_module._CrossOrigin(Starlette(routes=[Route("/stream", stream)])))
    r = c.get("/stream", headers={"Origin": SITE, "Accept-Encoding": "gzip, deflate, br, zstd"})
    assert r.headers["content-encoding"] == "identity" and r.headers["access-control-allow-origin"] == SITE
    assert r.text == '{"type": "progress"}\n{"type": "done"}\n'


def test_origins_are_normalised_and_a_malformed_one_is_refused(monkeypatch):
    monkeypatch.setenv("IRIS_ALLOWED_ORIGINS", " https://Iris-Test.web.app/ ,,https://iris-test.web.app,http://localhost:5173")
    assert origins.allowed() == ("https://iris-test.web.app", "http://localhost:5173")
    assert origins.allows("https://iris-test.web.app") and not origins.allows(None) and not origins.allows(OTHER)
    for bad in ("*", "https://iris.web.app/app", "iris.web.app", "https://*.web.app"):
        monkeypatch.setenv("IRIS_ALLOWED_ORIGINS", bad)
        with pytest.raises(ValueError):
            origins.allowed()


def test_health_is_cheap_and_names_the_deployed_commit(monkeypatch):
    monkeypatch.delenv("IRIS_VERSION", raising=False)
    c = TestClient(app_module.app)
    assert c.get("/api/health").json() == {"status": "ok", "version": "dev"}
    monkeypatch.setenv("IRIS_VERSION", "0123abc")
    assert c.get("/api/health").json() == {"status": "ok", "version": "0123abc"}


def test_split_the_api_answers_its_root_with_where_to_look_and_serves_no_web_app(cross):
    r = cross.get("/")
    assert r.status_code == 200 and r.json() == {"service": "iris-api", "docs": "/docs", "health": "/api/health"}


def test_one_origin_the_root_is_the_web_app(monkeypatch, tmp_path):
    monkeypatch.delenv("IRIS_ALLOWED_ORIGINS", raising=False)
    (tmp_path / "index.html").write_text("<!doctype html><title>Iris</title>")
    monkeypatch.setattr(app_module, "WEB_DIST", tmp_path)
    r = TestClient(app_module.app).get("/")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html") and "<title>Iris" in r.text
