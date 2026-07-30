#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
OCI_ENGINE="${OCI_ENGINE:-podman}"
ARCHIVE="${1:-${PROJECT_DIR}/artifacts/360-image-studio-local-ai-1.0.0.oci.tar}"

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "OCI archive not found: ${ARCHIVE}" >&2
  exit 1
fi
"${OCI_ENGINE}" load --input "${ARCHIVE}"
