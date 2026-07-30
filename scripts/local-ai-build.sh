#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
IMAGE_NAME="${LOCAL_AI_IMAGE:-localhost/360-image-studio-local-ai:1.0.0}"

"${OCI_ENGINE}" build \
  --file "${PROJECT_DIR}/containers/local-ai/Containerfile" \
  --tag "${IMAGE_NAME}" \
  "${PROJECT_DIR}"

echo "Built ${IMAGE_NAME}"
