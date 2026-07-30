#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
IMAGE_NAME="${LOCAL_AI_IMAGE:-localhost/360-image-studio-local-ai:1.0.0}"
ASSETS_DIR="${LOCAL_AI_ASSETS_DIR:-${PROJECT_DIR}/models/flux-fill-base}"

if [[ ! -f "${ASSETS_DIR}/model_index.json" ]]; then
  echo "FLUX support assets not found: ${ASSETS_DIR}" >&2
  exit 1
fi

container_id="$("${OCI_ENGINE}" create "${IMAGE_NAME}")"
cleanup() {
  "${OCI_ENGINE}" rm --force "${container_id}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${OCI_ENGINE}" cp "${ASSETS_DIR}/." "${container_id}:/opt/models/flux-fill-base"
"${OCI_ENGINE}" commit \
  --change 'LABEL io.360-image-studio.flux-fill-assets=true' \
  "${container_id}" \
  "${IMAGE_NAME}"

echo "Baked FLUX support assets into ${IMAGE_NAME}"
