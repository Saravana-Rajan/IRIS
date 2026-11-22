"""The Gemini models the evals run on (Vertex AI, through `iris.model_client`): one place for the flags and the env.

Flags override the server's own environment for one run, so an eval and the app read the same settings:
`--model` (GEMINI_MODEL), `--location` (GOOGLE_CLOUD_LOCATION), `--project` (GOOGLE_CLOUD_PROJECT),
`--thinking` (the proposal model's thinking level, GEMINI_THINKING_LEVEL). The fast model (triage, titles, part
classes, host readings) is GEMINI_FAST_MODEL, the second try GEMINI_ESCALATION_MODEL, as in the app.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from iris import model_client  # noqa: E402
from iris.model_client import GeminiModel  # noqa: E402

FLAG_ENV = (("location", "GOOGLE_CLOUD_LOCATION"), ("project", "GOOGLE_CLOUD_PROJECT"),
            ("thinking", "GEMINI_THINKING_LEVEL"))


def add_args(p: argparse.ArgumentParser, model: bool = True) -> None:
    if model:
        p.add_argument("--model", help="Gemini model id (default: GEMINI_MODEL)")
    p.add_argument("--location", help="Vertex AI region (default: GOOGLE_CLOUD_LOCATION)")
    p.add_argument("--project", help="Google Cloud project (default: GOOGLE_CLOUD_PROJECT)")
    p.add_argument("--thinking", help="thinking level: minimal, low, medium, high (default: GEMINI_THINKING_LEVEL)")


def apply_args(args: argparse.Namespace) -> None:
    """Put the flags into the environment before any model or client is built."""
    model_client.load_env()
    for flag, env in FLAG_ENV:
        value = getattr(args, flag, None)
        if value:
            os.environ[env] = value


def model(name: str | None = None, timeout_s: float = 240) -> GeminiModel:
    """The proposal model (GEMINI_MODEL unless `name` says otherwise)."""
    return GeminiModel(model=name or None, timeout_s=timeout_s)


def fast(timeout_s: float = 60) -> GeminiModel:
    """The fast model, as the app's triage and titles build it (GEMINI_FAST_MODEL)."""
    return model_client.triage_model(timeout_s=timeout_s)[0]


def escalation(timeout_s: float = 240) -> GeminiModel:
    """The second try's model, as the app builds it (GEMINI_ESCALATION_MODEL; charged to the day's limit)."""
    return model_client.escalation_model(timeout_s=timeout_s)


def name(m) -> str:
    """The model id a row records."""
    return getattr(m, "model", None) or "gemini"
