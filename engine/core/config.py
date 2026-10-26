"""Settings, read once from the environment. Tests mutate the shared object."""

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

ENGINE_VERSION = "1.0.0"
PIPELINE_VERSION = "1"
PROMPT_VERSION = "1"
ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _num(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def _list(name: str, default: str) -> tuple[str, ...]:
    return tuple(x.strip() for x in (_env(name) or default).split(",") if x.strip())


@dataclass
class Settings:
    env: str
    service_token: str
    log_level: str
    sentry_dsn: str
    cors_origins: tuple[str, ...]

    data_dir: Path
    storage_backend: str
    s3_bucket: str
    s3_region: str
    s3_endpoint: str
    max_upload_bytes: int

    workers: int
    analysis_fps: float
    pose_model: str
    pose_model_path: str

    gemini_key: str
    gemini_models: tuple[str, ...]
    gemini_timeout_s: float
    gemini_min_interval_s: float
    gemini_thinking_budget: int
    proxy_max_s: float
    proxy_fps: float

    session_ttl_s: float
    result_ttl_s: float

    @property
    def production(self) -> bool:
        return self.env == "production"


def load() -> Settings:
    data_dir = Path(_env("DATA_DIR", "./data"))
    if not data_dir.is_absolute():
        data_dir = ROOT / data_dir
    return Settings(
        env=_env("ENVIRONMENT", "development").lower(),
        service_token=_env("SERVICE_TOKEN"),
        log_level=_env("LOG_LEVEL", "INFO").upper(),
        sentry_dsn=_env("SENTRY_DSN"),
        cors_origins=_list("SERVER_URL", "http://localhost:8000"),
        data_dir=data_dir.resolve(),
        storage_backend=_env("STORAGE_BACKEND", "local").lower(),
        s3_bucket=_env("S3_BUCKET"),
        s3_region=_env("S3_REGION"),
        s3_endpoint=_env("S3_ENDPOINT_URL"),
        max_upload_bytes=int(_num("MAX_UPLOAD_MB", 500)) * 1024 * 1024,
        workers=max(1, int(_num("ENGINE_WORKERS", 1))),
        analysis_fps=_num("ANALYSIS_FPS", 12),
        pose_model=_env("POSE_MODEL", "lite"),
        pose_model_path=_env("POSE_MODEL_PATH"),
        gemini_key=_env("GEMINI_API_KEY"),
        gemini_models=_list("GEMINI_MODELS", "gemini-2.5-flash,gemini-2.5-flash-lite"),
        gemini_timeout_s=_num("GEMINI_TIMEOUT_S", 240),
        gemini_min_interval_s=_num("GEMINI_MIN_INTERVAL_S", 2),
        gemini_thinking_budget=int(_num("GEMINI_THINKING_BUDGET", 0)),
        proxy_max_s=_num("PROXY_MAX_SECONDS", 150),
        proxy_fps=_num("PROXY_FPS", 5),
        session_ttl_s=_num("SESSION_TTL_S", 6 * 3600),
        result_ttl_s=_num("RESULT_TTL_S", 7 * 86400),
    )


settings = load()
