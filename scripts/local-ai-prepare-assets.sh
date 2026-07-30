#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
IMAGE_NAME="${LOCAL_AI_IMAGE:-localhost/360-image-studio-local-ai:1.0.0}"
ASSETS_DIR="${LOCAL_AI_ASSETS_DIR:-${PROJECT_DIR}/models/flux-fill-base}"

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is required. Accept the FLUX.1-Fill-dev license first." >&2
  exit 1
fi

mkdir -p "${ASSETS_DIR}"
if ! "${OCI_ENGINE}" image exists "${IMAGE_NAME}"; then
  "${SCRIPT_DIR}/local-ai-build.sh"
fi

"${OCI_ENGINE}" run --rm \
  --security-opt=label=disable \
  --userns=keep-id \
  --user "$(id -u):$(id -g)" \
  --env HF_TOKEN \
  --env HOME=/tmp \
  --env BASE_MODEL_PATH=/assets/flux-fill-base \
  --volume "${ASSETS_DIR}:/assets/flux-fill-base" \
  --entrypoint python \
  "${IMAGE_NAME}" \
  /app/prepare_local_ai_assets.py

echo "Prepared offline support assets in ${ASSETS_DIR}"
"${SCRIPT_DIR}/local-ai-bake-assets.sh"
