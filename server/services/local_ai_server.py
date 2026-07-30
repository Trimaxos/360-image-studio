#!/usr/bin/env python3
"""HTTP runtime for FLUX.1-Fill-dev with a GGUF transformer."""

from __future__ import annotations

import base64
import io
import os
import threading
import traceback
from pathlib import Path
from typing import Any

import torch
from diffusers import FluxFillPipeline, FluxTransformer2DModel, GGUFQuantizationConfig
from flask import Flask, jsonify, request
from PIL import Image

app = Flask(__name__)

MODEL_PATH = Path(os.getenv("MODEL_PATH", "/models/flux1-fill-dev-Q4_K_M.gguf"))
BAKED_BASE_PATH = Path(os.getenv("BASE_MODEL_PATH", "/opt/models/flux-fill-base"))
BASE_MODEL_ID = os.getenv("BASE_MODEL_ID", "black-forest-labs/FLUX.1-Fill-dev")
OFFLINE = os.getenv("LOCAL_AI_OFFLINE", "true").lower() == "true"
MAX_IMAGE_SIZE = int(os.getenv("MAX_IMAGE_SIZE", "1024"))
INFERENCE_STEPS = int(os.getenv("INFERENCE_STEPS", "28"))
GUIDANCE_SCALE = float(os.getenv("GUIDANCE_SCALE", "30"))

pipeline: FluxFillPipeline | None = None
pipeline_lock = threading.Lock()
state_lock = threading.Lock()
runtime_state: dict[str, Any] = {"status": "starting", "error": None}


def _base_model_source() -> str:
    if (BAKED_BASE_PATH / "model_index.json").is_file():
        return str(BAKED_BASE_PATH)
    return BASE_MODEL_ID


def _set_state(status: str, error: str | None = None) -> None:
    with state_lock:
        runtime_state["status"] = status
        runtime_state["error"] = error


def load_pipeline() -> FluxFillPipeline:
    global pipeline
    if pipeline is not None:
        return pipeline

    with pipeline_lock:
        if pipeline is not None:
            return pipeline
        _set_state("loading")
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA is unavailable inside the container")
            if not MODEL_PATH.is_file():
                raise FileNotFoundError(f"GGUF model not found: {MODEL_PATH}")

            source = _base_model_source()
            transformer = FluxTransformer2DModel.from_single_file(
                str(MODEL_PATH),
                quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
                config=source,
                subfolder="transformer",
                torch_dtype=torch.bfloat16,
                local_files_only=OFFLINE,
            )
            loaded = FluxFillPipeline.from_pretrained(
                source,
                transformer=transformer,
                torch_dtype=torch.bfloat16,
                local_files_only=OFFLINE,
            )
            loaded.enable_model_cpu_offload()
            loaded.enable_attention_slicing()
            if hasattr(loaded.vae, "enable_slicing"):
                loaded.vae.enable_slicing()
            if hasattr(loaded.vae, "enable_tiling"):
                loaded.vae.enable_tiling()
            pipeline = loaded
            _set_state("ready")
            return loaded
        except Exception as error:
            _set_state("error", str(error))
            traceback.print_exc()
            raise


def _preload() -> None:
    try:
        load_pipeline()
    except Exception:
        pass


def _decode_image(encoded: str, mode: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))).convert(mode)


def _inference_size(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, MAX_IMAGE_SIZE / max(width, height))
    scaled_width = max(64, round(width * scale))
    scaled_height = max(64, round(height * scale))
    return (
        max(64, (scaled_width // 16) * 16),
        max(64, (scaled_height // 16) * 16),
    )


@app.get("/health")
def health():
    with state_lock:
        status = runtime_state["status"]
        error = runtime_state["error"]
    payload: dict[str, Any] = {
        "status": status,
        "modelLoaded": pipeline is not None,
        "modelPath": str(MODEL_PATH),
        "baseModelBaked": (BAKED_BASE_PATH / "model_index.json").is_file(),
        "offline": OFFLINE,
        "cudaAvailable": torch.cuda.is_available(),
        "error": error,
    }
    if torch.cuda.is_available():
        payload["gpu"] = torch.cuda.get_device_name(0)
        payload["vramAllocatedGb"] = round(torch.cuda.memory_allocated() / 1024**3, 2)
    return jsonify(payload), 200 if status in {"starting", "loading", "ready"} else 503


@app.post("/inpaint")
def inpaint():
    data = request.get_json(silent=True) or {}
    missing = [key for key in ("base64Image", "base64Mask", "prompt") if not data.get(key)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        image = _decode_image(data["base64Image"], "RGB")
        mask = _decode_image(data["base64Mask"], "L")
        original_size = image.size
        target_size = _inference_size(*original_size)
        if image.size != target_size:
            image = image.resize(target_size, Image.Resampling.LANCZOS)
        if mask.size != target_size:
            mask = mask.resize(target_size, Image.Resampling.NEAREST)

        loaded = load_pipeline()
        with pipeline_lock, torch.inference_mode():
            result = loaded(
                image=image,
                mask_image=mask,
                prompt=str(data["prompt"]),
                num_inference_steps=int(data.get("numInferenceSteps", INFERENCE_STEPS)),
                guidance_scale=float(data.get("guidanceScale", GUIDANCE_SCALE)),
                height=target_size[1],
                width=target_size[0],
                max_sequence_length=512,
                generator=torch.Generator("cpu").manual_seed(int(data.get("seed", 0))),
            ).images[0]
        if result.size != original_size:
            result = result.resize(original_size, Image.Resampling.LANCZOS)
        output = io.BytesIO()
        result.save(output, format="PNG")
        return jsonify({
            "base64Result": base64.b64encode(output.getvalue()).decode("ascii"),
            "model": MODEL_PATH.name,
        })
    except Exception as error:
        return jsonify({"error": str(error)}), 503


if os.getenv("PRELOAD_MODEL", "true").lower() == "true":
    threading.Thread(target=_preload, name="model-preload", daemon=True).start()


if __name__ == "__main__":
    app.run(
        host=os.getenv("LOCAL_AI_HOST", "0.0.0.0"),
        port=int(os.getenv("LOCAL_AI_PORT", "8765")),
        threaded=True,
    )
