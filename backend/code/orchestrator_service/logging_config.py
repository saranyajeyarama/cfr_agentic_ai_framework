"""
Centralized logging configuration for Tiger Foods Agentic AI backend.

Call configure_logging() once at process startup (top of main.py before any
other imports that touch logging). All other modules use the standard
logging.getLogger(__name__) pattern — Python's logger hierarchy propagates
records up to the root logger automatically.

Environment variables:
  LOG_LEVEL     Controls verbosity. Default INFO. Set DEBUG to see every BQ
                tool call and LP internals. Valid: DEBUG, INFO, WARNING, ERROR.
  LOG_FILE_PATH Override log file path. Default /app/logs/tiger_ai.log.
                Parent directory is auto-created. If not writable (local dev),
                the file handler is silently skipped — stdout only.
"""

import logging
import logging.handlers
import os
import sys

LOG_FORMAT   = "%(asctime)s | %(levelname)-8s | %(name)-38s | %(message)s"
LOG_DATE_FMT = "%Y-%m-%d %H:%M:%S"
LOG_FILE_PATH = os.environ.get("LOG_FILE_PATH", "/app/logs/tiger_ai.log")


def configure_logging() -> None:
    """Configure the root logger. Idempotent — safe to call multiple times."""
    root = logging.getLogger()
    if root.handlers:
        return  # already configured — avoid duplicate handlers on hot-reload

    level = getattr(
        logging,
        os.environ.get("LOG_LEVEL", "INFO").upper(),
        logging.INFO,
    )
    fmt = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FMT)

    # Stream handler — always present; Docker / Cloud Run captures stdout.
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    # Rotating file handler — added only if the log directory is writable.
    # Silently skipped in local dev where /app/logs does not exist.
    try:
        log_dir = os.path.dirname(LOG_FILE_PATH)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(
            LOG_FILE_PATH,
            maxBytes=50 * 1024 * 1024,  # 50 MB per file
            backupCount=5,
            encoding="utf-8",
        )
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass  # /app/logs not available locally — stdout only

    root.setLevel(level)

    # Suppress noisy third-party loggers that would otherwise flood stdout
    # in debug mode. These are all harmless framework internals.
    _quiet = [
        "opentelemetry",
        "google.auth",
        "google.api_core",
        "google.auth.transport",
        "urllib3",
        "httpx",
        "httpcore",
    ]
    for name in _quiet:
        logging.getLogger(name).setLevel(logging.WARNING)
    # OTEL context errors from ADK async generators are noisy and harmless.
    logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)


# ---------------------------------------------------------------------------
# Session-scoped logger adapter
# ---------------------------------------------------------------------------

class SessionLogger(logging.LoggerAdapter):
    """Prepends [session_id] to every log message.

    Usage:
        log = get_session_logger(__name__, session_id)
        log.info("Specialist done agent=%s latency_ms=%d", name, ms)
        # emits: [session_20260525_...] Specialist done agent=supply_planning latency_ms=1802
    """

    def __init__(self, logger: logging.Logger, session_id: str):
        super().__init__(logger, {})
        self.session_id = session_id

    def process(self, msg: str, kwargs: dict):
        return f"[{self.session_id}] {msg}", kwargs


def get_session_logger(name: str, session_id: str) -> SessionLogger:
    """Return a SessionLogger that prefixes every message with [session_id]."""
    return SessionLogger(logging.getLogger(name), session_id)
