# Hugging Face Docker Space: copy this file to the root of the Space repository as "Dockerfile"
# (next to backend/, frontend/, docs/, requirements.txt). Same image as the project's root
# Dockerfile, listening on port 7860 as Spaces expect.

# ---- Stage 1: build the React frontend -------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime -----------------------------------------------------------------
FROM python:3.12-slim
RUN useradd -m -u 1000 user
ENV HOME=/home/user PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    EXOF_DATA_DIR=/home/user/app/data EXOF_ARTIFACTS_DIR=/home/user/app/artifacts \
    EXOF_FRONTEND_DIST=/home/user/app/frontend/dist EXOF_DEVICE=cpu EXOF_CORS_ORIGINS=* \
    PORT=7860 EXOF_BUILD_WORKERS=1
WORKDIR /home/user/app
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.6,<2.16" && pip install -r requirements.txt
COPY backend/ backend/
COPY docs/ docs/
COPY README.md .env.example ./
COPY --from=frontend /src/frontend/dist frontend/dist
RUN pip install --no-deps -e backend && mkdir -p data artifacts && chown -R user /home/user/app
USER user
EXPOSE 7860
WORKDIR /home/user/app/backend
CMD ["sh", "-c", "python -m uvicorn exofinder.api.main:app --host 0.0.0.0 --port ${PORT}"]
