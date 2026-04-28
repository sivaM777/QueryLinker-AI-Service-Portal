#!/usr/bin/env sh
set -e

# Warm up HF cache if directory exists
if [ -d "/app/hf-cache" ]; then
  export HF_HOME=/app/hf-cache
  export TRANSFORMERS_CACHE=/app/hf-cache
fi

# Train only if model artifacts are missing
SHOULD_TRAIN=0

if [ ! -f "model/classifier.pkl" ] || [ ! -f "model/vectorizer.pkl" ] || [ ! -f "model/intent_classifier.pkl" ]; then
  SHOULD_TRAIN=1
fi

if [ -f "data/train.generated.jsonl" ]; then
  if [ ! -f "model/classifier.pkl" ] || [ "data/train.generated.jsonl" -nt "model/classifier.pkl" ]; then
    SHOULD_TRAIN=1
  fi
  if [ ! -f "model/vectorizer.pkl" ] || [ "data/train.generated.jsonl" -nt "model/vectorizer.pkl" ]; then
    SHOULD_TRAIN=1
  fi
  if [ ! -f "model/intent_classifier.pkl" ] || [ "data/train.generated.jsonl" -nt "model/intent_classifier.pkl" ]; then
    SHOULD_TRAIN=1
  fi
fi

if [ "$SHOULD_TRAIN" -eq 1 ]; then
  echo "Training model..."
  python train.py --data data/train.jsonl --csv data/email_training_dataset.csv --out-dir model || echo "Training failed or skipped."
else
  echo "Model artifacts found and up-to-date. Skipping training."
fi

exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8001}"
