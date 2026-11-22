"""The repo's .env reaches every setting, including those modules read at import; real environment variables win, and
an empty number is the same as an unset one.

Each case starts a fresh interpreter on a copy of the package with its own .env two folders above it (where
`model_client.ENV_FILE` looks), so neither the developer's .env nor the modules this process has imported play a part.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from iris.limits import env_float, env_int

PKG = Path(__file__).resolve().parents[1] / "iris"

# What the server read, after importing it the way uvicorn does (`iris.app`).
PROBE = """
import json
import iris.app as app
from iris import built, context_planner, scene, service, step
print(json.dumps({
    "package": app.__file__,
    "IRIS_MAX_SCENES": service.MAX_SCENES,
    "IRIS_SCENE_BUDGET_MB": service.SCENE_BUDGET_MB,
    "IRIS_MAX_REPORTS": service.MAX_REPORTS,
    "IRIS_SAMPLE_EXCLUDE": list(service.SAMPLE_EXCLUDE),
    "IRIS_STEP_MAX_PARTS": step.MAX_PARTS,
    "IRIS_STEP_MAX_TRIANGLES": step.MAX_TRIANGLES,
    "IRIS_BIG_MODEL_MB": scene.BIG_MODEL_BYTES >> 20,
    "IRIS_WIDER_FIX_MAX_MB": context_planner.WIDER_MAX_MB,
    "IRIS_BUILT_CACHE": str(built.CACHE),
    "IRIS_PROPOSE_PER_HOUR": app.propose_limit.per_client_hour,
    "IRIS_PROPOSE_PER_DAY": app.propose_limit.per_day,
    "IRIS_CHAT_PER_HOUR": app.chat_limit.per_client_hour,
    "IRIS_DETECT_PER_HOUR": app.detect_limit.per_client_hour,
    "IRIS_REQUIREMENTS_PER_HOUR": app.requirements_limit.per_client_hour,
    "IRIS_PREVIEW_PER_HOUR": app.preview_limit.per_client_hour,
    "IRIS_AGENT_CALLS_PER_HOUR": app.agent_call_limit.per_client_hour,
    "IRIS_UPLOAD_MAX_MB": app.UPLOAD_MAX_MB,
    "IRIS_MODEL_UPLOAD_MAX_MB": app.MODEL_UPLOAD_MAX_MB,
    "IRIS_VOICE_LIVE_MAX_S": app.VOICE_HANDS_FREE_MAX_S,
    "IRIS_CONTEXT_TRIALS": context_planner.Limits.from_env().trials,
}))
"""
NAMES = [line.split('"')[1] for line in PROBE.splitlines() if line.strip().startswith('"IRIS_')]


def start(tmp: Path, dotenv: dict[str, str], real: dict[str, str] | None = None) -> dict:
    """Import the server from a copy of the package beside `dotenv`, with `real` as the only real settings."""
    server = tmp / "server"
    shutil.copytree(PKG, server / "iris", ignore=shutil.ignore_patterns("__pycache__"))
    (tmp / ".env").write_text("".join(f"{k}={v}\n" for k, v in dotenv.items()), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in NAMES}  # this process may hold the developer's .env
    env.update(real or {}, PYTHONPATH=str(server))
    done = subprocess.run([sys.executable, "-c", PROBE], cwd=server, env=env, capture_output=True, text=True,
                          timeout=120)
    assert done.returncode == 0, f"the server did not start:\n{done.stderr[-3000:]}"
    seen = json.loads(done.stdout.strip().splitlines()[-1])
    assert Path(seen["package"]).resolve().is_relative_to(server.resolve()), "imported the real package, not the copy"
    return seen


def test_dotenv_reaches_settings_read_at_import_and_real_variables_win(tmp_path):
    cache = str(tmp_path / "built")
    seen = start(tmp_path, {
        "IRIS_MAX_SCENES": "7", "IRIS_SCENE_BUDGET_MB": "123", "IRIS_MAX_REPORTS": "5",
        "IRIS_SAMPLE_EXCLUDE": "IfcSpace", "IRIS_STEP_MAX_PARTS": "11", "IRIS_STEP_MAX_TRIANGLES": "22",
        "IRIS_BIG_MODEL_MB": "3", "IRIS_WIDER_FIX_MAX_MB": "9", "IRIS_BUILT_CACHE": cache,
        "IRIS_PROPOSE_PER_HOUR": "4", "IRIS_PREVIEW_PER_HOUR": "6",
    }, real={"IRIS_MAX_REPORTS": "2", "IRIS_PROPOSE_PER_DAY": "40"})
    assert seen["IRIS_MAX_SCENES"] == 7 and seen["IRIS_SCENE_BUDGET_MB"] == 123
    assert seen["IRIS_SAMPLE_EXCLUDE"] == ["IfcSpace"]
    assert seen["IRIS_STEP_MAX_PARTS"] == 11 and seen["IRIS_STEP_MAX_TRIANGLES"] == 22
    assert seen["IRIS_BIG_MODEL_MB"] == 3 and seen["IRIS_WIDER_FIX_MAX_MB"] == 9
    assert seen["IRIS_BUILT_CACHE"] == cache
    assert seen["IRIS_PROPOSE_PER_HOUR"] == 4 and seen["IRIS_PREVIEW_PER_HOUR"] == 6
    assert seen["IRIS_MAX_REPORTS"] == 2, "a real environment variable wins over .env"
    assert seen["IRIS_PROPOSE_PER_DAY"] == 40


def test_empty_numbers_in_dotenv_take_their_defaults(tmp_path):
    seen = start(tmp_path, {name: "" for name in NAMES if name != "IRIS_SAMPLE_EXCLUDE"})
    assert seen["IRIS_MAX_SCENES"] == seen["IRIS_SCENE_BUDGET_MB"] == seen["IRIS_MAX_REPORTS"] == 0
    assert seen["IRIS_STEP_MAX_PARTS"] == 20000 and seen["IRIS_STEP_MAX_TRIANGLES"] == 5000000
    assert seen["IRIS_BIG_MODEL_MB"] == 50 and seen["IRIS_WIDER_FIX_MAX_MB"] == 100
    assert seen["IRIS_BUILT_CACHE"] == str(Path(tempfile.gettempdir()) / "iris-built")
    # Caps: empty is no limit where that is the default, and the default where a cap has one of its own.
    assert seen["IRIS_PROPOSE_PER_HOUR"] == seen["IRIS_PROPOSE_PER_DAY"] == 0
    assert seen["IRIS_CHAT_PER_HOUR"] == seen["IRIS_DETECT_PER_HOUR"] == 0
    assert seen["IRIS_AGENT_CALLS_PER_HOUR"] == 0
    assert seen["IRIS_REQUIREMENTS_PER_HOUR"] == 120 and seen["IRIS_PREVIEW_PER_HOUR"] == 60
    assert seen["IRIS_UPLOAD_MAX_MB"] == seen["IRIS_MODEL_UPLOAD_MAX_MB"] == 200
    assert seen["IRIS_VOICE_LIVE_MAX_S"] == 120 and seen["IRIS_CONTEXT_TRIALS"] == 12


def test_numbers_from_the_environment(monkeypatch):
    monkeypatch.delenv("Iris_TEST_NUMBER", raising=False)
    assert env_int("Iris_TEST_NUMBER", 3) == 3 and env_float("Iris_TEST_NUMBER", 1.5) == 1.5
    for blank in ("", "  "):
        monkeypatch.setenv("Iris_TEST_NUMBER", blank)
        assert env_int("Iris_TEST_NUMBER", 3) == 3 and env_float("Iris_TEST_NUMBER", 1.5) == 1.5
    monkeypatch.setenv("Iris_TEST_NUMBER", " 0 ")
    assert env_int("Iris_TEST_NUMBER", 3) == 0 and env_float("Iris_TEST_NUMBER", 1.5) == 0.0
    monkeypatch.setenv("Iris_TEST_NUMBER", "twenty")
    with pytest.raises(ValueError):  # a value that is not a number still stops the server, loudly
        env_int("Iris_TEST_NUMBER", 3)
