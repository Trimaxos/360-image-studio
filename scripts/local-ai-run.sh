#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
IMAGE_NAME="${LOCAL_AI_IMAGE:-localhost/360-image-studio-local-ai:1.0.0}"
CONTAINER_NAME="${LOCAL_AI_CONTAINER:-360-image-studio-local-ai}"
MODEL_FILE="${LOCAL_AI_GGUF_PATH:-${PROJECT_DIR}/models/flux1-fill-dev-Q4_K_M.gguf}"
ASSETS_DIR="${LOCAL_AI_ASSETS_DIR:-${PROJECT_DIR}/models/flux-fill-base}"
PORT="${LOCAL_AI_PORT:-8765}"
BAKED_ASSETS="$("${OCI_ENGINE}" image inspect "${IMAGE_NAME}" \
  --format '{{ index .Config.Labels "io.360-image-studio.flux-fill-assets" }}' 2>/dev/null || true)"

if [[ ! -f "${MODEL_FILE}" ]]; then
  echo "GGUF model not found: ${MODEL_FILE}" >&2
  exit 1
fi
if ! "${OCI_ENGINE}" image exists "${IMAGE_NAME}"; then
  echo "OCI image not found: ${IMAGE_NAME}. Run scripts/local-ai-build.sh first." >&2
  exit 1
fi

args=(
  run --detach --replace
  --name "${CONTAINER_NAME}"
  --stop-timeout 30
  --security-opt=label=disable
  --device nvidia.com/gpu=all
  --publish "127.0.0.1:${PORT}:8765"
  --volume "${MODEL_FILE}:/models/flux1-fill-dev-Q4_K_M.gguf:ro"
  --env MODEL_PATH=/models/flux1-fill-dev-Q4_K_M.gguf
  --env LOCAL_AI_PORT=8765
  --env PRELOAD_MODEL=true
)

if [[ "${BAKED_ASSETS}" == "true" ]]; then
  args+=(
    --env BASE_MODEL_PATH=/opt/models/flux-fill-base
    --env LOCAL_AI_OFFLINE=true
  )
elif [[ -f "${ASSETS_DIR}/model_index.json" ]]; then
  args+=(
    --volume "${ASSETS_DIR}:/opt/models/flux-fill-base:ro"
    --env BASE_MODEL_PATH=/opt/models/flux-fill-base
    --env LOCAL_AI_OFFLINE=true
  )
else
  args+=(--env LOCAL_AI_OFFLINE=false)
  if [[ -n "${HF_TOKEN:-}" ]]; then
    args+=(--env HF_TOKEN)
  fi
  echo "Warning: offline FLUX support assets are missing; Hugging Face access is required." >&2
fi

"${OCI_ENGINE}" "${args[@]}" "${IMAGE_NAME}"
echo "Local AI is starting at http://127.0.0.1:${PORT}"
