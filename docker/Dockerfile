FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev

ENV PATH="/app/.venv/bin:$PATH"
ENV OWI_DATA_DIR=/data
ENV PYTHONDONTWRITEBYTECODE=1
ARG OWI_BUILD_REVISION=development
ENV OWI_BUILD_REVISION=$OWI_BUILD_REVISION
LABEL org.opencontainers.image.revision=$OWI_BUILD_REVISION
RUN groupadd --gid 10001 owi && useradd --uid 10001 --gid 10001 --no-create-home owi
USER 10001:10001

# 14 days: the phone app can upload days late, and late data should still land.
CMD ["owi", "sync", "--days", "14", "--loop", "600"]
