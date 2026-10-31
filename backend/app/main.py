import asyncio
import os
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.growth_routes import growth_api
from app.api.routes import VERSION, api, public
from app.api.soundbox_routes import pay_public, soundbox_api
from app.config import get_settings
from app.errors import ApiError

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("saathi")

_settings = get_settings()

def _check_production_settings() -> None:
    """Refuse to start outside development with secrets that are default, short, or shared with the demo."""
    if _settings.app_env == "development":
        return
    problems = []
    if _settings.jwt_secret.startswith("dev-only") or len(_settings.jwt_secret) < 32:
        problems.append("JWT_SECRET must be set to a random value of at least 32 characters")
    if _settings.demo_webhook_key.startswith("dev-") or len(_settings.demo_webhook_key) < 24:
        problems.append("DEMO_WEBHOOK_KEY must be set to a random value of at least 24 characters")
    if _settings.demo_mode and _settings.demo_password == "saathi-demo-2026":
        problems.append("DEMO_PASSWORD must be changed from the public default")
    if _settings.paytm_env == "staging" and not (_settings.paytm_mid and _settings.paytm_merchant_key):
        problems.append("PAYTM_ENV=staging needs PAYTM_MID and PAYTM_MERCHANT_KEY")
    if "*" in _settings.cors_list:
        problems.append("CORS_ORIGINS must list exact origins, not *")
    if problems:
        raise RuntimeError("Unsafe production settings: " + "; ".join(problems))


_check_production_settings()


def check_schema() -> None:
    """Refuse to serve on a database whose schema is behind the code (every query would 500).
    Run `alembic upgrade head` first; `npm run api` and the Docker image both do."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    from app.db import engine

    base = os.path.dirname(os.path.dirname(__file__))
    cfg = Config(os.path.join(base, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(base, "migrations"))
    head = ScriptDirectory.from_config(cfg).get_current_head()
    with engine.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    if current != head:
        raise RuntimeError(f"Database schema is at {current}, code needs {head}: run `alembic upgrade head`")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Schema check, then the optional proactive Saathi check on an interval (AGENT_SCAN_INTERVAL_MIN)."""
    check_schema()
    interval = get_settings().agent_scan_interval_min
    job = None
    if interval > 0:
        from app.services.growth import scheduled_scan_all

        async def loop() -> None:
            while True:
                await asyncio.sleep(interval * 60)
                try:
                    created = await asyncio.to_thread(scheduled_scan_all)
                    log.info(json.dumps({"event": "proactive_scan", "created": created}))
                except Exception:  # noqa: BLE001
                    log.exception("proactive scan failed")

        job = asyncio.create_task(loop())
    yield
    if job:
        job.cancel()


app = FastAPI(title="Paytm Saathi API", version=VERSION, lifespan=lifespan,
              description="Hackathon prototype. Supplier and payment adapters are SIMULATED/DEMO unless configured.")


@app.middleware("http")
async def request_log(request: Request, call_next):
    """Correlation id + one structured log line per request. Unexpected errors become a JSON 500 here, inside
    the CORS layer, so browsers receive them with CORS headers (and can show the real error, not 'offline')."""
    correlation_id = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:16]
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001 - last-resort handler; ApiError and validation errors never reach here
        log.exception(json.dumps({"cid": correlation_id, "event": "unhandled_error", "path": request.url.path}))
        response = JSONResponse(status_code=500, content={"code": "INTERNAL", "message": "Something went wrong",
                                                          "details": {"correlation_id": correlation_id}})
    response.headers["x-correlation-id"] = correlation_id
    log.info(json.dumps({"cid": correlation_id, "method": request.method, "path": request.url.path,
                         "status": response.status_code, "ms": round((time.perf_counter() - start) * 1000, 1)}))
    return response


# Added last so it is the outermost layer: every response, including errors, carries CORS headers.
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_credentials=False,
    allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Approval-Pin", "X-Correlation-Id"],
    expose_headers=["X-Correlation-Id"],
)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message, "details": exc.details})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [".".join(str(p) for p in e["loc"][1:]) for e in exc.errors()]
    return JSONResponse(status_code=422, content={"code": "VALIDATION_ERROR", "message": "Invalid request",
                                                  "details": {"fields": fields}})


app.include_router(public)
app.include_router(api)
app.include_router(growth_api)
app.include_router(soundbox_api)
app.include_router(pay_public)
