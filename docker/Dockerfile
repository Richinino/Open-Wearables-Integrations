FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev

ENV PATH="/app/.venv/bin:$PATH"
ENV OWI_DATA_DIR=/data

# 14 days: the phone app can upload days late, and late data should still land.
CMD ["owi", "sync", "--days", "14", "--loop", "600"]
