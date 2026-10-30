import json
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import VERSION, api, public
from app.config import get_settings
from app.errors import ApiError

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("saathi")

_settings = get_settings()
if _settings.app_env != "development" and (
    _settings.jwt_secret.startswith("dev-only") or _settings.demo_webhook_key.startswith("dev-")
):
    raise RuntimeError("Set JWT_SECRET and DEMO_WEBHOOK_KEY outside development")

app = FastAPI(title="Paytm Saathi API", version=VERSION,
              description="Hackathon prototype. Supplier and payment adapters are SIMULATED/DEMO unless configured.")
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_credentials=False,
    allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:16]
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    log.info(json.dumps({"cid": correlation_id, "method": request.method, "path": request.url.path,
                         "status": response.status_code, "ms": round((time.perf_counter() - start) * 1000, 1)}))
    return response


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"code": exc.code, "message": exc.message, "details": exc.details})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [".".join(str(p) for p in e["loc"][1:]) for e in exc.errors()]
    return JSONResponse(status_code=422, content={"code": "VALIDATION_ERROR", "message": "Invalid request",
                                                  "details": {"fields": fields}})


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content={"code": "INTERNAL", "message": "Something went wrong", "details": {}})


app.include_router(public)
app.include_router(api)
