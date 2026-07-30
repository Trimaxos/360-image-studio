#!/usr/bin/env python3
"""Download the gated FLUX Fill support files, excluding transformer weights."""

import os
from pathlib import Path

from huggingface_hub import snapshot_download

repo_id = os.getenv("BASE_MODEL_ID", "black-forest-labs/FLUX.1-Fill-dev")
target = Path(os.getenv("BASE_MODEL_PATH", "/assets/flux-fill-base"))
token = os.getenv("HF_TOKEN")

if not token:
    raise SystemExit("HF_TOKEN is required after accepting the FLUX.1-Fill-dev license")

target.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id=repo_id,
    local_dir=target,
    token=token,
    ignore_patterns=[
        "transformer/*.safetensors",
        "transformer/*.bin",
        "flux1-fill-dev.safetensors",
    ],
)
print(f"Support assets downloaded to {target}")
