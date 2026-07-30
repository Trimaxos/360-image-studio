#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
IMAGE_NAME="${LOCAL_AI_IMAGE:-localhost/360-image-studio-local-ai:1.0.0}"
OUTPUT="${1:-${PROJECT_DIR}/artifacts/360-image-studio-local-ai-1.0.0.oci.tar}"

mkdir -p "$(dirname -- "${OUTPUT}")"
"${OCI_ENGINE}" save --format oci-archive --output "${OUTPUT}" "${IMAGE_NAME}"
echo "Saved OCI archive to ${OUTPUT}"
