# Exoplanet Finder as a single container: the FastAPI backend serves the built web app.
#
#   docker build -t exoplanet-finder .
#   docker run --rm -p 8000:8000 -v exof-data:/home/user/app/data -v exof-artifacts:/home/user/app/artifacts exoplanet-finder
#
# Then open http://localhost:8000 (API documentation: http://localhost:8000/api/docs).
# CPU-only PyTorch is installed; downloaded NASA data and trained models live in the two volumes.

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
    PORT=8000
WORKDIR /home/user/app
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch && pip install -r requirements.txt
COPY backend/ backend/
COPY docs/ docs/
COPY README.md .env.example ./
COPY --from=frontend /src/frontend/dist frontend/dist
RUN pip install --no-deps -e backend && mkdir -p data artifacts && chown -R user /home/user/app
USER user
EXPOSE 8000
WORKDIR /home/user/app/backend
CMD ["sh", "-c", "python -m uvicorn exofinder.api.main:app --host 0.0.0.0 --port ${PORT}"]
