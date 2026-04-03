"""
video_ai/main.py â€” AutoReel.ai (Vid.AI-Style Upgrade)
Professional video assembly pipeline with:
  - AI Scene Plans: uses script_ai scene JSON with per-scene visual directions
  - Fallback Scene Segmentation: script â†’ sentences â†’ keyword extraction
  - Per-scene Pexels keyword search (AI-directed, not stopword-extracted)
  - 10-20 micro-clips (2-4s each) for a 60s video
  - Zoom-punch pattern interrupts every 3rd clip
  - Per-clip mood-based color grading (intense/calm/shocking/inspiring)
  - FFmpeg color grade per category
  - Animated intro slate + 'FOLLOW FOR MORE' outro
  - MrBeast-style karaoke captions (ass_utils)
  - Category-specific background music
  - Auto-thumbnail generation
  - @AutoReelAI watermark
"""

from fastapi import FastAPI, APIRouter
from pydantic import BaseModel, Field
import subprocess
import time
import os
import logging
import requests
import random
import glob
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from ass_utils import generate_animated_ass
import json
from dotenv import load_dotenv

router = APIRouter()
app = FastAPI(title="Video AI", version="2.0")
app.include_router(router)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("video_ai")

# â”€â”€â”€ ENVIRONMENT LOADING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Prioritize backend/.env, then root .env
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
backend_env = os.path.join(PROJECT_ROOT, "backend", ".env")
root_env = os.path.join(PROJECT_ROOT, ".env")

logger.info(f"ðŸ“ PROJECT_ROOT: {PROJECT_ROOT}")
logger.info(f"ðŸ“‚ Loading backend env: {backend_env} (exists: {os.path.exists(backend_env)})")
logger.info(f"ðŸ“‚ Loading root env: {root_env} (exists: {os.path.exists(root_env)})")

load_dotenv(backend_env)
load_dotenv(root_env)

# â”€â”€â”€ CONFIG & CLIENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
PEXELS_API_KEY      = os.getenv("PEXELS_API_KEY")
RUNWAYML_API_SECRET = os.getenv("RUNWAYML_API_SECRET")
WATERMARK_TEXT      = os.getenv("WATERMARK_TEXT", "@AutoReelAI")

logger.info(f"ðŸ”‘ PEXELS_KEY found: {bool(PEXELS_API_KEY)}")
logger.info(f"ðŸ”‘ RUNWAY_KEY found: {bool(RUNWAYML_API_SECRET)}")

RUNWAY_CLIENT = None
if RUNWAYML_API_SECRET:
    try:
        from runwayml import RunwayML
        RUNWAY_CLIENT = RunwayML(api_key=RUNWAYML_API_SECRET)
    except ImportError:
        logger.warning("runwayml package not found. Run 'pip install runwayml' to enable Runway generation.")

VIDEO_DIR  = os.path.join(PROJECT_ROOT, "backend", "storage", "video")
TMP_DIR    = os.path.join(PROJECT_ROOT, "backend", "storage", "tmp")
MUSIC_ROOT = os.path.join(PROJECT_ROOT, "backend", "storage", "music")

os.makedirs(VIDEO_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

# â”€â”€â”€ MODELS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class VideoRequest(BaseModel):
    topic: str = Field(..., min_length=2)
    audio_path: str = Field(..., min_length=5)
    subtitle_path: str = Field(..., min_length=5)
    template: str = Field(default="motivation")
    category: str = Field(default="motivation")
    caption_style: str = Field(default="tiktok")
    background_url: str | None = None
    script: str | None = None          # full script for fallback scene segmentation
    scenes_json: str | None = None     # AI scene plan JSON from script_ai (preferred)
    layout: str = Field(default="full") # "full" or "split"
    render_mode: str = Field(default="stock") # "stock" | "ai_video" | "avatar"

class RawVideoRequest(BaseModel):
    prompt: str = Field(..., min_length=2)
    duration: float = Field(default=5.0)


# â”€â”€â”€ CATEGORY DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CATEGORY_KEYWORDS = {
    "motivation":      ["athlete training", "city sunrise", "running marathon", "gym workout", "mountain summit",
                        "person running", "sunrise timelapse", "hustle work", "winner trophy", "climbing mountain"],
    "storytelling":    ["cinematic nature", "person walking alone", "road journey", "emotional moment", "rain window",
                        "couple talking", "lonely street", "sunset silhouette", "vintage film", "dramatic sky"],
    "finance":         ["luxury lifestyle", "Wall Street trading", "stock market", "business meeting", "city skyscraper",
                        "cash money", "luxury car", "penthouse view", "bitcoin crypto", "entrepreneur working"],
    "dark_psychology": ["shadow silhouette", "chess strategy", "mysterious person", "dark cinematic", "mind puzzle",
                        "manipulation concept", "power struggle", "dark corridor", "psychological thriller", "crowd watching"],
    "ai_news":         ["technology data", "futuristic city", "computer code", "robot AI", "digital network",
                        "neural network visualization", "data center", "augmented reality", "drone footage city", "tech innovation"],
}

# Stopwords for keyword extraction
STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
    "and", "but", "or", "nor", "for", "so", "yet", "to", "of", "in", "on", "at",
    "by", "up", "as", "into", "with", "from", "not", "no", "don't", "doesn't",
    "here", "there", "when", "where", "why", "how", "all", "each", "every",
    "just", "now", "then", "also", "about", "what", "which", "who", "than",
    "more", "most", "very", "too", "only", "even", "still", "well", "much",
}

# FFmpeg color grade filter per category (base grades)
COLOR_GRADES = {
    "motivation":      "eq=contrast=1.12:saturation=1.35:brightness=0.02,colorbalance=rs=0.08:gs=-0.04:bs=-0.08",
    "storytelling":    "eq=contrast=1.06:saturation=0.88:brightness=-0.01,colorbalance=rs=-0.04:bs=0.08",
    "finance":         "eq=contrast=1.10:saturation=1.10:brightness=0.04,colorbalance=rs=0.04:gs=0.02:bs=-0.04",
    "dark_psychology": "eq=contrast=1.18:saturation=0.55:brightness=-0.06",
    "ai_news":         "eq=contrast=1.08:saturation=1.22,colorbalance=rs=-0.08:bs=0.14",
    "halku":           "eq=contrast=1.15:saturation=1.20:brightness=0.03,colorbalance=rs=0.05:bs=-0.05",
}

# Per-mood color grade overrides â€” applied per-clip when mood is available
MOOD_GRADES = {
    "intense":   "eq=contrast=1.20:saturation=1.40:brightness=0.01,colorbalance=rs=0.10:gs=-0.05:bs=-0.10",
    "shocking":  "eq=contrast=1.22:saturation=0.65:brightness=-0.04",
    "inspiring": "eq=contrast=1.08:saturation=1.25:brightness=0.04,colorbalance=rs=0.06:gs=0.02:bs=-0.04",
    "calm":      "eq=contrast=1.04:saturation=0.90:brightness=-0.01,colorbalance=rs=-0.03:bs=0.06",
}

# Intro/Outro accent colors per category
CATEGORY_COLORS = {
    "motivation":      ("0xFF5500", "FF5500"),
    "storytelling":    ("0xAA44FF", "AA44FF"),
    "finance":         ("0x00CC66", "00CC66"),
    "dark_psychology": ("0x3355AA", "3355AA"),
    "ai_news":         ("0x00CCFF", "00CCFF"),
    "halku":           ("0x00CC00", "00CC00"),
}

# â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def to_posix(path: str) -> str:
    return path.replace("\\", "/")

def clean_topic(topic: str) -> str:
    return re.sub(r'\s*\(v\d+\)', '', topic).strip()

def get_audio_duration(audio_abs: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        audio_abs
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"AUDIO_DURATION_FAILED: {r.stderr}")
    return float(r.stdout.strip())

def get_music_path(category: str) -> str | None:
    cat_track = os.path.join(MUSIC_ROOT, category, "track.mp3")
    if os.path.exists(cat_track):
        logger.info(f"ðŸŽµ Category music: {category}/track.mp3")
        return cat_track
    for folder in [os.path.join(MUSIC_ROOT, category), MUSIC_ROOT]:
        files = glob.glob(os.path.join(folder, "*.mp3")) + glob.glob(os.path.join(folder, "*.wav"))
        if files:
            chosen = random.choice(files)
            logger.info(f"ðŸŽµ Fallback music: {os.path.basename(chosen)}")
            return chosen
    return None

def get_satisfying_clip(duration: float) -> str | None:
    """Fetch a long continuous satisfying/gameplay clip for the bottom of split-screen."""
    if not PEXELS_API_KEY:
        return None
    keywords = ["satisfying sand", "asmr kinetic", "driving sunset", "parkour pov", "satisfying loop"]
    kw = random.choice(keywords)
    try:
        page = random.randint(1, 3)
        res = requests.get(
            f"https://api.pexels.com/videos/search?query={kw}&orientation=portrait&per_page=15&page={page}",
            headers={"Authorization": PEXELS_API_KEY}, timeout=10
        )
        if res.status_code == 200:
            videos = res.json().get("videos", [])
            # Try to find a clip long enough
            valid = [v for v in videos if v.get("duration", 0) >= duration - 2]
            if not valid:
                valid = videos
            if valid:
                video = random.choice(valid)
                files = video["video_files"]
                best = next((f for f in files if f.get("width", 0) >= 720), files[0])
                vid_path = os.path.join(TMP_DIR, f"bot_clip_{int(time.time())}.mp4")
                r = requests.get(best["link"], stream=True, timeout=20)
                with open(vid_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                logger.info(f"âœ… Bottom clip fetched: {kw}")
                return vid_path
    except Exception as e:
        logger.error(f"âŒ Bottom clip failed: {e}")
    return None

# â”€â”€â”€ SCENE PLANNING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def parse_ai_scene_plan(scenes_json: str, target_clip_count: int = 15) -> list:
    """
    Parse AI scene plan from script_ai. Each scene has:
      { text, visual, mood } â€” 'visual' is the Pexels search query.
    Returns list of { text, keywords, mood, index } for downstream processing.
    """
    import json as _json
    scenes_raw = _json.loads(scenes_json)

    if not scenes_raw or not isinstance(scenes_raw, list):
        return []

    scenes = []
    for i, s in enumerate(scenes_raw[:20]):  # cap at 20
        scenes.append({
            "text":     s.get("text", ""),
            "keywords": s.get("visual", "").strip() or "cinematic nature",  # AI visual direction
            "mood":     s.get("mood", "inspiring"),
            "index":    i,
            "hero":     s.get("hero", False)  # Capture hero flag
        })

    # Pad if needed
    while len(scenes) < min(target_clip_count, 8) and len(scenes) > 0:
        scenes = scenes + [{**s, "index": len(scenes) + j} for j, s in enumerate(scenes[:max(1, target_clip_count - len(scenes))])]

    logger.info(f"ðŸŽ¯ AI Scene Plan: {len(scenes)} scenes parsed")
    for s in scenes:
        logger.info(f"   [{s['mood'].upper()}] Scene {s['index']}: '{s['keywords']}' â† \"{s['text'][:45]}\"")

    return scenes


def segment_script_to_scenes(script: str, category: str, target_clip_count: int = 15) -> list:
    """
    Fallback: Split script into scenes using sentence segmentation + stopword filtering.
    Used when no AI scene plan is provided.
    """
    raw_sentences = re.split(r'(?<=[.!?])\s+|\n+', script.strip())
    sentences = [s.strip() for s in raw_sentences if len(s.strip()) > 3]

    if not sentences:
        return [{"text": script, "keywords": clean_topic(script), "mood": "inspiring"}]

    while len(sentences) < min(target_clip_count, 8) and len(sentences) > 0:
        sentences = sentences + sentences[:max(1, target_clip_count - len(sentences))]
    sentences = sentences[:20]

    scenes = []
    cat_kws = CATEGORY_KEYWORDS.get(category, CATEGORY_KEYWORDS["motivation"])

    for i, sentence in enumerate(sentences):
        words = re.findall(r"[a-zA-Z']+", sentence.lower())
        keywords = [w for w in words if w not in STOPWORDS and len(w) >= 4]

        if len(keywords) >= 2:
            query = " ".join(keywords[:2])
        elif len(keywords) == 1:
            cat_kw = cat_kws[i % len(cat_kws)]
            query = f"{keywords[0]} {cat_kw.split()[0]}"
        else:
            query = cat_kws[i % len(cat_kws)]

        scenes.append({"text": sentence, "keywords": query, "mood": "inspiring", "index": i})

    logger.info(f"ðŸ“‹ Fallback segmentation: {len(scenes)} scenes")
    return scenes

# â”€â”€â”€ PER-SCENE PEXELS CLIP SEARCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def fetch_single_clip(scene: dict, clip_dur: float, used_ids: set) -> str | None:
    """
    Fetch one Pexels clip for a single scene. Thread-safe (used_ids ignored in parallel,
    deduplication done post-fetch).
    Returns local tmp file path or None.
    """
    if not PEXELS_API_KEY:
        return None

    query = scene["keywords"]
    scene_idx = scene["index"]

    # Try scene keyword first, then broader search
    search_queries = [query, query.split()[0] if " " in query else query]

    for attempt_query in search_queries:
        try:
            page = random.randint(1, 4)
            res = requests.get(
                f"https://api.pexels.com/videos/search?query={attempt_query}&orientation=portrait&per_page=15&page={page}",
                headers={"Authorization": PEXELS_API_KEY}, timeout=12
            )
            if res.status_code != 200:
                continue

            videos = [v for v in res.json().get("videos", []) if v["id"] not in used_ids]
            if not videos:
                continue

            video = random.choice(videos[:5])  # pick from top 5 results for variety
            files = video["video_files"]
            # Prefer 720p+, fallback to any
            best = next((f for f in sorted(files, key=lambda x: x.get("width", 0), reverse=True)
                         if f.get("width", 0) >= 720), files[0])

            vid_path = os.path.join(TMP_DIR, f"raw_{scene_idx}_{int(time.time())}_{random.randint(100,999)}.mp4")
            r = requests.get(best["link"], stream=True, timeout=25)
            if r.status_code != 200:
                continue

            with open(vid_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)

            logger.info(f"   âœ… Scene {scene_idx}: '{attempt_query}' â†’ {os.path.basename(vid_path)}")
            return vid_path

        except Exception as e:
            logger.warning(f"   âš ï¸ Scene {scene_idx} fetch failed ({attempt_query}): {e}")
            continue

    return None


# Global flag: set to True if RunwayML credits are exhausted this session
_runway_credits_exhausted = False

def generate_runway_clip(scene: dict, clip_dur: float, used_ids: set) -> str | None:
    """Fetch video from RunwayML Gen-3 Alpha Turbo (gen3a_turbo)."""
    if not RUNWAYML_API_SECRET:
        return None
    
    # Check current session credits only if needed, don't block entire session
        
    try:
        from runwayml import RunwayML
        client = RunwayML(api_key=RUNWAYML_API_SECRET)

        base_prompt = scene["keywords"]
        prompt = f"{base_prompt}, cinematic, stunning composition, gorgeous lighting, masterpiece, 4k"
        scene_idx = scene["index"]
        logger.info(f"   ðŸš€ Runway Scene {scene_idx} queuing: '{base_prompt}'")
        logger.info(f"   [DEBUG] Sending to Runway model: veo3.1")

        # 2. Generate Video
        task = client.text_to_video.create(
            model="veo3.1",
            prompt_text=prompt,
            ratio="720:1280"
        )
        task_id = task.id
        logger.info(f"   ðŸŽ¬ Runway task created: {task_id}")

        # 3. Robust Polling Loop
        start_time = time.time()
        timeout = 900  # 15 minutes max per clip
        url = None
        while True:
            if time.time() - start_time > timeout:
                raise Exception("RunwayML generation timed out after 15 minutes")
            
            task = client.tasks.retrieve(task_id)
            logger.info(f"   [DEBUG] Runway status: {task.status}")
            
            if task.status == "SUCCEEDED":
                url = task.output[0]
                break
            elif task.status == "FAILED":
                raise Exception(f"Runway failed: {task.failure_reason}")
            elif task.status == "CANCELLED":
                raise Exception("Runway task cancelled")
                
            time.sleep(10)

        if not url:
            raise Exception("RunwayML succeeded but no video URL was returned.")

        # 4. Deduct Internal Credits
        try:
            credits_path = os.path.join(PROJECT_ROOT, "backend", "storage", "credits.json")
            if os.path.exists(credits_path):
                with open(credits_path, "r", encoding="utf-8") as f:
                    cdata = json.load(f)
                cdata["runway"]["used"] += 1
                cdata["runway"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                with open(credits_path, "w", encoding="utf-8") as f:
                    json.dump(cdata, f, indent=2)
                logger.info(f"   ðŸ“‰ Internal Credits: Runway used incremented to {cdata['runway']['used']}")
        except Exception as e:
            logger.error(f"   âš ï¸ Failed to update internal credits: {e}")

        # 5. Download output video
        vid_path = os.path.join(TMP_DIR, f"runway_{scene_idx}_{int(time.time())}.mp4")
        r = requests.get(url, stream=True, timeout=60)
        with open(vid_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info(f"   âœ… Runway Scene {scene_idx} completed & downloaded safely")
        return vid_path

    except Exception as e:
        logger.error(f"âŒ Runway Generation FAILED for Scene {scene['index']}: {e}")
        # We allow fallback now
        return None



def get_scene_clips(scenes: list, category: str, clip_dur: float) -> list:
    """
    Tiered clip fetching:
    - First RUNWAY_SCENE_CAP scenes â†’ RunwayML (sequential, respects credit budget)
    - Remaining scenes â†’ Pexels in parallel (fast)
    - Falls back to category keywords if any source fails
    """
    RUNWAY_SCENE_CAP = 3  # max RunwayML scenes per video (cost control)

    logger.info(f"ðŸŽžï¸ Fetching {len(scenes)} scene clips (target {clip_dur:.1f}s each)...")
    used_ids = set()
    results = [None] * len(scenes)
    cat_fallbacks = CATEGORY_KEYWORDS.get(category, CATEGORY_KEYWORDS["motivation"])

    # â”€â”€ TIER 1: RunwayML for "Hero" scenes (Sequential) â”€â”€
    if RUNWAYML_API_SECRET and not _runway_credits_exhausted:
        hero_scenes = [s for s in scenes if s.get("hero") is True]
        if not hero_scenes:
            hero_scenes = scenes[:1] # Always a hero shot at intro
            
        logger.info(f"   ðŸŽ¬ RunwayML Hero Mode: generating {len(hero_scenes)} high-impact scenes sequentially")
        for scene in hero_scenes:
            if _runway_credits_exhausted:
                logger.info("   âš¡ Runway credits exhausted mid-batch â€” switching to Pexels for remainder")
                break
            path = generate_runway_clip(scene, clip_dur, used_ids)
            results[scene["index"]] = path

    # â”€â”€ TIER 2: Pexels in parallel for all remaining scenes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    pexels_scenes = [s for s in scenes if results[s["index"]] is None]
    if pexels_scenes:
        logger.info(f"   ðŸ–¼ï¸ Pexels: fetching {len(pexels_scenes)} scenes in parallel...")
        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_idx = {
                executor.submit(fetch_single_clip, scene, clip_dur, used_ids): scene["index"]
                for scene in pexels_scenes
            }
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    path = future.result()
                    results[idx] = path
                except Exception as e:
                    logger.warning(f"   âš ï¸ Scene {idx} future failed: {e}")

    # â”€â”€ TIER 3: Category keyword fallback for any still-failed scenes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    failed_indices = [i for i, r in enumerate(results) if r is None]
    if failed_indices:
        logger.info(f"   ðŸ”„ Retrying {len(failed_indices)} failed scenes with category fallback...")
        for idx in failed_indices:
            fallback_kw = cat_fallbacks[idx % len(cat_fallbacks)]
            fallback_scene = {"index": idx, "keywords": fallback_kw, "text": ""}
            path = fetch_single_clip(fallback_scene, clip_dur, used_ids)
            results[idx] = path

    valid = [r for r in results if r is not None]
    logger.info(f"   ðŸ“¦ Got {len(valid)}/{len(scenes)} clips successfully")
    return results  # keep None placeholders to maintain scene sync

# â”€â”€â”€ INTRO / OUTRO SLATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def create_intro_slate(category: str, duration: float = 1.2) -> str:
    """Create an animated branded intro slate with category gradient + reveal animation."""
    color_hex, color_plain = CATEGORY_COLORS.get(category, ("0xFF5500", "FF5500"))
    out_path = os.path.join(TMP_DIR, f"intro_{int(time.time())}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0A0A0A:s=1080x1920:r=30:d={duration}",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={duration}",
        "-vf", (
            f"vignette=PI/4,"
            f"drawbox=x=0:y=(h/2)-130:w=iw:h=6:color={color_hex}@0.9:t=fill,"
            f"drawbox=x=0:y=(h/2)+100:w=iw:h=6:color={color_hex}@0.9:t=fill,"
            f"drawtext=text='AUTOREEL AI':fontcolor={color_hex}:fontsize=100:x=(w-text_w)/2:y=(h-text_h)/2-60"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0"
            f":alpha='if(lt(t,0.3),t/0.3,1)',"
            f"drawtext=text='SHORT FORM VIDEOS':fontcolor=0xCCCCCC:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2+90"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0"
            f":alpha='if(lt(t,0.3),0,if(lt(t,0.6),(t-0.3)/0.3,1))'"
        ),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-t", str(duration),
        to_posix(out_path)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        logger.warning(f"âš ï¸ Intro slate failed: {r.stderr[-200:]}")
        return None
    return out_path

def create_outro_slate(category: str, duration: float = 2.5) -> str:
    """Create a polished animated outro with pulsing CTA + accent bar + handle."""
    color_hex, _ = CATEGORY_COLORS.get(category, ("0xFF5500", "FF5500"))
    out_path = os.path.join(TMP_DIR, f"outro_{int(time.time())}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0A0A0A:s=1080x1920:r=30:d={duration}",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={duration}",
        "-vf", (
            f"vignette=PI/4,"
            f"drawbox=x=0:y=(h/2)-10:w=iw:h=8:color={color_hex}@0.95:t=fill,"
            f"drawtext=text='FOLLOW FOR MORE':fontcolor=0xFFFFFF:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2-120"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0"
            f":alpha='0.6+0.4*sin(2*PI*t/0.8)',"
            f"drawtext=text='@AutoReelAI':fontcolor={color_hex}:fontsize=58:x=(w-text_w)/2:y=(h-text_h)/2+80"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0"
            f":alpha='if(lt(t,0.4),t/0.4,1)'"
        ),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-t", str(duration),
        to_posix(out_path)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        logger.warning(f"âš ï¸ Outro slate failed: {r.stderr[-200:]}")
        return None
    return out_path

# â”€â”€â”€ THUMBNAIL GENERATOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def generate_thumbnail(video_abs: str, topic: str, category: str) -> str | None:
    """Extract sharpest frame from 3 candidates, add gradient bar + shadow title text."""
    color_hex, color_plain = CATEGORY_COLORS.get(category, ("0xFF5500", "FF5500"))
    thumb_name = f"thumb_{int(time.time())}.jpg"
    thumb_path = os.path.join(VIDEO_DIR, thumb_name)
    safe_topic = clean_topic(topic)[:28].upper()

    candidate_times = ["2.0", "4.0", "1.0"]
    extracted = None
    for ts in candidate_times:
        cand = os.path.join(TMP_DIR, f"thumb_cand_{int(time.time()*1000)}.jpg")
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", ts, "-i", to_posix(video_abs), "-vframes", "1", "-q:v", "1", to_posix(cand)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        if r.returncode == 0 and os.path.exists(cand):
            extracted = cand
            break

    if not extracted:
        logger.warning("âš ï¸ Thumbnail: no frame extracted")
        return None

    cmd = [
        "ffmpeg", "-y",
        "-i", to_posix(extracted),
        "-vf", (
            f"drawbox=x=0:y=h*0.62:w=iw:h=h*0.38:color=black@0.72:t=fill,"
            f"drawbox=x=0:y=h-12:w=iw:h=12:color={color_hex}@1.0:t=fill,"
            f"drawtext=text='{safe_topic}':fontcolor=0x000000:fontsize=82:x=(w-text_w)/2+4:y=h*0.72+4"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0,"
            f"drawtext=text='{safe_topic}':fontcolor=0xFFFFFF:fontsize=82:x=(w-text_w)/2:y=h*0.72"
            f":fontfile='C\\:/Windows/Fonts/impact.ttf':box=0"
        ),
        "-q:v", "2",
        to_posix(thumb_path)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode == 0:
        logger.info(f"ðŸ–¼ï¸ Thumbnail: {thumb_name}")
        return f"storage/video/{thumb_name}"
    logger.warning(f"âš ï¸ Thumbnail failed: {r.stderr[-200:]}")
    return None

# â”€â”€â”€ CLIP PROCESSING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def trim_and_grade_clip(clip_path: str, duration: float, color_grade: str, index: int, zoom_punch: bool = False, target_w: int = 1080, target_h: int = 1920, loop: bool = False) -> str | None:
    """Trim clip to duration, scale to target resolution, apply color grade + Ken Burns zoom."""
    out = os.path.join(TMP_DIR, f"graded_{index}_{int(time.time())}.mp4")
    frames = max(int(duration * 30), 1)
    
    zoom_max = "1.12" if zoom_punch else "1.08"
    x_expr = "iw/2-(iw/zoom/2)"
    y_expr = "ih/2-(ih/zoom/2)"
    
    if index % 2 == 1 and not zoom_punch:
        x_expr = "iw*0.15"
        y_expr = "ih/4"

    zoom_expr = f"min(zoom+0.0005,{zoom_max})"
    
    vf = (
        f"pad=ceil(iw/2)*2:ceil(ih/2)*2,"
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},"
        f"setsar=1,"
        f"zoompan=z='{zoom_expr}':d={frames}:s={target_w}x{target_h}:x='{x_expr}':y='{y_expr}':fps=30,"
        f"{color_grade}"
    )
    cmd = ["ffmpeg", "-y"]
    if loop:
        cmd.extend(["-stream_loop", "-1"])
    cmd.extend([
        "-i", to_posix(clip_path),
        "-ss", "1", "-t", str(duration),
        "-vf", vf,
        "-preset", "veryfast", "-c:v", "libx264", "-an", "-pix_fmt", "yuv420p",
        to_posix(out)
    ])
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode == 0:
        return out

    logger.warning(f"âš ï¸ Clip Ken Burns failed [{index}], retrying without zoom: {r.stderr[-200:]}")
    # Fallback without zoompan in case of issues
    vf_simple = (
        f"pad=ceil(iw/2)*2:ceil(ih/2)*2,"
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},setsar=1,{color_grade}"
    )
    cmd2 = ["ffmpeg", "-y"]
    if loop:
        cmd2.extend(["-stream_loop", "-1"])
    cmd2.extend([
        "-i", to_posix(clip_path),
        "-ss", "1", "-t", str(duration),
        "-vf", vf_simple,
        "-preset", "veryfast", "-c:v", "libx264", "-an", "-pix_fmt", "yuv420p",
        to_posix(out)
    ])
    r2 = subprocess.run(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r2.returncode == 0:
        return out
    logger.error(f"âŒ Clip grade failed [{index}]: {r2.stderr[-300:]}")
    return None


def concat_clips(trimmed: list) -> str:
    """Concatenate trimmed clips with smooth xfade crossfade dissolve transitions."""
    if len(trimmed) == 1:
        return trimmed[0]

    XFADE_DUR = 0.25  # shorter xfade for rapid-fire micro-clips
    out = os.path.join(TMP_DIR, f"raw_concat_{int(time.time())}.mp4")

    def clip_duration(path):
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        try:
            return float(r.stdout.strip())
        except:
            return 3.0

    durations = [clip_duration(p) for p in trimmed]

    inputs = []
    for p in trimmed:
        inputs.extend(["-i", to_posix(p)])

    # Build chained xfade filter
    fc_parts = []
    n = len(trimmed)
    offset = max(durations[0] - XFADE_DUR, 0.1)
    prev_label = "[0:v]"
    for i in range(1, n):
        next_label = f"[xf{i}]" if i < n - 1 else "[vout]"
        fc_parts.append(
            f"{prev_label}[{i}:v]xfade=transition=fade:duration={XFADE_DUR}:offset={offset:.3f}{next_label}"
        )
        prev_label = next_label
        if i < n - 1:
            offset += max(durations[i] - XFADE_DUR, 0.1)

    filter_complex = ";".join(fc_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        to_posix(out)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode == 0:
        return out

    # Fallback: hard-cut concat
    logger.warning(f"âš ï¸ xfade concat failed, falling back to hard-cut: {r.stderr[-200:]}")
    concat_file = os.path.join(TMP_DIR, f"concat_{int(time.time())}.txt")
    with open(concat_file, "w") as f:
        for p in trimmed:
            f.write(f"file '{to_posix(p)}'\n")
    cmd2 = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", to_posix(concat_file),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        to_posix(out)
    ]
    r2 = subprocess.run(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r2.returncode != 0:
        raise RuntimeError(f"Concat failed: {r2.stderr[-500:]}")
    return out


def combine_split_screen(top_vid: str, bot_vid: str, duration: float) -> str:
    """Combine two 1080x960 videos into one 1080x1920 video using vstack, with dividing line."""
    out = os.path.join(TMP_DIR, f"split_{int(time.time())}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-i", to_posix(top_vid),
        "-i", to_posix(bot_vid),
        "-filter_complex", (
            # Loop bottom video if it's shorter
            f"[1:v]loop=loop=-1:size=32767:start=0[bot];"
            f"[0:v][bot]vstack=inputs=2[stacked];"
            # Add a clear 10px dividing line in the middle (black)
            f"[stacked]drawbox=x=0:y=955:w=iw:h=10:color=black@0.9:t=fill[v_out]"
        ),
        "-map", "[v_out]",
        "-t", str(duration),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        to_posix(out)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Split-screen vstack failed: {r.stderr[-400:]}")
    return out


def burn_subtitles_watermark_audio(
    video_abs: str, audio_abs: str, music_abs: str | None,
    ass_rel: str, duration: float,
    watermark: str, output_abs: str
):
    """Final pass: burn ASS subtitles + watermark text + mix voice + music."""
    # On Windows, ASS filter paths need escaped colons: C:/path -> C\\:/path
    ass_posix = to_posix(ass_rel)
    # If the path starts with a drive letter like C:/, escape it for FFmpeg
    if len(ass_posix) > 2 and ass_posix[1] == ':':
        ass_escaped = ass_posix[0] + '\\\\:' + ass_posix[2:]
    else:
        ass_escaped = ass_posix
    sub_filter = f"ass='{ass_escaped}'"
    wm_filter  = f"drawtext=text='{watermark}':fontcolor=white@0.55:fontsize=36:x=w-text_w-30:y=h-text_h-60"

    cmd = ["ffmpeg", "-y", "-i", to_posix(video_abs), "-i", to_posix(audio_abs)]

    if music_abs:
        cmd.extend(["-i", to_posix(music_abs)])
        fc = (
            f"[0:v]{sub_filter},{wm_filter}[v];"
            f"[1:a]volume=1.0[voice];"
            f"[2:a]volume=0.11[music];"
            f"[voice][music]amix=inputs=2:duration=first:dropout_transition=2[a]"
        )
        cmd.extend(["-filter_complex", fc, "-map", "[v]", "-map", "[a]"])
    else:
        fc = (
            f"[0:v]{sub_filter},{wm_filter}[v];"
            f"[1:a]volume=1.0[a]"
        )
        cmd.extend(["-filter_complex", fc, "-map", "[v]", "-map", "[a]"])

    cmd.extend([
        "-t", str(duration), "-pix_fmt", "yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-ar", "44100",
        to_posix(output_abs)
    ])

    logger.info("ðŸ”¥ Final render: subtitles + watermark + progress bar + audio mix")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FINAL_RENDER_FAILED: {r.stderr[-800:]}")


def prepend_append_slates(main_video: str, intro: str | None, outro: str | None) -> str:
    """Concatenate intro + main_video + outro using file concat."""
    parts = []
    if intro and os.path.exists(intro):
        parts.append(intro)
    parts.append(main_video)
    if outro and os.path.exists(outro):
        parts.append(outro)

    if len(parts) == 1:
        return main_video

    concat_file = os.path.join(TMP_DIR, f"full_concat_{int(time.time())}.txt")
    with open(concat_file, "w") as f:
        for p in parts:
            f.write(f"file '{to_posix(p)}'\n")

    out = os.path.join(TMP_DIR, f"with_slates_{int(time.time())}.mp4")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", to_posix(concat_file),
        "-c:v", "libx264", "-c:a", "aac", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        to_posix(out)
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode == 0:
        return out
    logger.warning(f"âš ï¸ Slate concat failed â€” returning main video: {r.stderr[-200:]}")
    return main_video


def get_fallback_image(topic: str) -> str:
    seed = int(time.time() * 1000) % 1000000
    url = f"https://loremflickr.com/1080/1920/{clean_topic(topic).replace(' ', '-')}?lock={seed}"
    img_path = os.path.join(TMP_DIR, f"bg_{int(time.time())}.jpg")
    try:
        r = requests.get(url, timeout=10)
        with open(img_path, "wb") as f:
            f.write(r.content)
        return img_path
    except:
        return os.path.join(PROJECT_ROOT, "ai-services", "video_ai", "assets", "bg_motivation.jpg")


def single_clip_video(bg_path: str, is_image: bool, duration: float,
                       ass_rel: str, audio_abs: str, music_abs: str | None,
                       watermark: str, color_grade: str, output_abs: str,
                       target_w: int = 1080, target_h: int = 1920):
    """Single background (image or video) with grade + subtitles + watermark."""
    vf_parts = [
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase",
        f"crop={target_w}:{target_h}",
        "setsar=1",
        color_grade,
    ]

    if is_image:
        vf_parts.insert(3, f"zoompan=z='min(zoom+0.001,1.5)':d={int(duration*30)}:s={target_w}x{target_h}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'")
        input_args = ["-loop", "1", "-i", to_posix(bg_path)]
    else:
        input_args = ["-stream_loop", "-1", "-i", to_posix(bg_path)]

    vf_parts.append(f"ass='{to_posix(ass_rel)}'")
    vf_parts.append(f"drawtext=text='{watermark}':fontcolor=white@0.55:fontsize=36:x=w-text_w-30:y=h-text_h-60")

    vf = ",".join(vf_parts)
    cmd = ["ffmpeg", "-y", *input_args, "-i", to_posix(audio_abs)]

    if music_abs:
        cmd.extend(["-i", to_posix(music_abs)])
        af = "[1:a]volume=1.0[voice];[2:a]volume=0.11[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[a]"
        cmd.extend(["-filter_complex", f"[0:v]{vf}[v];{af}", "-map", "[v]", "-map", "[a]"])
    else:
        fc = f"[0:v]{vf}[v];[1:a]volume=1.0[a]"
        cmd.extend(["-filter_complex", fc, "-map", "[v]", "-map", "[a]"])

    cmd.extend([
        "-t", str(duration), "-pix_fmt", "yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-ar", "44100",
        to_posix(output_abs)
    ])
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"SINGLE_CLIP_FAILED: {r.stderr[-600:]}")

# â”€â”€â”€ HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/health")
def health():
    return {"status": "ok"}

# â”€â”€â”€ MAIN ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/generate-video")
def generate_video(data: VideoRequest):
    try:
        category = (data.category or "motivation").lower().strip()
        color_grade = COLOR_GRADES.get(category, COLOR_GRADES["motivation"])
        watermark = WATERMARK_TEXT

        logger.info(f"ðŸŽ¬ Video start | topic={data.topic} | category={category} | style={data.caption_style}")
        has_script = bool(data.script and len(data.script.strip()) > 10)
        logger.info(f"   Script provided: {has_script} ({len(data.script or '')} chars)")

        # â”€â”€ Resolve paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        def resolve_storage_path(rel_path: str) -> str:
            p = rel_path.replace("\\", "/")
            if p.startswith("storage/"):
                return os.path.normpath(os.path.join(PROJECT_ROOT, "backend", p))
            elif os.path.isabs(rel_path):
                return rel_path
            else:
                return os.path.normpath(os.path.join(PROJECT_ROOT, rel_path))

        audio_abs    = resolve_storage_path(data.audio_path)
        subtitle_abs = resolve_storage_path(data.subtitle_path)

        if not os.path.exists(audio_abs):
            raise FileNotFoundError(f"Audio file not found: {audio_abs}")
        if not os.path.exists(subtitle_abs):
            raise FileNotFoundError(f"Subtitle file not found: {subtitle_abs}")

        # â”€â”€ Generate ASS subtitles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        ass_abs = os.path.join(TMP_DIR, f"animated_{int(time.time())}.ass")
        generate_animated_ass(subtitle_abs, ass_abs, caption_style=data.caption_style)
        ass_rel = os.path.relpath(ass_abs, os.getcwd())

        duration = get_audio_duration(audio_abs)
        music_abs = get_music_path(category)

        video_name   = f"final_{int(time.time())}.mp4"
        rendered_abs = os.path.join(TMP_DIR, f"rendered_{int(time.time())}.mp4")
        output_abs   = os.path.join(VIDEO_DIR, video_name)

        # â”€â”€ Scene Planning & Micro-Clip Fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        scenes = []
        has_ai_plan = bool(data.scenes_json and data.scenes_json.strip())

        is_ai_video = (data.render_mode == "ai_video") or (category == "halku")
        is_avatar   = (data.render_mode == "avatar") and not is_ai_video

        logger.info(f"ðŸ” DEBUG: render_mode='{data.render_mode}', category='{category}', is_ai_video={is_ai_video}, is_avatar={is_avatar}")
        logger.info(f"ðŸ”‘ DEBUG: RUNWAYML_API_SECRET={'Set' if RUNWAYML_API_SECRET else 'MISSING'}")

        if RUNWAYML_API_SECRET and is_avatar and data.layout != "split":
            logger.info("ðŸŽ¬ RunwayML Avatar Mode: Generating 1 continuous avatar clip for lip-sync")
            prompt = f"Cinematic portrait of a person looking directly at the camera and talking, dramatic lighting, photorealistic, {category} theme"
            if data.topic:
                prompt += f", related to {data.topic}"
                
            scenes = [{"text": "", "keywords": prompt, "mood": "inspiring", "index": 0}]
            raw_clips = get_scene_clips(scenes, category, 10.0) # Runway handles 10s max
        elif PEXELS_API_KEY or (RUNWAYML_API_SECRET and is_ai_video):
            ideal_count = max(8, min(20, int(duration / 3)))

            if is_ai_video:
                # For AI Video, we want fewer but longer cinematic scenes (3-6s each) to keep it cinematic
                ideal_count = max(5, min(12, int(duration / 5)))
                if category == "halku" and (not data.caption_style or data.caption_style == "tiktok"):
                    data.caption_style = "halku"

            if has_ai_plan:
                # âœ… PREFERRED: Use AI scene plan from script_ai
                logger.info("ðŸŽ¯ Using AI scene plan (visual directions from script_ai)")
                try:
                    scenes = parse_ai_scene_plan(data.scenes_json, target_clip_count=ideal_count)
                except Exception as e:
                    logger.warning(f"âš ï¸ AI scene plan parse failed ({e}), falling back to script segmentation")
                    scenes = []

            if not scenes and has_script:
                # Fallback: segment script with stopword extraction
                logger.info("ðŸ“‹ Falling back to script sentence segmentation")
                scenes = segment_script_to_scenes(data.script, category, target_clip_count=ideal_count)

            if not scenes:
                # Last resort: generic category clips
                ideal_count = max(6, int(duration / 4))
                logger.info(f"ðŸ“¦ No script â€” fetching {ideal_count} generic category clips")
                cat_kws = CATEGORY_KEYWORDS.get(category, CATEGORY_KEYWORDS["motivation"])
                scenes = [
                    {"text": "", "keywords": cat_kws[i % len(cat_kws)], "mood": "inspiring", "index": i}
                    for i in range(ideal_count)
                ]

            clip_dur = duration / max(len(scenes), 1)
            clip_dur = max(2.0, min(4.5, clip_dur))
            logger.info(f"ðŸŽžï¸ {len(scenes)} scenes â†’ {clip_dur:.1f}s each (audio={duration:.1f}s)")
            raw_clips = get_scene_clips(scenes, category, clip_dur)
        else:
            raw_clips = []

        is_split = (data.layout.lower() == "split")
        target_h = 960 if is_split else 1920

        # â”€â”€ RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        valid_clips = [(i, p) for i, p in enumerate(raw_clips) if p is not None]

        raw_concat = None
        if len(valid_clips) >= 2:
            logger.info(f"ðŸŽ¬ MULTI-CLIP mode ({len(valid_clips)} clips) | split={is_split} | ai_plan={has_ai_plan}")
            clip_dur_real = duration / len(valid_clips)
            clip_dur_real = max(2.0, min(5.0, clip_dur_real))

            trimmed = []
            for idx, (orig_i, clip_path) in enumerate(valid_clips):
                is_punch = (idx % 3 == 2) and idx > 0
                # Use per-clip mood grade if available, else fall back to category grade
                clip_mood = scenes[orig_i].get("mood", "") if orig_i < len(scenes) else ""
                clip_grade = MOOD_GRADES.get(clip_mood, color_grade)
                t = trim_and_grade_clip(clip_path, clip_dur_real, clip_grade, idx, zoom_punch=is_punch, target_h=target_h)
                if t:
                    trimmed.append(t)

            if len(trimmed) >= 2:
                raw_concat = concat_clips(trimmed)
            elif len(trimmed) == 1:
                raw_concat = trimmed[0]
            else:
                raw_concat = valid_clips[0][1]

        elif len(valid_clips) == 1:
            logger.info(f"ðŸŽžï¸ SINGLE-CLIP mode | split={is_split}")
            raw_concat = trim_and_grade_clip(valid_clips[0][1], duration, color_grade, 0, target_h=target_h, loop=True)

        elif data.background_url:
            bg_path = os.path.join(TMP_DIR, f"ext_{int(time.time())}.mp4")
            try:
                r = requests.get(data.background_url, stream=True, timeout=15)
                with open(bg_path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        f.write(chunk)
                raw_concat = trim_and_grade_clip(bg_path, duration, color_grade, 0, target_h=target_h)
            except Exception as e:
                logger.error(f"âŒ External clip failed: {e}")
                bg_img = get_fallback_image(data.topic)
                raw_concat = trim_and_grade_clip(bg_img, duration, color_grade, 0, target_h=target_h)
        else:
            logger.info("ðŸ–¼ï¸ FALLBACK IMAGE mode")
            bg_img = get_fallback_image(data.topic)
            raw_concat = trim_and_grade_clip(bg_img, duration, color_grade, 0, target_h=target_h)
            
        # Optional: Split-screen composition (Vid.ai style)
        if is_split and raw_concat:
            bot_clip = get_satisfying_clip(duration)
            if bot_clip:
                # Grade the bottom clip to match target_h without specific zoompunch
                bot_graded = trim_and_grade_clip(bot_clip, duration, "eq=contrast=1.05", 999, target_h=target_h)
                if bot_graded:
                    logger.info("ðŸ”¥ Combining split-screen vstack layout")
                    raw_concat = combine_split_screen(raw_concat, bot_graded, duration)
            
        # Final pass: burn everything
        if raw_concat:
            burn_subtitles_watermark_audio(raw_concat, audio_abs, music_abs, ass_rel, duration, watermark, rendered_abs)

        # â”€â”€ INTRO + OUTRO SLATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        intro = create_intro_slate(category, duration=0.7)
        outro = create_outro_slate(category, duration=1.8)
        final_with_slates = prepend_append_slates(rendered_abs, intro, outro)

        import shutil
        shutil.copy2(final_with_slates, output_abs)

        # â”€â”€ THUMBNAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        thumb_rel = generate_thumbnail(output_abs, data.topic, category)

        logger.info(f"âœ… Video done: {video_name}")
        return {
            "success": True,
            "video_path": f"storage/video/{video_name}",
            "thumbnail_path": thumb_rel,
        }

    except Exception as e:
        logger.exception("âŒ Video generation error")
        return {"success": False, "error_code": "VIDEO_AI_FAILED", "message": str(e)}

@router.post("/generate-raw-clip")
def generate_raw_clip_endpoint(data: RawVideoRequest):
    """
    Direct prompt-to-video endpoint using RunwayML.
    Bypasses script generation, TTS, and FFmpeg composition.
    """
    logger.info(f"ðŸŽ¬ Raw prompt-to-video request: '{data.prompt}' ({data.duration}s)")
    scene_data = {"index": 999, "keywords": data.prompt}
    try:
        vid_path = generate_runway_clip(scene_data, data.duration, set())
        
        if not vid_path:
            logger.info("âš¡ Runway failed or skipped, falling back to Pexels...")
            vid_path = fetch_single_clip(scene_data, data.duration, set())
            
            # Trim the Pexels clip to exact requested duration using FFmpeg
            if vid_path and os.path.exists(vid_path):
                import subprocess
                trimmed_path = os.path.join(TMP_DIR, f"trimmed_raw_{int(time.time())}.mp4")
                cmd = [
                    "ffmpeg", "-y", "-i", vid_path,
                    "-t", str(data.duration),
                    "-c:v", "libx264", "-preset", "fast", "-an",
                    trimmed_path
                ]
                r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if r.returncode == 0:
                    vid_path = trimmed_path

        if vid_path:
            # Reformat to match storage mapping (assuming backend serves storage/tmp)
            filename = os.path.basename(vid_path)
            return {
                "success": True,
                "video_path": f"storage/tmp/{filename}",
                "message": "Generated using Stock Fallback" if "runway" not in vid_path else "Generated using RunwayML"
            }
        else:
            return {"success": False, "error_code": "GENERATION_FAILED", "message": "Both RunwayML and Stock fallback failed"}
    except Exception as e:
        logger.exception("âŒ Raw video generation error")
        return {"success": False, "error_code": "RAW_VIDEO_FAILED", "message": str(e)}


# â”€â”€â”€ FULL PIPELINE: img2video + render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class RenderFullRequest(BaseModel):
    images: list[dict]          # [{scene_index, image_path, imagePrompt, duration_s}]
    audio_path: str             # absolute path to voice MP3 (ElevenLabs output)
    subtitle_path: str          # path to .srt file
    category: str = "motivation"
    topic: str = ""
    caption_style: str = "tiktok"


@router.post("/render-full")
def render_full(data: RenderFullRequest):
    """
    Stage 4 + 7 combined:
    - For each image: call RunwayML Gen-3 img2video â†’ 5s clip
    - Concatenate all clips
    - Mix ElevenLabs voice + Suno background music
    - Burn in subtitles
    - Output final 720x1280 MP4 (YouTube Shorts format)
    """
    try:
        category = data.category.lower().strip()
        color_grade = COLOR_GRADES.get(category, COLOR_GRADES["motivation"])

        logger.info(f"ðŸŽ¬ [Stage 4+7] render-full | {len(data.images)} images | topic: {data.topic}")

        # 1. Validate audio + subtitle paths
        audio_abs = data.audio_path if os.path.isabs(data.audio_path) else os.path.join(PROJECT_ROOT, "backend", data.audio_path)
        subtitle_abs = data.subtitle_path if os.path.isabs(data.subtitle_path) else os.path.join(PROJECT_ROOT, "backend", data.subtitle_path)

        if not os.path.exists(audio_abs):
            raise FileNotFoundError(f"Audio not found: {audio_abs}")

        audio_duration = get_audio_duration(audio_abs)

        # 2. Convert each SDXL image â†’ video clip via RunwayML (Stage 4)
        clip_paths = []
        for img_data in sorted(data.images, key=lambda x: x.get("scene_index", 0)):
            if not img_data.get("image_path") or not os.path.exists(img_data["image_path"]):
                logger.warning(f"  âš ï¸ Skipping missing image: {img_data.get('image_path')}")
                continue

            try:
                logger.info(f"  ðŸŽ¥ RunwayML img2video: scene {img_data.get('scene_index', '?')}")
                clip = _image_to_video_runway(
                    image_path=img_data["image_path"],
                    prompt=img_data.get("imagePrompt", f"cinematic {data.topic}"),
                    scene_idx=img_data.get("scene_index", len(clip_paths)),
                    clip_dur=img_data.get("duration_s", 5)
                )
                if clip:
                    clip_paths.append(clip)
                    logger.info(f"  âœ… Scene {img_data.get('scene_index')}: {os.path.basename(clip)}")
            except Exception as e:
                logger.error(f"  âŒ RunwayML failed for scene {img_data.get('scene_index')}: {e}")

        if not clip_paths:
            raise Exception("No video clips generated â€” all RunwayML calls failed")

        # 3. Concatenate clips (Stage 7)
        logger.info(f"ðŸŽžï¸ Concatenating {len(clip_paths)} clips...")
        concat_path = os.path.join(TMP_DIR, f"concat_{int(time.time())}.mp4")

        # Each clip: scale to 720x1280, trim to equal duration
        per_clip_dur = audio_duration / len(clip_paths)
        per_clip_dur = max(2.0, min(6.0, per_clip_dur))

        trimmed = []
        for i, cp in enumerate(clip_paths):
            trimmed_path = os.path.join(TMP_DIR, f"trim_{i}_{int(time.time())}.mp4")
            cmd = [
                "ffmpeg", "-y", "-i", cp,
                "-t", str(per_clip_dur),
                "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
                "-c:v", "libx264", "-preset", "fast", "-an",
                trimmed_path
            ]
            r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode == 0:
                trimmed.append(trimmed_path)

        # Write concat list
        concat_list = os.path.join(TMP_DIR, f"concat_list_{int(time.time())}.txt")
        with open(concat_list, "w") as f:
            for tp in trimmed:
                f.write(f"file '{tp}'\n")

        cmd_concat = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c:v", "libx264", "-preset", "fast", "-an", concat_path
        ]
        subprocess.run(cmd_concat, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

        # 4. Mix voice + Suno background music
        music_abs = get_music_path(category)
        logger.info(f"ðŸŽµ Music: {music_abs}")

        # 5. Generate ASS subtitles
        ass_path = os.path.join(TMP_DIR, f"subs_{int(time.time())}.ass")
        if os.path.exists(subtitle_abs):
            generate_animated_ass(subtitle_abs, ass_path, caption_style=data.caption_style)

        # 6. Final FFmpeg render: concat + voice + music + subtitles + color grade + watermark
        video_name = f"final_{int(time.time())}.mp4"
        output_abs = os.path.join(VIDEO_DIR, video_name)

        # Build filter chain
        vf_parts = [
            f"scale=720:1280:force_original_aspect_ratio=increase",
            "crop=720:1280",
        ] + color_grade

        if os.path.exists(ass_path):
            ass_escaped = ass_path.replace("\\", "/").replace(":", "\\:")
            vf_parts.append(f"ass='{ass_escaped}'")

        vf_parts.append(
            f"drawtext=text='{WATERMARK_TEXT}':fontsize=28:fontcolor=white@0.7:"
            f"x=w-tw-10:y=h-th-10:shadowx=2:shadowy=2"
        )

        vf_str = ",".join(vf_parts)

        if music_abs and os.path.exists(music_abs):
            cmd_render = [
                "ffmpeg", "-y",
                "-i", concat_path,
                "-i", audio_abs,
                "-i", music_abs,
                "-filter_complex",
                f"[1:a]volume=1.0[voice];[2:a]volume=0.2[music];[voice][music]amix=inputs=2:duration=first[audio]",
                "-map", "0:v",
                "-map", "[audio]",
                "-vf", vf_str,
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-c:a", "aac", "-b:a", "128k",
                "-t", str(audio_duration + 0.5),
                "-movflags", "+faststart",
                output_abs
            ]
        else:
            cmd_render = [
                "ffmpeg", "-y",
                "-i", concat_path,
                "-i", audio_abs,
                "-map", "0:v", "-map", "1:a",
                "-vf", vf_str,
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-c:a", "aac", "-b:a", "128k",
                "-t", str(audio_duration + 0.5),
                "-shortest",
                "-movflags", "+faststart",
                output_abs
            ]

        logger.info("ðŸŽ¬ Final render starting...")
        r = subprocess.run(cmd_render, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"FFmpeg render failed: {r.stderr[-600:]}")

        # Generate thumbnail
        thumb_name = video_name.replace(".mp4", "_thumb.jpg")
        thumb_abs = os.path.join(VIDEO_DIR, thumb_name)
        subprocess.run([
            "ffmpeg", "-y", "-i", output_abs,
            "-ss", "00:00:01.000", "-vframes", "1",
            "-vf", "scale=720:1280", thumb_abs
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        logger.info(f"âœ… [Stage 7] render-full done: {video_name}")
        return {
            "success": True,
            "video_path": f"storage/video/{video_name}",
            "thumbnail_path": f"storage/video/{thumb_name}" if os.path.exists(thumb_abs) else None,
            "clips_generated": len(clip_paths),
            "message": f"Rendered via RunwayML img2video + FFmpeg"
        }

    except Exception as e:
        logger.exception("âŒ render-full error")
        return {"success": False, "message": str(e)}


def _image_to_video_runway(image_path: str, prompt: str, scene_idx: int, clip_dur: int = 5) -> str | None:
    """
    Convert a single SDXL image to a 5s video clip via RunwayML Gen-3 Alpha img2video.
    Returns local file path or None on failure.
    """
    if not RUNWAY_CLIENT:
        logger.warning(f"  âš ï¸ RunwayML not configured â€” skipping scene {scene_idx}")
        return None

    try:
        import base64

        # Read and encode image as data URI
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        img_uri = f"data:image/png;base64,{img_b64}"

        duration_val = 5  # RunwayML only supports 5 or 10
        if clip_dur >= 8:
            duration_val = 10

        task = RUNWAY_CLIENT.image_to_video.create(
            model="gen3a_turbo",
            prompt_image=img_uri,
            prompt_text=prompt[:500],
            duration=duration_val,
            ratio="720:1280",
            watermark=False,
        )
        task_id = task.id

        # Poll for completion
        start = time.time()
        while True:
            if time.time() - start > 600:  # 10 min timeout
                raise Exception("RunwayML img2video timed out")
            task = RUNWAY_CLIENT.tasks.retrieve(task_id)
            if task.status == "SUCCEEDED":
                url = task.output[0]
                break
            elif task.status in ("FAILED", "CANCELLED"):
                raise Exception(f"RunwayML task {task.status}: {task.failure_reason}")
            time.sleep(8)

        # Download
        vid_path = os.path.join(TMP_DIR, f"runway_img2vid_{scene_idx}_{int(time.time())}.mp4")
        r = requests.get(url, stream=True, timeout=60)
        with open(vid_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

        return vid_path

    except Exception as e:
        logger.error(f"  âŒ RunwayML img2video failed: {e}")
        return None
