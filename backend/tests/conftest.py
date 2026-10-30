import os
import uuid

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://localhost/paytm_saathi_test?host=/tmp"
)
os.environ["DEMO_MODE"] = "true"
os.environ["DEMO_SHORTAGE"] = "true"
os.environ["PAYTM_ENV"] = "demo"
# Tests never call Sarvam (and never spend credits), even when backend/.env has a key.
os.environ["SARVAM_API_KEY"] = ""

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import reset  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(__file__))


@pytest.fixture(scope="session", autouse=True)
def migrated():
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "migrations"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def seeded():
    with SessionLocal() as db:
        reset(db)


@pytest.fixture
def client():
    return TestClient(app)


def login(client: TestClient, email: str = "mukul24360@iiitd.ac.in") -> dict:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": get_settings().demo_password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture
def auth(client):
    return login(client)


def idem() -> dict:
    return {"Idempotency-Key": uuid.uuid4().hex}
