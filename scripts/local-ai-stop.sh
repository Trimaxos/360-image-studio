#!/usr/bin/env bash
set -euo pipefail

OCI_ENGINE="${OCI_ENGINE:-podman}"
CONTAINER_NAME="${LOCAL_AI_CONTAINER:-360-image-studio-local-ai}"

"${OCI_ENGINE}" stop --ignore "${CONTAINER_NAME}"
