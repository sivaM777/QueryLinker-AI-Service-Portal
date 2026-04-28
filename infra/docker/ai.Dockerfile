FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ARG AI_LOCAL_HF_MODEL=typeform/distilbert-base-uncased-mnli
ENV HF_HOME=/app/hf-cache
ENV TRANSFORMERS_CACHE=/app/hf-cache
# Pre-warm HF cache for the configured model (optional but improves first-run latency)
RUN python -c "from transformers import pipeline; pipeline('zero-shot-classification', model='${AI_LOCAL_HF_MODEL}')"
# Use an entrypoint that trains if model is missing, otherwise starts the API directly
RUN chmod +x entrypoint.sh
EXPOSE 8001
CMD ["./entrypoint.sh"]
