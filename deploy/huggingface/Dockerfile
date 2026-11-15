FROM python:3.11-slim
RUN useradd -m -u 1000 user
ENV HOME=/home/user PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    EXOF_FRONTEND_DIST=/home/user/app/frontend/dist EXOF_DEVICE=cpu EXOF_BUILD_WORKERS=1 \
    EXOF_CORS_ORIGINS=*
WORKDIR /home/user/app
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch && pip install -r requirements.txt
COPY --chown=user . .
RUN pip install --no-deps -e backend && chown -R user /home/user/app
USER user
EXPOSE 7860
WORKDIR /home/user/app/backend
CMD ["python", "-m", "uvicorn", "exofinder.api.main:app", "--host", "0.0.0.0", "--port", "7860"]
