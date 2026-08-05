#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-tmochi-learn:latest}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"

echo "Building production image ${IMAGE_NAME}..."
docker build --pull -t "$IMAGE_NAME" "$SCRIPT_DIR"

if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "Pushing ${IMAGE_NAME}..."
  docker push "$IMAGE_NAME"
fi

echo "Production image ready: ${IMAGE_NAME}"
