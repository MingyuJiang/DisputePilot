# Single-image demo: builds the SPA, serves it from FastAPI on one port.
#
#   docker build -t disputepilot-demo .
#   docker run --rm -p 8000:8000 disputepilot-demo
#
# No PayPal credentials, no network access needed at runtime.

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_DP_API_MODE=http
ENV VITE_DP_API_BASE=/api/v1
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY data/ /data/
COPY --from=web /web/dist /static

ENV DP_DATABASE_URL=sqlite:////data/demo.sqlite3
ENV DP_DATA_MODE=offline_replay
ENV DP_AUTO_IMPORT=0
ENV DP_AI_PROVIDER=frozen
ENV DP_STATIC_DIR=/static

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
