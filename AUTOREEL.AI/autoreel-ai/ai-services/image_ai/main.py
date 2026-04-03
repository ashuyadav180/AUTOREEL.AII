"""
Image AI Service â€” AutoReel.AI
Stage 3: SDXL Image Generation via Stability AI
Port: 8006
"""
import os
import json
import time
import base64
import logging
import requests
from fastapi import FastAPI, APIRouter
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("image_ai")

# â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
STABILITY_API_KEY = os.getenv("STABILITY_API_KEY", "")
STABILITY_ENABLED = bool(STABILITY_API_KEY)

# Project root: ai-services/image_ai â†’ project root â†’ backend/storage/tmp
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP_DIR = os.path.join(PROJECT_ROOT, "backend", "storage", "tmp")
os.makedirs(TMP_DIR, exist_ok=True)

STABILITY_HOST = "https://api.stability.ai"
ENGINE_ID = "stable-diffusion-xl-1024-v1-0"
NEGATIVE_PROMPT = "blurry, low quality, watermark, text, logo, duplicate, bad anatomy, deformed, ugly, cartoon, anime"

if STABILITY_ENABLED:
    logger.info(f"âœ… Stability AI SDXL enabled (engine: {ENGINE_ID})")
else:
    logger.warning("âš ï¸ No STABILITY_API_KEY â€” image gen disabled")

router = APIRouter(title="Image AI", version="1.0")
app = FastAPI(title="Image AI", version="1.0")
app.include_router(router)

# â”€â”€ Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â”€â”€ HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@router.get("/health")
def health():
    return {"status": "ok", "stability_enabled": STABILITY_ENABLED}

# â”€â”€ GENERATE IMAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@router.post("/generate-images", response_model=ImageResponse)
def generate_images(data: ImageRequest):
    logger.info(f"ðŸŽ¨ [Stage 3] Generating {len(data.scenes)} SDXL images for: {data.topic}")

    if not STABILITY_ENABLED:
        logger.error("âŒ Stability AI not configured")
        return {"success": False, "message": "STABILITY_API_KEY not set"}

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
            logger.info(f"  âœ… Scene {scene.scene_index}: {os.path.basename(img_path)}")
        except Exception as e:
            logger.error(f"  âŒ Scene {scene.scene_index} failed: {e}")
            # Continue with other scenes
            images.append({
                "scene_index": scene.scene_index,
                "image_path": None,
                "error": str(e)
            })

    success_count = sum(1 for img in images if img.get("image_path"))
    logger.info(f"âœ… [Stage 3] {success_count}/{len(data.scenes)} images generated")

    return {
        "success": success_count > 0,
        "images": images,
        "message": f"{success_count}/{len(data.scenes)} images generated"
    }


def _generate_single_image(prompt: str, scene_idx: int, mood: str) -> str:
    """Call Stability AI API to generate a 9:16 portrait image."""

    # Enhance prompt with mood-based style suffix
    mood_suffix = {
        "intense":   "dramatic lighting, deep shadows, cinematic tension",
        "calm":      "soft golden light, peaceful atmosphere, serene",
        "inspiring": "epic wide shot, bright uplifting light, motivational",
        "shocking":  "high contrast, surreal, striking composition",
        "neutral":   "clean professional shot, 4K clarity",
    }.get(mood, "cinematic 4K")

    full_prompt = f"{prompt}, {mood_suffix}, photorealistic, sharp focus, professional photography"

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
        "height": 1344,   # 9:16 ratio
        "width": 768,
        "samples": 1,
        "steps": 30,
        "style_preset": "cinematic",
    }

    url = f"{STABILITY_HOST}/v1/generation/{ENGINE_ID}/text-to-image"
    resp = requests.post(url, headers=headers, json=payload, timeout=60)

    if resp.status_code != 200:
        raise Exception(f"Stability API error {resp.status_code}: {resp.text[:200]}")

    result = resp.json()
    artifacts = result.get("artifacts", [])
    if not artifacts:
        raise Exception("No image returned from Stability AI")

    # Save image
    image_data = base64.b64decode(artifacts[0]["base64"])
    img_path = os.path.join(TMP_DIR, f"sdxl_scene_{scene_idx}_{int(time.time())}.png")
    with open(img_path, "wb") as f:
        f.write(image_data)

    return img_path


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
