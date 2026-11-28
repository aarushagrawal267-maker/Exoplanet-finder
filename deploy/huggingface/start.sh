#!/bin/sh
# Start script of the Hugging Face Space. If the image contains a demo seed (seed/seed.json, made
# with deploy/huggingface/demo_seed.py from a local training run), it is installed into the empty
# data/artifacts folders first, so the hosted demo opens with the NASA catalogue and trained models.
# Space storage is temporary: every restart begins again from the seed.
set -e
APP=/home/user/app
if [ -f "$APP/seed/seed.json" ]; then
  python "$APP/deploy/huggingface/demo_seed.py" apply --seed "$APP/seed" --data "$EXOF_DATA_DIR" --artifacts "$EXOF_ARTIFACTS_DIR"
fi
cd "$APP/backend"
exec python -m uvicorn exofinder.api.main:app --host 0.0.0.0 --port "${PORT:-7860}"
