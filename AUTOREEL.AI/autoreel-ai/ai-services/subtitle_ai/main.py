from fastapi import FastAPI, APIRouter
from pydantic import BaseModel, Field
import os
import time
import logging
from faster_whisper import WhisperModel

# ------------------ LOGGING ------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("subtitle_ai")

router = APIRouter()
app = FastAPI(title="Subtitle AI", version="2.0")

# ------------------ MODELS ------------------

class SubtitleRequest(BaseModel):
    text: str = Field(..., min_length=10)

class TranscribeRequest(BaseModel):
    audio_path: str = Field(..., min_length=5)

class SubtitleResponse(BaseModel):
    success: bool
    subtitle_path: str | None = None
    error_code: str | None = None
    message: str | None = None

# ------------------ WHISPER ------------------
# We use "base" for speed, "small" or "medium" for accuracy.
# Note: This will download 150MB+ on first run.
# Auto-detect CUDA GPU for 5-10x speed boost
import subprocess as _sp
def _has_cuda():
    try:
        r = _sp.run(["nvidia-smi"], stdout=_sp.PIPE, stderr=_sp.PIPE)
        return r.returncode == 0
    except Exception:
        return False

_USE_CUDA = _has_cuda()
_DEVICE = "cuda" if _USE_CUDA else "cpu"
_COMPUTE = "float16" if _USE_CUDA else "int8"
logger.info(f"Loading Whisper model... device={_DEVICE} compute={_COMPUTE}")

try:
    model = WhisperModel("base", device=_DEVICE, compute_type=_COMPUTE)
    logger.info(f"Whisper model loaded. GPU accelerated: {_USE_CUDA}")
except Exception as e:
    logger.warning(f"CUDA init failed ({e}), falling back to CPU...")
    _USE_CUDA = False
    _DEVICE = "cpu"
    _COMPUTE = "int8"
    model = WhisperModel("base", device=_DEVICE, compute_type=_COMPUTE)
    logger.info("Whisper model loaded on CPU.")

# ------------------ PATHS ------------------

BASE_DIR = os.path.dirname(__file__)
SUBTITLE_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "..", "backend", "storage", "subtitles"))
PROJECT_ROOT = os.path.normpath(os.path.join(BASE_DIR, "..", ".."))

os.makedirs(SUBTITLE_DIR, exist_ok=True)

# ------------------ HELPERS ------------------

def format_time(seconds: float) -> str:
    millis = int((seconds - int(seconds)) * 1000)
    seconds = int(seconds)
    mins = seconds // 60
    secs = seconds % 60
    return f"00:{mins:02}:{secs:02},{millis:03}"

# ------------------ HEALTH ------------------

@router.get("/health")
def health():
    return {"status": "ok"}

# ------------------ ENDPOINTS ------------------

@router.post("/transcribe", response_model=SubtitleResponse)
def transcribe_audio(data: TranscribeRequest):
    global model, _USE_CUDA, _DEVICE, _COMPUTE
    try:
        # Fix for relative paths starting with 'storage/' (they are in backend/storage)
        if data.audio_path.replace("\\", "/").startswith("storage/"):
             audio_abs = os.path.normpath(os.path.join(PROJECT_ROOT, "backend", data.audio_path))
        else:
             audio_abs = os.path.normpath(os.path.join(PROJECT_ROOT, data.audio_path))

        if not os.path.exists(audio_abs):
            raise FileNotFoundError(f"Audio file not found: {audio_abs}")

        logger.info(f"🎙️ Transcribing: {data.audio_path}")
        
        try:
            # word_timestamps=True is useful for more precise timing if needed later
            segments, info = model.transcribe(audio_abs, beam_size=5)
            # Force evaluation of segments generator to trigger any lazy CUDA errors immediately
            segments = list(segments)
        except Exception as e:
            if _USE_CUDA and ("cublas" in str(e).lower() or "cuda" in str(e).lower() or "cudnn" in str(e).lower()):
                logger.warning(f"CUDA inference failed ({e}). Reloading model on CPU and retrying...")
                _USE_CUDA = False
                _DEVICE = "cpu"
                _COMPUTE = "int8"
                model = WhisperModel("base", device=_DEVICE, compute_type=_COMPUTE)
                segments, info = model.transcribe(audio_abs, beam_size=5)
                segments = list(segments)
            else:
                raise e

        srt_lines = []
        for index, segment in enumerate(segments, start=1):
            srt_lines.append(str(index))
            srt_lines.append(
                f"{format_time(segment.start)} --> {format_time(segment.end)}"
            )
            srt_lines.append(segment.text.strip())
            srt_lines.append("")

        filename = f"trans_{int(time.time())}.srt"
        subtitle_path = os.path.join(SUBTITLE_DIR, filename)

        with open(subtitle_path, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_lines))

        logger.info(f"✅ Transcription complete: {filename}")
        return {
            "success": True,
            "subtitle_path": subtitle_path
        }

    except Exception as e:
        logger.error(f"❌ Transcription failed: {e}")
        return {
            "success": False,
            "error_code": "TRANSCRIPTION_FAILED",
            "message": str(e)
        }

@router.post("/generate-subtitles", response_model=SubtitleResponse)
def generate_subtitles(data: SubtitleRequest):
    try:
        lines = [l.strip() for l in data.text.split("\n\n") if l.strip()]

        start_time = 0.0
        srt_lines = []

        for index, line in enumerate(lines, start=1):
            duration = max(1.5, len(line) * 0.06)  # smart heuristic
            end_time = start_time + duration

            srt_lines.append(str(index))
            srt_lines.append(
                f"{format_time(start_time)} --> {format_time(end_time)}"
            )
            srt_lines.append(line)
            srt_lines.append("")

            start_time = end_time + 0.3  # small gap

        filename = f"subs_{int(time.time())}.srt"
        subtitle_path = os.path.join(SUBTITLE_DIR, filename)

        with open(subtitle_path, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_lines))

        return {
            "success": True,
            "subtitle_path": subtitle_path
        }

    except Exception as e:
        return {
            "success": False,
            "error_code": "SUBTITLE_GEN_FAILED",
            "message": str(e)
        }


app.include_router(router)

