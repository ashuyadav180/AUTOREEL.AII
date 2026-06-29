"""
Image AI Service - AutoReel.AI
Stage 3: Image Generation
Priority: Pollinations AI (FREE) → Stability SDXL (paid fallback)
Port: 8006
"""
import os
import json
import time
import base64
import logging
import requests
import urllib.parse
from fastapi import FastAPI, APIRouter
from pydantic import BaseModel
from dotenv import load_dotenv

# Project root: ai-services/image_ai → project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
backend_env = os.path.join(PROJECT_ROOT, "backend", ".env")
root_env = os.path.join(PROJECT_ROOT, ".env")

load_dotenv(backend_env)
load_dotenv(root_env)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("image_ai")

# ── Config ────────────────────────────────────────────────────────────────────
STABILITY_API_KEY = os.getenv("STABILITY_API_KEY", "")
STABILITY_ENABLED = bool(STABILITY_API_KEY)
HF_API_TOKEN      = os.getenv("HF_API_TOKEN", "")
HF_IMAGE_ENABLED  = bool(HF_API_TOKEN)

TMP_DIR = os.path.join(PROJECT_ROOT, "backend", "storage", "tmp")
os.makedirs(TMP_DIR, exist_ok=True)

STABILITY_HOST = "https://api.stability.ai"
ENGINE_ID = "stable-diffusion-xl-1024-v1-0"
NEGATIVE_PROMPT = "blurry, low quality, watermark, text, logo, duplicate, bad anatomy, deformed, ugly, cartoon, anime"

logger.info("✅ Pollinations AI enabled (FREE fallback)")
if STABILITY_ENABLED:
    logger.info(f"✅ Stability AI SDXL enabled as primary (engine: {ENGINE_ID})")
else:
    logger.info("ℹ️ Stability API not configured. Using fallback engines.")

router = APIRouter()
app = FastAPI(title="Image AI", version="2.0")

# ── Models ────────────────────────────────────────────────────────────────────
class Scene(BaseModel):
    scene_index: int
    imagePrompt: str
    mood: str = "inspiring"
    duration_s: int = 5

class ImageRequest(BaseModel):
    scenes: list[Scene]
    topic: str = ""
    category: str = "motivation"

class ImageResponse(BaseModel):
    success: bool
    images: list[dict] = []   # [{scene_index, image_path}]
    message: str | None = None

# ── HEALTH ────────────────────────────────────────────────────────────────────
@router.get("/health")
def health():
    return {
        "status": "ok",
        "primary": "stability_sdxl" if STABILITY_ENABLED else "pollinations_ai",
        "fallback_1": "pollinations_ai" if STABILITY_ENABLED else "none",
        "fallback_2": "hf_flux1" if HF_IMAGE_ENABLED else "none",
    }


# ── GENERATE IMAGES ───────────────────────────────────────────────────────────
@router.post("/generate-images", response_model=ImageResponse)
def generate_images(data: ImageRequest):
    logger.info(f"🎨 [Stage 3] Generating {len(data.scenes)} images for: {data.topic}")

    images = []
    for scene in data.scenes:
        try:
            img_path = _generate_single_image(
                prompt=scene.imagePrompt,
                scene_idx=scene.scene_index,
                mood=scene.mood
            )
            images.append({
                "scene_index": scene.scene_index,
                "image_path": img_path,
                "imagePrompt": scene.imagePrompt
            })
            logger.info(f"  ✅ Scene {scene.scene_index}: {os.path.basename(img_path)}")
        except Exception as e:
            logger.error(f"  ❌ Scene {scene.scene_index} failed: {e}")
            # Continue with other scenes
            images.append({
                "scene_index": scene.scene_index,
                "image_path": None,
                "imagePrompt": scene.imagePrompt,
                "error": str(e)
            })

    success_count = sum(1 for img in images if img.get("image_path"))
    logger.info(f"✅ [Stage 3] {success_count}/{len(data.scenes)} images generated")

    return {
        "success": success_count > 0,
        "images": images,
        "message": f"{success_count}/{len(data.scenes)} images generated"
    }


def _generate_single_image(prompt: str, scene_idx: int, mood: str) -> str:
    """Generate image. Priority: Stability SDXL (primary) → Pollinations AI (fallback)."""

    # Clean up extremely long prompts by stripping out the repetitive user topic prefix
    if "showing" in prompt:
        parts = prompt.split("showing", 1)
        prompt = "showing" + parts[1]
        
    # Standard fallback truncation to guarantee we never exceed URL limits
    if len(prompt) > 250:
        words = prompt.split()
        if len(words) > 30:
            prompt = " ".join(words[:30]) + "..."
        else:
            prompt = prompt[:250] + "..."

    # Enhance prompt with mood-based style suffix
    mood_suffix = {
        "intense":   "dramatic lighting, deep shadows, cinematic tension",
        "calm":      "soft golden light, peaceful atmosphere, serene",
        "inspiring": "epic wide shot, bright uplifting light, motivational",
        "shocking":  "high contrast, surreal, striking composition",
        "neutral":   "clean professional shot, 4K clarity",
    }.get(mood, "cinematic 4K")

    STYLE_PREFIX = "cinematic, dark moody lighting, high contrast, professional photography, 8k, sharp focus, consistent color grading"
    full_prompt = f"{prompt}, {mood_suffix}, {STYLE_PREFIX}, photorealistic, sharp focus, professional photography"

    image_data = None

    # ── TIER 1: Stability SDXL (paid primary) ──
    if STABILITY_ENABLED:
        try:
            logger.info(f"   🎨 Stability SDXL (paid): scene {scene_idx}...")
            headers = {
                "Authorization": f"Bearer {STABILITY_API_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }

            payload = {
                "text_prompts": [
                    {"text": full_prompt, "weight": 1.0},
                    {"text": NEGATIVE_PROMPT, "weight": -1.0}
                ],
                "cfg_scale": 7,
                "height": 1344,   # Fixed: divisible by 64 (standard vertical SDXL)
                "width": 768,     # Fixed: divisible by 64
                "samples": 1,
                "steps": 30,
                "style_preset": "cinematic",
            }

            url = f"{STABILITY_HOST}/v1/generation/{ENGINE_ID}/text-to-image"
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                result = resp.json()
                artifacts = result.get("artifacts", [])
                if artifacts:
                    image_data = base64.b64decode(artifacts[0]["base64"])
                    logger.info(f"   ✅ Stability SDXL succeeded for scene {scene_idx}")
            else:
                logger.warning(f"   ⚠️ Stability returned status {resp.status_code}. Response: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"   ⚠️ Stability SDXL failed ({e}). Trying Hugging Face / Pollinations fallback...")

    # ── TIER 2: Hugging Face FLUX.1-schnell (free secondary) ──
    if image_data is None and HF_IMAGE_ENABLED:
        try:
            logger.info(f"   🎨 Hugging Face FLUX.1-schnell: scene {scene_idx}...")
            model_id = "black-forest-labs/FLUX.1-schnell"
            hf_url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
            hf_headers = {
                "Authorization": f"Bearer {HF_API_TOKEN}"
            }
            hf_payload = {
                "inputs": full_prompt,
                "parameters": {
                    "width": 768,
                    "height": 1344
                }
            }
            resp = requests.post(hf_url, headers=hf_headers, json=hf_payload, timeout=30)
            if resp.status_code == 200 and len(resp.content) > 5000:
                image_data = resp.content
                logger.info(f"   ✅ Hugging Face FLUX.1-schnell succeeded for scene {scene_idx}")
            else:
                logger.warning(f"   ⚠️ Hugging Face returned status {resp.status_code}. Response: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"   ⚠️ Hugging Face FLUX.1-schnell failed ({e}). Trying Pollinations AI fallback...")

    # ── TIER 3: Pollinations AI (FREE, fallback) ──
    if image_data is None:
        try:
            safe_prompt = urllib.parse.quote(full_prompt)
            # Optimized to 768x1344 to prevent free tier timeouts
            pollinations_url = f"https://image.pollinations.ai/prompt/{safe_prompt}?width=768&height=1344&nologo=true"
            logger.info(f"   🎨 Pollinations AI (free fallback): scene {scene_idx}...")
            resp = requests.get(pollinations_url, timeout=45)
            if resp.status_code == 200 and len(resp.content) > 5000:
                image_data = resp.content
                logger.info(f"   ✅ Pollinations AI (fallback) succeeded for scene {scene_idx}")
            else:
                logger.warning(f"   ⚠️ Pollinations returned status {resp.status_code} or small image")
        except Exception as e:
            logger.error(f"   ❌ Pollinations AI fallback also failed: {e}")

    if image_data is None:
        raise Exception("All image providers failed: Pollinations, HF FLUX.1, and Stability SDXL")

    # Save image to temp dir
    img_path = os.path.join(TMP_DIR, f"img_scene_{scene_idx}_{int(time.time())}.png")
    with open(img_path, "wb") as f:
        f.write(image_data)

    return img_path

app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
