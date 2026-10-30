FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
EXPOSE 8000
# Migrations run on boot; seed only when SEED_ON_BOOT=true (demo environments).
CMD ["sh", "-c", "uv run alembic upgrade head && if [ \"$SEED_ON_BOOT\" = \"true\" ]; then uv run python -m app.seed; fi && uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
