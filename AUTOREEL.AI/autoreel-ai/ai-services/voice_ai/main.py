"""
Voice AI â€” AutoReel.ai (Vid.AI Quality Upgrade)
Priority: ElevenLabs API (premium, natural voice) â†’ Edge TTS (free fallback)

Set ELEVENLABS_API_KEY in backend/.env to enable premium voices.
"""

from fastapi import FastAPI, APIRouter
from pydantic import BaseModel, Field
import os
import time
import asyncio
import requests
import edge_tts

router = APIRouter()
app = FastAPI(title="Voice AI", version="2.0")
app.include_router(router)

# â”€â”€â”€ ENV SETUP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _load_backend_env():
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env"))
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_backend_env()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_ENABLED = bool(ELEVENLABS_API_KEY)

if ELEVENLABS_ENABLED:
    print("[OK] ElevenLabs voice enabled (premium quality)")
else:
    print("[INFO] ElevenLabs not configured - using Edge TTS (free). Add ELEVENLABS_API_KEY to backend/.env to upgrade.")

# â”€â”€â”€ MODELS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class VoiceRequest(BaseModel):
    text: str = Field(..., min_length=10)
    language: str = Field(default="en-US")
    gender: str = Field(default="male")   # "male" or "female"

class VoiceResponse(BaseModel):
    success: bool
    audio_path: str | None = None
    voice: str | None = None
    provider: str | None = None
    error_code: str | None = None
    message: str | None = None

# â”€â”€â”€ PATHS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

BASE_DIR  = os.path.dirname(__file__)
AUDIO_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "backend", "storage", "audio"))
os.makedirs(AUDIO_DIR, exist_ok=True)

# â”€â”€â”€ ELEVENLABS VOICES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# High-quality pre-made voices by language + gender
# Browse all voices at: https://elevenlabs.io/voice-library
ELEVENLABS_VOICES = {
    "en-US": {
        "male":   "nPczCjzI2devNBz1zQrb",   # Brian â€” deep, authoritative American
        "female": "EXAVITQu4vr4xnSDxMaL",   # Bella â€” clear, warm American female
    },
    "en-GB": {
        "male":   "CYw3kZ02Hs0563khs1Fj",   # Dave â€” British male
        "female": "ThT5KcBeYPX3keUQqHPh",   # Dorothy â€” British female
    },
    "hi-IN": {
        "male":   "YOUR_HINDI_MALE_VOICE_ID",    # Replace with Indian Male Voice ID
        "female": "6V9kz8WiEZCuxIP4zw8F",  # User's chosen Hindi female Voice ID
    },
}

ELEVENLABS_DEFAULT_VOICE = "nPczCjzI2devNBz1zQrb"  # Brian

def get_elevenlabs_voice_id(language: str, gender: str) -> str:
    lang_voices = ELEVENLABS_VOICES.get(language, ELEVENLABS_VOICES.get("en-US", {}))
    voice_id = lang_voices.get(gender)
    return voice_id or ELEVENLABS_DEFAULT_VOICE

# â”€â”€â”€ EDGE TTS VOICES (FREE FALLBACK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
EDGE_TTS_VOICE_MAP = {
    "en-US": {"male": "en-US-ChristopherNeural",  "female": "en-US-JennyNeural"},
    "en-GB": {"male": "en-GB-RyanNeural",         "female": "en-GB-SoniaNeural"},
    "hi-IN": {"male": "hi-IN-MadhurNeural",       "female": "hi-IN-SwaraNeural"},
    "es-ES": {"male": "es-ES-AlvaroNeural",       "female": "es-ES-ElviraNeural"},
    "es-MX": {"male": "es-MX-JorgeNeural",        "female": "es-MX-DaliaNeural"},
    "fr-FR": {"male": "fr-FR-HenriNeural",        "female": "fr-FR-DeniseNeural"},
    "ar-SA": {"male": "ar-SA-HamedNeural",        "female": "ar-SA-ZariyahNeural"},
    "pt-BR": {"male": "pt-BR-AntonioNeural",      "female": "pt-BR-FranciscaNeural"},
    "de-DE": {"male": "de-DE-ConradNeural",       "female": "de-DE-KatjaNeural"},
    "ja-JP": {"male": "ja-JP-KeitaNeural",        "female": "ja-JP-NanamiNeural"},
    "ko-KR": {"male": "ko-KR-InJoonNeural",       "female": "ko-KR-SunHiNeural"},
    "zh-CN": {"male": "zh-CN-YunxiNeural",        "female": "zh-CN-XiaoxiaoNeural"},
}
DEFAULT_EDGE_VOICE = "en-US-ChristopherNeural"

# â”€â”€â”€ GENERATION FUNCTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def generate_with_elevenlabs(text: str, voice_id: str, output_path: str) -> bool:
    """
    Generate voice using ElevenLabs API.
    Returns True on success, False on failure.
    """
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "Accept":       "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key":   ELEVENLABS_API_KEY,
    }
    payload = {
        "text": text,
        "model_id": "eleven_turbo_v2",        # fast + high quality
        "voice_settings": {
            "stability":        0.50,          # 0=expressive, 1=stable
            "similarity_boost": 0.80,          # voice clarity
            "style":            0.35,          # expressiveness (0-1)
            "use_speaker_boost": True,
        }
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        if resp.status_code == 200:
            # ElevenLabs returns MP3
            mp3_path = output_path.replace(".wav", ".mp3")
            with open(mp3_path, "wb") as f:
                f.write(resp.content)
            # Return the mp3 path by renaming â€” downstream handles both
            os.replace(mp3_path, output_path.replace(".wav", ".mp3"))
            return True
        else:
            print(f"[WARN] ElevenLabs error {resp.status_code}: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"[WARN] ElevenLabs request failed: {e}")
        return False

# â”€â”€â”€ HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/health")
def health():
    return {
        "status": "ok",
        "elevenlabs": ELEVENLABS_ENABLED,
        "provider": "elevenlabs" if ELEVENLABS_ENABLED else "edge_tts",
    }

# â”€â”€â”€ ENDPOINT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/generate-voice")
async def generate_voice(data: VoiceRequest):
    try:
        import re
        if re.search(r'[\u0900-\u097F]', data.text):
            data.language = "hi-IN"
            
        gender = data.gender.lower() if data.gender in ("male", "female") else "male"
        timestamp = int(time.time())

        # Try ElevenLabs first if configured
        if ELEVENLABS_ENABLED:
            voice_id  = get_elevenlabs_voice_id(data.language, gender)
            # Check if ElevenLabs supports this language (None means use Edge TTS)
            lang_map  = ELEVENLABS_VOICES.get(data.language, {})
            has_voice = lang_map.get(gender) is not None

            if has_voice:
                filename_mp3 = f"voice_{timestamp}.mp3"
                audio_path_mp3 = os.path.join(AUDIO_DIR, filename_mp3)

                success = generate_with_elevenlabs(data.text, voice_id, audio_path_mp3)

                if success and os.path.exists(audio_path_mp3):
                    print(f"[OK] ElevenLabs voice: {filename_mp3}")
                    return {
                        "success":    True,
                        "audio_path": f"storage/audio/{filename_mp3}",
                        "voice":      voice_id,
                        "provider":   "elevenlabs",
                    }
                else:
                    print("[WARN] ElevenLabs failed, falling back to Edge TTS")

        # Edge TTS fallback
        lang_voices = EDGE_TTS_VOICE_MAP.get(data.language, EDGE_TTS_VOICE_MAP["en-US"])
        edge_voice  = lang_voices.get(gender, DEFAULT_EDGE_VOICE)

        filename_wav  = f"voice_{timestamp}.wav"
        audio_path_wav = os.path.join(AUDIO_DIR, filename_wav)

        communicate = edge_tts.Communicate(data.text, edge_voice)
        await communicate.save(audio_path_wav)

        print(f"[OK] Edge TTS voice: {filename_wav} ({edge_voice})")
        return {
            "success":    True,
            "audio_path": f"storage/audio/{filename_wav}",
            "voice":      edge_voice,
            "provider":   "edge_tts",
        }

    except Exception as e:
        return {
            "success":    False,
            "error_code": "VOICE_GEN_FAILED",
            "message":    str(e),
        }
