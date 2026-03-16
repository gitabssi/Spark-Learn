#!/bin/bash
set -e

# ─── Config ───────────────────────────────────────────────────────────────────
PROJECT_ID="gen-lang-client-0979872677"
REGION="us-central1"
SERVICE="sparklive"
# Pass your key: GOOGLE_API_KEY=your_key ./deploy.sh
GOOGLE_API_KEY="${GOOGLE_API_KEY:?ERROR: set GOOGLE_API_KEY before running this script}"
GCLOUD_DIR="$HOME/.spark-gcloud/google-cloud-sdk"

# ─── Install gcloud (standalone, no Xcode CLT needed) ─────────────────────────
if ! command -v gcloud &>/dev/null && [ ! -f "$GCLOUD_DIR/bin/gcloud" ]; then
  echo "📦 Downloading gcloud CLI (standalone, no Xcode needed)..."
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz"
  else
    URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-x86_64.tar.gz"
  fi
  mkdir -p "$HOME/.spark-gcloud"
  curl -# -L "$URL" | tar -xz -C "$HOME/.spark-gcloud"
  echo "✅ gcloud downloaded"
fi

# Use local gcloud if system one not in PATH
if ! command -v gcloud &>/dev/null; then
  export PATH="$GCLOUD_DIR/bin:$PATH"
fi

echo "✅ gcloud: $(gcloud version --format='value(Google Cloud SDK)' 2>/dev/null | head -1)"

# ─── Authenticate ─────────────────────────────────────────────────────────────
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
  echo ""
  echo "🔐 Opening browser for Google login..."
  gcloud auth login --no-launch-browser 2>/dev/null || gcloud auth login
fi

# ─── Set project ──────────────────────────────────────────────────────────────
gcloud config set project "$PROJECT_ID" --quiet
echo "✅ Project: $PROJECT_ID"

# ─── Enable APIs (idempotent) ─────────────────────────────────────────────────
echo "⚙️  Enabling Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT_ID" --quiet
echo "✅ APIs enabled"

# ─── Deploy ───────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Deploying SPARK to Cloud Run..."
echo "   Project : $PROJECT_ID"
echo "   Region  : $REGION"
echo "   Service : $SERVICE"
echo ""

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --memory "4Gi" \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --set-env-vars "GOOGLE_API_KEY=$GOOGLE_API_KEY,GOOGLE_GENAI_USE_VERTEXAI=False" \
  --labels "created-by=adk"

# ─── Print URL ────────────────────────────────────────────────────────────────
echo ""
URL=$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format "value(status.url)" 2>/dev/null)
echo "✅ SPARK is live at: $URL"
echo ""
