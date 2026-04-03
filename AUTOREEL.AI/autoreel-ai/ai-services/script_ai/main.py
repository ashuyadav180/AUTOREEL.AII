"""
Script AI Service - AutoReel.AI
Gemini: Script Generation + Enhancement
Claude Sonnet: Scene Planning (7 cinematic scenes)
"""
import os
import json
import logging
from fastapi import FastAPI, APIRouter
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
import httpx

try:
    import anthropic
except ImportError:
    anthropic = None

load_dotenv()

# â”€â”€ Logger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("script_ai")

# â”€â”€ Gemini â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    GEMINI_ENABLED = True
    logger.info("âœ… Gemini enabled")
else:
    GEMINI_ENABLED = False
    logger.warning("âš ï¸ No GEMINI_API_KEY")

# â”€â”€ Claude â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
if ANTHROPIC_API_KEY and anthropic:
    claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    CLAUDE_ENABLED = True
    logger.info("âœ… Claude Sonnet enabled")
else:
    claude_client = None
    CLAUDE_ENABLED = False
    if ANTHROPIC_API_KEY and not anthropic:
        logger.warning("âš ï¸ anthropic package missing â€” scene planner will use fallback")
    else:
        logger.warning("âš ï¸ No ANTHROPIC_API_KEY â€” scene planner will use fallback")

router = APIRouter()
app = FastAPI(title="Script AI", version="2.0")
app.include_router(router)

# â”€â”€ Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class EnhanceRequest(BaseModel):
    prompt: str

class EnhanceResponse(BaseModel):
    success: bool
    enhanced_prompt: str | None = None
    message: str | None = None

class SuggestionResponse(BaseModel):
    success: bool
    suggestions: list[str] = []

class ScriptRequest(BaseModel):
    topic: str
    category: str = "motivation"
    duration: int = 60
    language: str = "en-US"

class ScriptResponse(BaseModel):
    success: bool
    script: str = ""
    hook: str | None = None
    scenes: list | None = None
    message: str | None = None

class ScenePlanRequest(BaseModel):
    script: str
    topic: str
    category: str = "motivation"
    num_scenes: int = 7

# â”€â”€ HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/health")
def health():
    return {
        "status": "ok",
        "gemini": GEMINI_ENABLED,
        "claude": CLAUDE_ENABLED
    }

# â”€â”€ ENHANCE PROMPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/enhance-prompt", response_model=EnhanceResponse)
def enhance_prompt(data: EnhanceRequest):
    logger.info(f"âœ¨ Enhancing: {data.prompt}")
    inst = "Expand this idea into a cinematic 4K video prompt. 1 sentence. No quotes."
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(f"{inst}\n\nIdea: {data.prompt}")
        return {"success": True, "enhanced_prompt": resp.text.strip()}
    except Exception as e:
        logger.warning(f"âš ï¸ Gemini enhance failed, falling back to Claude: {e}")
        if not CLAUDE_ENABLED:
            return {"success": True, "enhanced_prompt": data.prompt, "message": str(e)}
        try:
            resp = claude_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                messages=[{"role": "user", "content": f"{inst}\n\nIdea: {data.prompt}"}]
            )
            return {"success": True, "enhanced_prompt": resp.content[0].text.strip()}
        except Exception as ce:
            return {"success": True, "enhanced_prompt": data.prompt, "message": str(ce)}

# â”€â”€ SUGGESTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/get-suggestions", response_model=SuggestionResponse)
def get_suggestions(data: EnhanceRequest):
    logger.info(f"ðŸ” Suggesting for: {data.prompt}")
    inst = "Provide 3 short creative video idea completions for this prompt. Return ONLY a JSON list of strings."
    text = ""
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(f"{inst}\n\nPrompt: {data.prompt}")
        text = resp.text.strip()
    except Exception as e:
        logger.warning(f"âš ï¸ Gemini suggestions failed, falling back to Claude: {e}")
        if CLAUDE_ENABLED:
            try:
                resp = claude_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=200,
                    system="Only output a JSON list of strings.",
                    messages=[{"role": "user", "content": f"{inst}\n\nPrompt: {data.prompt}"}]
                )
                text = resp.content[0].text.strip()
            except: pass
    
    if not text:
        return {"success": True, "suggestions": []}

    try:
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        return {"success": True, "suggestions": json.loads(text)[:4]}
    except:
        return {"success": True, "suggestions": []}

# â”€â”€ TRENDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/get-trends")
def get_trends(data: dict):
    niche = data.get("niche", "motivation")
    logger.info(f"ðŸ”¥ Trends for: {niche}")
    inst = '''Brainstorm 5 viral video topics for this niche. Return ONLY JSON list: [{"topic":"", "category":"", "icon":"", "growth":""}]'''
    text = ""
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(f"{inst}\n\nNiche: {niche}")
        text = resp.text.strip()
    except Exception as e:
        logger.warning(f"âš ï¸ Gemini trends failed, falling back to Claude: {e}")
        if CLAUDE_ENABLED:
            try:
                resp = claude_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=500,
                    system="Only output valid JSON.",
                    messages=[{"role": "user", "content": f"{inst}\n\nNiche: {niche}"}]
                )
                text = resp.content[0].text.strip()
            except: pass

    if not text:
        return {"success": False, "trends": []}

    try:
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        return {"success": True, "trends": json.loads(text)}
    except Exception as e:
        return {"success": False, "trends": []}

# â”€â”€ STAGE 1: GENERATE SCRIPT (Gemini Flash) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/generate-script", response_model=ScriptResponse)
def generate_script(data: ScriptRequest):
    logger.info(f"ðŸ“œ [Stage 1] Generating script: {data.topic}")
    prompt = f"""
Write a high-impact {data.duration}-second viral YouTube Shorts script about: {data.topic}
Tone: {data.category}
Language: {data.language}

Rules:
- Strong hook in the first 3 seconds
- Educational/entertaining body
- Clear call to action in last 5 seconds
- Natural spoken-word style (no stage directions)

Return ONLY valid JSON:
{{
  "script": "full spoken script here...",
  "hook": "first sentence hook..."
}}
"""
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(prompt)
        text = resp.text.strip()
    except Exception as e:
        logger.warning(f"âš ï¸ Gemini failed or disabled ({str(e)[:100]}). Falling back to Claude Sonnet.")
        if not CLAUDE_ENABLED:
            logger.error("âŒ Both Gemini and Claude failed/disabled.")
            return {"success": False, "script": "", "message": f"Both AI models unavailable: {e}"}
            
        try:
            resp = claude_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1000,
                temperature=0.7,
                system="You are a viral YouTube Shorts scriptwriter. Only output valid JSON.",
                messages=[{"role": "user", "content": prompt}]
            )
            text = resp.content[0].text.strip()
        except Exception as ce:
            logger.error(f"âŒ Claude fallback also failed: {ce}")
            return {
                "success": False,
                "script": "",
                "message": f"AI models unavailable. Gemini Quota Exceeded and Claude Failed: {ce}"
            }

    try:
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        parsed = json.loads(text)
        logger.info(f"âœ… [Stage 1] Script generated: {len(parsed.get('script',''))} chars")
        return {
            "success": True,
            "script": parsed.get("script", ""),
            "hook": parsed.get("hook", ""),
            "scenes": []
        }
    except Exception as parse_err:
        logger.error(f"âŒ Script parsing failed: {parse_err}")
        return {"success": False, "script": "", "message": str(parse_err)}

# â”€â”€ STAGE 2: PLAN SCENES (Claude Sonnet) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/plan-scenes")
def plan_scenes(data: ScenePlanRequest):
    """
    Stage 2: Claude Sonnet reads the script and creates a cinematic scene plan.
    Each scene has: text (spoken), imagePrompt (for SDXL), mood, duration_s
    """
    logger.info(f"ðŸ§  [Stage 2] Claude scene planning: {data.topic}")

    # â”€â”€ Fallback (no Claude key) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not CLAUDE_ENABLED:
        logger.warning("Claude disabled â€” using Gemini as scene planner fallback")
        return _plan_scenes_gemini_fallback(data)

    try:
        system_prompt = """You are a professional video director specializing in viral YouTube Shorts.
You receive a script and create a frame-by-frame cinematic scene plan.
For each scene you provide a detailed image generation prompt optimized for SDXL (Stable Diffusion XL).
Your image prompts should be vivid, cinematic, and in 9:16 portrait orientation."""

        user_prompt = f"""Script about "{data.topic}" (category: {data.category}):

{data.script}

Plan exactly {data.num_scenes} visual scenes for this script.
Each scene should cover a portion of the narration and have a distinct visual.

Return ONLY valid JSON array:
[
  {{
    "scene_index": 0,
    "text": "spoken words for this scene...",
    "imagePrompt": "hyperrealistic cinematic portrait, 9:16 vertical, [detailed visual description], golden hour lighting, 4K UHD, film grain, --ar 9:16",
    "mood": "intense | calm | inspiring | shocking | neutral",
    "duration_s": 5
  }}
]

Rules:
- Exactly {data.num_scenes} scenes
- imagePrompt must be detailed (20+ words), cinematic, SDXL-optimized
- No scene text should repeat
- Duration: 4-6 seconds each
"""

        message = claude_client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2000,
            messages=[{"role": "user", "content": user_prompt}],
            system=system_prompt,
        )

        text = message.content[0].text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        scenes = json.loads(text)
        logger.info(f"âœ… [Stage 2] Claude planned {len(scenes)} scenes")
        return {"success": True, "scenes": scenes}

    except Exception as e:
        logger.error(f"âŒ Claude scene planning failed: {e}")
        return _plan_scenes_gemini_fallback(data)


def _plan_scenes_gemini_fallback(data: ScenePlanRequest):
    """Fallback to Gemini for scene planning if Claude is unavailable."""
    if not GEMINI_ENABLED:
        scenes = [
            {
                "scene_index": i,
                "text": f"Scene {i+1}",
                "imagePrompt": f"cinematic {data.topic} scene, 9:16 portrait, 4K",
                "mood": "inspiring",
                "duration_s": 5
            }
            for i in range(data.num_scenes)
        ]
        return {"success": True, "scenes": scenes, "provider": "fallback"}

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = f"""
Plan exactly {data.num_scenes} visual scenes for a video about "{data.topic}".
Script: {data.script[:500]}...

Return ONLY valid JSON array:
[{{"scene_index":0,"text":"...","imagePrompt":"cinematic 9:16 portrait ...","mood":"inspiring","duration_s":5}}]
"""
        resp = model.generate_content(prompt)
        text = resp.text.strip()
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        scenes = json.loads(text)
        logger.info(f"âœ… [Stage 2 Fallback] Gemini planned {len(scenes)} scenes")
        return {"success": True, "scenes": scenes, "provider": "gemini_fallback"}
    except Exception as e:
        return {"success": False, "scenes": [], "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
