#!/usr/bin/env python3
"""
FLUX.1-Fill-dev GGUF inpainting server.
Persistent Flask HTTP server — model loaded once, kept in VRAM.
Node.js calls POST /inpaint with JSON { base64Image, base64Mask, prompt, modelPath }.
"""

import sys
import json
import base64
import io
import torch
from PIL import Image
from flask import Flask, request, jsonify
from diffusers import FluxFillPipeline, GGUFQuantizationConfig

app = Flask(__name__)
pipe = None


@app.route("/health")
def health():
    if pipe is not None:
        mem = torch.cuda.memory_allocated() / 1024**3
        return jsonify({"status": "ok", "vram_used_gb": round(mem, 1)})
    return jsonify({"status": "loading"}), 503


@app.route("/inpaint", methods=["POST"])
def inpaint():
    data = request.get_json()
    model_path = data.get("modelPath", "./models/flux1-fill-dev-Q4_K_M.gguf")

    # Decode inputs
    image = Image.open(io.BytesIO(base64.b64decode(data["base64Image"]))).convert("RGB")
    mask = Image.open(io.BytesIO(base64.b64decode(data["base64Mask"]))).convert("RGB")

    # Resize if tile > 1024px (save VRAM)
    max_size = 1024
    if image.width > max_size or image.height > max_size:
        scale = max_size / max(image.width, image.height)
        new_w, new_h = int(image.width * scale), int(image.height * scale)
        image = image.resize((new_w, new_h), Image.LANCZOS)
        mask = mask.resize((new_w, new_h), Image.LANCZOS)

    # Load model on first request (lazy init)
    global pipe
    if pipe is None:
        ckpt_config = GGUFQuantizationConfig.from_single_file(model_path)
        pipe = FluxFillPipeline.from_single_file(
            model_path,
            quantization_config=ckpt_config,
            torch_dtype=torch.float16,
        )
        pipe = pipe.to("cuda")
        pipe.enable_attention_slicing()

    # Run inpainting
    result = pipe(
        image=image,
        mask_image=mask,
        prompt=data["prompt"],
        num_inference_steps=28,
        height=image.height,
        width=image.width,
    ).images[0]

    # Encode result
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return jsonify({
        "base64Result": base64.b64encode(buf.getvalue()).decode("utf-8"),
        "model": "FLUX.1-Fill-dev-GGUF-Q4_K_M",
    })


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    app.run(host="127.0.0.1", port=port)
