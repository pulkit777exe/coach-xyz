"""Gemini access that behaves on any API key, including free tiers.

Calls are spaced out, 429s are waited out when short, and a model that is out
of quota or not available to the key is skipped for a while so the next one in
`GEMINI_MODELS` is used. When nothing works, `Unavailable` is raised and the
pipeline falls back to rule-based coaching instead of failing the job.
"""

import json
import logging
import re
import threading
import time
from collections.abc import Iterator
from pathlib import Path

from . import config
from .errors import EngineError

log = logging.getLogger("engine.llm")
INLINE_LIMIT = 18 * 1024 * 1024


class Unavailable(EngineError):
    def __init__(self, reason: str, retry_after: float = 60):
        super().__init__("LLM_UNAVAILABLE", reason, retryable=True, status=503)
        self.retry_after = retry_after


_lock = threading.Lock()
_last_call = 0.0
_blocked: dict[str, float] = {}


def _wait_turn() -> None:
    global _last_call
    with _lock:
        gap = config.settings.gemini_min_interval_s - (time.monotonic() - _last_call)
        if gap > 0:
            time.sleep(gap)
        _last_call = time.monotonic()


def _retry_delay(exc) -> float | None:
    for d in (getattr(exc, "details", None) or {}).get("error", {}).get("details", []):
        m = re.fullmatch(r"([\d.]+)s", str(d.get("retryDelay", "")))
        if m:
            return float(m.group(1))
    return None


def reset() -> None:
    _blocked.clear()


class Gemini:
    def __init__(self) -> None:
        s = config.settings
        if not s.gemini_key:
            raise Unavailable("GEMINI_API_KEY is not configured", retry_after=3600)
        from google import genai
        from google.genai import types

        self.types = types
        self.client = genai.Client(api_key=s.gemini_key, http_options=types.HttpOptions(timeout=int(s.gemini_timeout_s * 1000)))

    def _config(self, model: str, schema=None, system: str | None = None, temperature: float = 0.2, video: bool = False):
        t = self.types
        kwargs = {"temperature": temperature, "system_instruction": system}
        if schema is not None:
            kwargs.update(response_mime_type="application/json", response_schema=schema)
        if video:
            kwargs["media_resolution"] = t.MediaResolution.MEDIA_RESOLUTION_LOW
        if "flash" in model and "lite" not in model:
            kwargs["thinking_config"] = t.ThinkingConfig(thinking_budget=config.settings.gemini_thinking_budget)
        return t.GenerateContentConfig(**kwargs)

    def _models(self) -> list[str]:
        now = time.monotonic()
        return [m for m in config.settings.gemini_models if _blocked.get(m, 0) <= now]

    def _call(self, fn):
        """Run fn(model) over the model chain. Returns (model, result)."""
        models = self._models()
        if not models:
            wait = max(0.0, min(_blocked.values(), default=0) - time.monotonic())
            raise Unavailable("All configured Gemini models are out of quota", retry_after=wait or 60)
        last = ""
        for model in models:
            for attempt in range(2):
                _wait_turn()
                try:
                    return model, fn(model)
                except EngineError:
                    raise
                except Exception as exc:
                    code = getattr(exc, "code", None)
                    text = str(exc)
                    last = f"{model}: {code or type(exc).__name__}"
                    if code in (429, 503):
                        delay = _retry_delay(exc)
                        daily = "PerDay" in text or "limit: 0" in text
                        if attempt == 0 and not daily and (delay or 4) <= 25:
                            time.sleep(delay or 4)
                            continue
                        _blocked[model] = time.monotonic() + (3600 if daily else (delay or 30))
                    elif code in (400, 403, 404):
                        _blocked[model] = time.monotonic() + 1800
                        log.warning("model %s rejected: %s", model, text[:200])
                    else:
                        log.warning("gemini call failed on %s: %s", model, text[:200])
                    break
        raise Unavailable(f"Gemini request failed ({last})")

    def video_part(self, path: str, fps: float):
        t = self.types
        size = Path(path).stat().st_size
        meta = t.VideoMetadata(fps=fps)
        if size <= INLINE_LIMIT:
            return t.Part(inline_data=t.Blob(data=Path(path).read_bytes(), mime_type="video/mp4"), video_metadata=meta), None
        uploaded = self.client.files.upload(file=path, config={"mime_type": "video/mp4"})
        deadline = time.monotonic() + 120
        while uploaded.state == t.FileState.PROCESSING and time.monotonic() < deadline:
            time.sleep(2)
            uploaded = self.client.files.get(name=uploaded.name)
        if uploaded.state != t.FileState.ACTIVE:
            raise Unavailable("Gemini could not process the video upload")
        return t.Part(file_data=t.FileData(file_uri=uploaded.uri, mime_type="video/mp4"), video_metadata=meta), uploaded.name

    def drop_file(self, name: str | None) -> None:
        if name:
            try:
                self.client.files.delete(name=name)
            except Exception:
                pass

    def structured(self, contents, schema, system: str | None = None, video: bool = False):
        def go(model: str):
            r = self.client.models.generate_content(model=model, contents=contents,
                                                    config=self._config(model, schema, system, video=video))
            if r.parsed is not None:
                return r.parsed
            return schema.model_validate(json.loads(r.text))

        return self._call(go)

    def text(self, prompt: str, system: str | None = None, temperature: float = 0.4) -> str:
        def go(model: str):
            r = self.client.models.generate_content(model=model, contents=prompt,
                                                    config=self._config(model, system=system, temperature=temperature))
            return r.text or ""

        return self._call(go)[1]

    def stream(self, prompt: str, system: str | None = None) -> Iterator[str]:
        model = (self._models() or [""])[0]
        if not model:
            raise Unavailable("All configured Gemini models are out of quota")
        _wait_turn()
        try:
            for chunk in self.client.models.generate_content_stream(
                    model=model, contents=prompt, config=self._config(model, system=system, temperature=0.4)):
                if chunk.text:
                    yield chunk.text
        except EngineError:
            raise
        except Exception as exc:
            if getattr(exc, "code", None) in (429, 503):
                _blocked[model] = time.monotonic() + (_retry_delay(exc) or 30)
            raise Unavailable(f"Gemini stream failed ({getattr(exc, 'code', type(exc).__name__)})") from exc


def default() -> Gemini:
    return Gemini()
