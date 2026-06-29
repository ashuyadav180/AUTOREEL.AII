"""
Script AI Service - AutoReel.AI
Gemini: Script Generation + Enhancement
Claude Sonnet: Scene Planning (7 cinematic scenes)
"""
import os
import json
import logging
import re
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

# ── Logger ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("script_ai")

# ── Gemini ───────────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    GEMINI_ENABLED = True
    logger.info("✅ Gemini enabled")
else:
    GEMINI_ENABLED = False
    logger.warning("⚠️ No GEMINI_API_KEY")

# ── Claude ───────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
if ANTHROPIC_API_KEY and anthropic:
    claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    CLAUDE_ENABLED = True
    logger.info("✅ Claude Sonnet enabled")
else:
    claude_client = None
    CLAUDE_ENABLED = False
    if ANTHROPIC_API_KEY and not anthropic:
        logger.warning("⚠️ anthropic package missing — scene planner will use fallback")
    else:
        logger.warning("⚠️ No ANTHROPIC_API_KEY — scene planner will use fallback")

# ── OpenAI ChatGPT ──────────────────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_ENABLED = bool(OPENAI_API_KEY)
if OPENAI_ENABLED:
    logger.info("✅ OpenAI ChatGPT enabled")
else:
    logger.warning("⚠️ No OPENAI_API_KEY — ChatGPT will be skipped")

router = APIRouter()
app = FastAPI(title="Script AI", version="2.0")

# ── Models ────────────────────────────────────────────────────────────────────
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

def _detect_category(topic: str) -> str:
    """Auto-detect category from topic keywords instead of relying on user input."""
    topic_lower = topic.lower()
    
    if any(w in topic_lower for w in ["magic", "trick", "card", "illusion", "mystery", "spell", "wizard", "supernatural"]):
        return "storytelling"
    elif any(w in topic_lower for w in ["money", "rich", "wealth", "invest", "stock", "crypto", "finance", "dollar", "profit"]):
        return "finance"
    elif any(w in topic_lower for w in ["psychology", "manipulation", "mind", "dark", "secret", "hidden", "power", "control"]):
        return "dark_psychology"
    elif any(w in topic_lower for w in ["ai", "robot", "tech", "gpt", "model", "neural", "future", "digital", "cyber"]):
        return "ai_news"
    elif any(w in topic_lower for w in ["cinematic", "film", "movie", "scene", "dramatic", "visual", "story", "journey"]):
        return "storytelling"
    elif any(w in topic_lower for w in ["gym", "run", "athlete", "hustle", "grind", "discipline", "success", "goal"]):
        return "motivation"
    
    return "storytelling"  # default to storytelling instead of motivation


def _normalize_topic(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip()).strip(" \"'")
    cinematic_prefix = "create a cinematic 9:16 short-form video about "
    lowered = cleaned.lower()
    if lowered.startswith(cinematic_prefix):
        cleaned = cleaned[len(cinematic_prefix):].split(", with ", 1)[0].strip()
    hindi_prefix = "को एक cinematic 9:16 short video की तरह दिखाओ"
    if hindi_prefix in cleaned:
        cleaned = cleaned.split(hindi_prefix, 1)[0].strip(" ,")
    
    # Truncate extremely long user prompts/scene lists to prevent fallback ballooning
    if len(cleaned) > 60:
        words = cleaned.split()
        if len(words) > 8:
            cleaned = " ".join(words[:8]) + "..."
        else:
            cleaned = cleaned[:60] + "..."
            
    return cleaned or "a meaningful transformation"


def _looks_hindi(text: str) -> bool:
    return any("\u0900" <= ch <= "\u097f" for ch in text or "")


def _target_sentence_count(duration: int) -> int:
    if duration <= 20:
        return 4
    if duration <= 35:
        return 5
    if duration <= 60:
        return 7
    if duration <= 90:
        return 9
    return 10


def _build_fallback_enhanced_prompt(prompt: str) -> str:
    topic = _normalize_topic(prompt)
    if _looks_hindi(topic):
        return (
            f"{topic} को एक cinematic 9:16 short video की तरह दिखाओ, dramatic lighting, "
            "expressive close-ups, emotional pacing, high contrast visuals, and viral social-media energy."
        )
    return (
        f"Create a cinematic 9:16 short-form video about {topic}, with dramatic lighting, "
        "expressive close-ups, dynamic movement, vivid detail, and a high-impact social-media storytelling style."
    )


def _build_fallback_script_payload(data: ScriptRequest, reason: str | None = None):
    topic = _normalize_topic(data.topic)
    category = (data.category or "motivation").lower()
    language = (data.language or "en-US").lower()
    sentence_target = _target_sentence_count(data.duration or 60)

    if language.startswith("hi") or _looks_hindi(topic):
        hook = f"{topic} में असली बदलाव talent से नहीं, रोज़ की discipline से आता है।"
        body = [
            "ज़्यादातर लोग सही mood का इंतज़ार करते हैं, इसलिए शुरुआत ही नहीं कर पाते।",
            "लेकिन छोटी और लगातार की गई action ही बड़ा फर्क बनाती है।",
            f"जब आप {topic} पर थके होने के बाद भी काम करते हो, तभी self-belief बनता है।",
            "वही self-belief hesitation को momentum में बदल देता है।",
            "एक distraction हटाओ, एक clear step चुनो, और उसे रोज़ दोहराओ।",
            "एक हफ्ते में progress दिखती है, और एक महीने में identity बदलने लगती है।",
            "Perfect plan की नहीं, consistent execution की ज़रूरत होती है।",
            "आज का छोटा कदम कल की बड़ी कहानी बन सकता है।",
        ]
        cta = "ऐसी ही practical growth videos के लिए follow करो।"
    else:
        hooks = {
            "finance": f"If you get {topic} wrong, your money keeps leaking in the background.",
            "storytelling": f"The part of the {topic} story that changes everything usually begins when life gets uncomfortable.",
            "dark_psychology": f"The hidden truth about {topic} is that people react to signals before they react to words.",
            "ai_news": f"The biggest shift in {topic} is happening faster than most people are prepared for.",
            "motivation": f"If you keep waiting for motivation to fix {topic}, you will stay stuck longer than you need to.",
        }
        hook = hooks.get(category, f"The breakthrough in {topic} starts the moment you stop waiting and start moving.")

        body_map = {
            "finance": [
                f"With {topic}, the biggest mistake is chasing fast wins before you build a system.",
                "Small leaks look harmless, but repeated every day they become expensive.",
                "Track what comes in, track what goes out, and make one rule you can follow even on bad days.",
                "Simple habits beat emotional decisions, especially when the market or your mood gets noisy.",
                "The goal is not to look rich for a week. The goal is to become stable for years.",
                "Clarity compounds in the same way confusion compounds, so make your next money move easy to repeat.",
                "Consistency creates control, and control creates options.",
            ],
            "storytelling": [
                f"Every strong {topic} story has a moment where quitting looks smarter than continuing.",
                "That moment reveals character faster than comfort ever can.",
                "Pressure strips away the performance and exposes the belief underneath.",
                "One brave decision can change the direction of the entire story.",
                "People remember turning points, not easy routines.",
                "That is why persistence feels ordinary in the moment and powerful in hindsight.",
                "The story becomes meaningful because the person keeps moving anyway.",
            ],
            "dark_psychology": [
                f"With {topic}, attention, timing, and emotional control matter more than loud words.",
                "People read certainty through tone, posture, and repetition long before they analyze logic.",
                "The person who controls the frame often controls the outcome.",
                "Awareness matters because once you see the pattern, it loses some of its power over you.",
                "Use that insight to protect yourself, not to manipulate people.",
                "Calm observation is usually stronger than reactive emotion.",
                "The more clearly you read the room, the harder it is for someone to control you.",
            ],
            "ai_news": [
                f"The real story in {topic} is not just the tool. It is how fast behavior changes once the tool becomes easier than the old workflow.",
                "Early users gain leverage because they experiment while everyone else is still debating.",
                "The winners are usually the people who test practical use cases instead of chasing hype.",
                "If you learn the workflow now, you will be ahead of the crowd when adoption spikes.",
                "In AI, speed matters, but useful execution matters more.",
                "The people who adapt first usually create the new default for everyone else.",
                "That is why curiosity beats fear in every major platform shift.",
            ],
            "motivation": [
                f"Most people think {topic} changes when they feel inspired, but it changes when they act on ordinary days.",
                "The breakthrough usually starts with one small promise you keep to yourself.",
                "When you show up tired and still do the work, you build proof that you can trust your own word.",
                "That proof turns hesitation into momentum, and momentum makes discipline feel natural instead of forced.",
                "Remove one distraction, protect one focused block of time, and make the next action easy to repeat.",
                "A week of consistency creates progress. A month of consistency changes identity.",
                "You do not need a perfect plan to start. You need one clear action you can repeat today.",
            ],
        }
        body = body_map.get(category, body_map["motivation"])
        cta = f"Follow for more {category.replace('_', ' ')} videos you can use today."

    selected_body = body[: max(1, sentence_target - 2)]
    script = " ".join([hook, *selected_body, cta])
    logger.warning("Using local fallback script for topic '%s' (%s)", topic, reason or "no external AI available")
    return {
        "success": True,
        "script": script,
        "hook": hook,
        "scenes": [],
        "message": reason or "Generated with local fallback",
    }


def _call_gemini(prompt: str, timeout: float = 20.0) -> str:
    if not GEMINI_ENABLED:
        raise RuntimeError("Gemini disabled")

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7},
    }
    response = httpx.post(url, params={"key": GEMINI_API_KEY}, json=payload, timeout=timeout)
    if response.status_code != 200:
        raise RuntimeError(f"Gemini API returned {response.status_code}: {response.text[:500]}")

    data = response.json()
    candidates = data.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text

# ── HEALTH ────────────────────────────────────────────────────────────────────
@router.get("/health")
def health():
    return {
        "status": "ok",
        "gemini": GEMINI_ENABLED,
        "openai": OPENAI_ENABLED,
        "claude": CLAUDE_ENABLED
    }

# ── ENHANCE PROMPT ────────────────────────────────────────────────────────────
@router.post("/enhance-prompt", response_model=EnhanceResponse)
def enhance_prompt(data: EnhanceRequest):
    logger.info(f"✨ Enhancing: {data.prompt}")
    inst = "Expand this idea into a cinematic 4K video prompt. 1 sentence. No quotes."
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        text = _call_gemini(f"{inst}\n\nIdea: {data.prompt}")
        return {"success": True, "enhanced_prompt": text}
    except Exception as e:
        logger.warning(f"⚠️ Gemini enhance failed, falling back to Claude: {e}")
        if not CLAUDE_ENABLED:
            return {
                "success": True,
                "enhanced_prompt": _build_fallback_enhanced_prompt(data.prompt),
                "message": str(e),
            }
        try:
            resp = claude_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                messages=[{"role": "user", "content": f"{inst}\n\nIdea: {data.prompt}"}]
            )
            return {"success": True, "enhanced_prompt": resp.content[0].text.strip()}
        except Exception as ce:
            logger.warning(f"⚠️ Claude enhance failed, falling back to free Pollinations AI: {ce}")
            try:
                pollinations_url = f"https://text.pollinations.ai/prompt/{data.prompt}?system={inst}"
                r = httpx.get(pollinations_url, timeout=15.0)
                if r.status_code == 200 and r.text:
                    return {"success": True, "enhanced_prompt": r.text.strip()}
            except Exception as pe:
                logger.error(f"❌ Pollinations enhance failed: {pe}")
            
            return {
                "success": True,
                "enhanced_prompt": _build_fallback_enhanced_prompt(data.prompt),
                "message": str(ce),
            }

# ── SUGGESTIONS ───────────────────────────────────────────────────────────────
@router.post("/get-suggestions", response_model=SuggestionResponse)
def get_suggestions(data: EnhanceRequest):
    logger.info(f"💡 Suggesting for: {data.prompt}")
    inst = "Provide 3 short creative video idea completions for this prompt. Return ONLY a JSON list of strings."
    text = ""
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        text = _call_gemini(f"{inst}\n\nPrompt: {data.prompt}")
    except Exception as e:
        logger.warning(f"⚠️ Gemini suggestions failed, falling back to Claude: {e}")
        if CLAUDE_ENABLED:
            try:
                resp = claude_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=200,
                    system="Only output a JSON list of strings.",
                    messages=[{"role": "user", "content": f"{inst}\n\nPrompt: {data.prompt}"}]
                )
                text = resp.content[0].text.strip()
            except Exception as ce:
                logger.warning(f"⚠️ Claude suggest failed, falling back to free Pollinations AI: {ce}")
    
    if not text:
        try:
            url = f"https://text.pollinations.ai/prompt/{data.prompt}?system={inst}&json=true"
            r = httpx.get(url, timeout=15.0)
            if r.status_code == 200:
                text = r.text.strip()
        except Exception as pe:
            logger.error(f"❌ Pollinations suggest failed: {pe}")

    if not text:
        return {"success": True, "suggestions": []}

    try:
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        return {"success": True, "suggestions": json.loads(text)[:4]}
    except:
        return {"success": True, "suggestions": []}

# ── TRENDS ────────────────────────────────────────────────────────────────────
@router.post("/get-trends")
def get_trends(data: dict):
    niche = data.get("niche", "motivation")
    logger.info(f"🔥 Trends for: {niche}")
    inst = '''Brainstorm 5 viral video topics for this niche. Return ONLY JSON list: [{"topic":"", "category":"", "icon":"", "growth":""}]'''
    text = ""
    try:
        if not GEMINI_ENABLED:
            raise Exception("Gemini disabled")
        text = _call_gemini(f"{inst}\n\nNiche: {niche}")
    except Exception as e:
        logger.warning(f"⚠️ Gemini trends failed, falling back to Claude: {e}")
        if CLAUDE_ENABLED:
            try:
                resp = claude_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=500,
                    system="Only output valid JSON.",
                    messages=[{"role": "user", "content": f"{inst}\n\nNiche: {niche}"}]
                )
                text = resp.content[0].text.strip()
            except Exception as ce:
                logger.warning(f"⚠️ Claude trends failed, falling back to free Pollinations AI: {ce}")

    if not text:
        try:
            url = f"https://text.pollinations.ai/prompt/{niche}?system={inst}&json=true"
            r = httpx.get(url, timeout=15.0)
            if r.status_code == 200:
                text = r.text.strip()
        except: pass

    if not text:
        return {"success": False, "trends": []}

    try:
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        return {"success": True, "trends": json.loads(text)}
    except Exception as e:
        return {"success": False, "trends": []}

# ── STAGE 1: GENERATE SCRIPT (Gemini Flash) ───────────────────────────────────
@router.post("/generate-script", response_model=ScriptResponse)
def generate_script(data: ScriptRequest):
    global GEMINI_ENABLED, OPENAI_ENABLED, CLAUDE_ENABLED
    
    # Auto-detect category if not explicitly set or if default
    if not data.category or data.category == "motivation":
        detected = _detect_category(data.topic)
        if detected != "motivation":
            data.category = detected
            logger.info(f"🎯 Auto-detected category: {detected} for topic: {data.topic}")

    logger.info(f"📜 [Stage 1] Generating script: {data.topic} | detected/selected category: {data.category}")
    prompt = f"""
You are a cinematic short film director writing a voiceover script.

Topic: {data.topic}
Category: {data.category}
Duration: {data.duration} seconds
Language: {data.language}

Write a story-driven cinematic voiceover script. Rules:
- Open with a mysterious or dramatic scene-setting sentence (NOT a motivational hook)
- Tell a visual story — describe what the VIEWER SEES, not life advice
- Use present tense, short punchy sentences
- Each sentence = one visual scene
- End with a sense of wonder or revelation
- NO motivational clichés ("stay stuck", "discipline", "grind")
- Sound like a National Geographic or Netflix documentary narrator
- For magic/mystery topics: build suspense, reveal slowly

Example for "card magic trick":
"In a dark room, a single light falls on two hands.
The cards begin to move — slowly at first, then faster.
One card rises from the deck, defying everything you know.
The magician's eyes never blink.
What you're about to see cannot be explained.
Only witnessed."

Return ONLY valid JSON:
{{
  "script": "full cinematic voiceover here...",
  "hook": "first dramatic sentence..."
}}
"""
    text = ""
    # 1. Try Gemini
    if GEMINI_ENABLED:
        try:
            text = _call_gemini(prompt)
        except Exception as e:
            logger.warning(f"⚠️ Gemini failed ({str(e)[:100]}).")
            err_msg = str(e).lower()
            if "429" in err_msg or "quota" in err_msg or "blocked" in err_msg or "limit" in err_msg or "credentials" in err_msg or "quotaexceeded" in err_msg:
                GEMINI_ENABLED = False
                logger.error("🛑 Disabling Gemini dynamically due to quota/credentials error.")

    # 2. Try Claude Sonnet
    if not text and CLAUDE_ENABLED and claude_client:
        logger.info("Falling back to Claude Sonnet.")
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
            logger.error(f"❌ Claude fallback also failed: {ce}")
            err_msg = str(ce).lower()
            if "credit" in err_msg or "balance" in err_msg or "400" in err_msg or "credentials" in err_msg or "unauthorized" in err_msg:
                CLAUDE_ENABLED = False
                logger.error("🛑 Disabling Claude dynamically due to credits/credentials error.")
    
    # 3. Try free Pollinations AI
    if not text:
        logger.info("ℹ️ Using free Pollinations AI for script generation...")
        try:
            sys_prompt = "You are a viral YouTube Shorts scriptwriter. Return ONLY valid JSON."
            r = httpx.post("https://text.pollinations.ai/", json={
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": prompt}
                ],
                "jsonMode": True
            }, timeout=5.0) # Fail fast if Pollinations is slow!
            
            if r.status_code == 200 and r.text:
                text = r.text.strip()
        except Exception as pe:
            logger.error(f"❌ Pollinations fallback also failed: {pe}")
            
    if not text:
        return _build_fallback_script_payload(
            data,
            reason="AI models unavailable. Gemini, Claude, and Free AI failed.",
        )

    try:
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        parsed = json.loads(text)
        if not parsed.get("script", "").strip():
            raise ValueError("Empty script returned by model")
        logger.info(f"✅ [Stage 1] Script generated: {len(parsed.get('script',''))} chars")
        return {
            "success": True,
            "script": parsed.get("script", ""),
            "hook": parsed.get("hook", ""),
            "scenes": []
        }
    except Exception as parse_err:
        logger.error(f"❌ Script parsing failed: {parse_err}")
        return _build_fallback_script_payload(data, reason=f"Script parsing failed: {parse_err}")


# ── STAGE 2: PLAN SCENES (Claude Sonnet) ──────────────────────────────────────
@router.post("/plan-scenes")
def plan_scenes(data: ScenePlanRequest):
    """Plan visual scenes for the generated script."""
    global CLAUDE_ENABLED
    if not CLAUDE_ENABLED or not claude_client:
        return _plan_scenes_gemini_fallback(data)

    system_prompt = """You are a professional cinematographer and video director specializing in viral YouTube Shorts.
You receive a script and create a frame-by-frame cinematic scene plan.
For each scene you provide a detailed TEXT-TO-VIDEO prompt optimized for Google Veo — describing MOTION, CAMERA MOVEMENT, and ATMOSPHERE.
Think like a film director: describe what moves, how the camera behaves, and what the lighting feels like."""

    user_prompt = f"""Script about \"{data.topic}\" (category: {data.category}):

{data.script}

Plan exactly {data.num_scenes} visual scenes for this script.

Return ONLY valid JSON array:
[
  {{
    "scene_index": 0,
    "text": "spoken words for this scene...",
    "visual": "A [subject] [doing action], [camera movement], [lighting style], [mood], [cinematic detail]. Shot on ARRI Alexa, anamorphic lens.",
    "mood": "intense | calm | inspiring | shocking | neutral",
    "duration_s": 5,
    "hero": false
  }}
]

Rules:
- Exactly {data.num_scenes} scenes
- "visual" is a TEXT-TO-VIDEO prompt for Google Veo — describe MOTION, CAMERA MOVEMENT, and ATMOSPHERE
- Example visual: "A lone athlete sprinting on an empty highway at golden hour, camera slowly pushing in from behind, dramatic rim lighting, dust kicking up in slow motion, cinematic and powerful"
- Mark the most visually important scene as "hero": true (only 1 hero per video)
- No scene text should repeat
- Duration: 4-6 seconds each
- DO NOT use SDXL/image style prompts — these are VIDEO prompts with motion
"""

    try:
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
        logger.info(f"Stage 2 Claude planned {len(scenes)} scenes")
        return {"success": True, "scenes": scenes, "provider": "claude"}
    except Exception as e:
        logger.error(f"Claude scene planning failed: {e}")
        err_msg = str(e).lower()
        if "credit" in err_msg or "balance" in err_msg or "400" in err_msg or "credentials" in err_msg or "unauthorized" in err_msg:
            CLAUDE_ENABLED = False
            logger.error("🛑 Disabling Claude dynamically due to credits/credentials error.")
        return _plan_scenes_gemini_fallback(data)


def _plan_scenes_gemini_fallback(data: ScenePlanRequest):
    """Fallback to Gemini for scene planning if Claude/OpenAI are unavailable."""
    global GEMINI_ENABLED
    
    # Category-specific Veo TEXT-TO-VIDEO motion prompts — describe camera movement, action, and atmosphere
    cat_kws = {
        "motivation": [
            "lone athlete sprinting on empty highway at golden hour, camera slowly pushing in from behind, dust kicking up in slow motion, dramatic rim lighting",
            "person climbing steep rocky mountain, low angle shot looking up, dramatic fast-moving clouds overhead, wind whipping jacket",
            "extreme close-up of determined eyes, shallow depth of field, single spotlight, camera breathes slowly in and out, cinematic",
            "runner crossing finish line in slow motion, confetti falling, crowd blurred in background bokeh, euphoric energy",
            "person working alone at desk late at night, warm amber lamp glow, camera orbits slowly around them, quiet intensity",
            "silhouette standing on mountain summit at sunrise, wind moving hair, wide cinematic establishing shot, golden backlight halo",
            "city waking up at dawn timelapse, camera slowly cranes up revealing full skyline, warm orange tones spreading across buildings"
        ],
        "storytelling": [
            "person walking alone down foggy road at dusk, camera tracks alongside at eye level, melancholic golden atmosphere, slow deliberate pace",
            "rain drops falling on window in slow motion, blurred city lights bokeh in background, camera slowly pushes into the glass",
            "two people having emotional conversation, close-up alternating shots, soft dramatic side lighting, shallow depth of field",
            "silhouette standing at cliff edge watching sunset, wide shot, warm golden light, slow camera drift left to right",
            "walking through ancient forest, rays of light breaking through canopy, camera moves through branches at eye level, mystical atmosphere",
            "sitting by campfire at night, embers rising in slow motion, close-up of thoughtful face, warm flickering orange light",
            "looking out from moving train window at passing landscape, reflection visible in glass, camera holds steady, contemplative mood"
        ],
        "finance": [
            "aerial drone view of city financial district at night, lights glowing below, camera slowly descends toward skyscrapers",
            "hands counting crisp bills on mahogany desk, extreme close-up, shallow depth of field, warm office lighting bokeh",
            "stock chart line rising on glowing monitor, camera slowly zooms in, screen reflections in glasses, tension building",
            "confident businessman walking through glass skyscraper lobby, camera tracks from front, reflective marble floor, purposeful stride",
            "luxury car driving through empty wet night streets, neon reflections on asphalt, low tracking shot, cinematic color grade",
            "penthouse balcony view of city at golden hour, camera slowly pans across skyline, warm light, premium atmosphere",
            "hands typing rapidly on laptop showing financial data, extreme close-up shallow focus, cool blue screen glow, urgent energy"
        ],
        "dark_psychology": [
            "hand moving chess piece on dark glossy board, extreme close-up, single overhead spotlight, slow deliberate motion",
            "mysterious figure standing under street lamp in dense fog, camera slowly pushes in, high contrast noir lighting",
            "person staring in mirror, camera slowly reveals they are not moving, eerie stillness, dramatic single light source",
            "close-up of intense eyes in deep shadow, single pinpoint catchlight, camera breathes slowly in and out, unnerving",
            "two silhouettes facing each other across a dark room, single shaft of light between them, slow camera push",
            "figure walking through long dark corridor toward small bright doorway, slow dramatic push from behind, tension building",
            "overhead shot of chess board, hand removes opponent piece in slow motion, pieces casting long shadows, moody lighting"
        ],
        "ai_news": [
            "futuristic city street at night with holographic ads, camera glides through crowd at eye level, neon reflections everywhere",
            "robotic hand and human hand reaching toward each other in slow motion, dramatic backlight, particles in the air",
            "streams of glowing data flowing through dark abstract space, camera flies through the data tunnel, electric blue tones",
            "server room with rhythmically blinking lights, camera moves slowly down the corridor, cool blue ambient glow",
            "close-up of human eye with digital interface reflected in iris, camera slowly zooms in, futuristic and intimate",
            "abstract neural network visualization pulsing with light, camera orbits around it, nodes firing in sequence",
            "person interacting with floating holographic interface, particles dissolving in air around hands, soft sci-fi lighting"
        ]
    }.get((data.category or "motivation").lower(), [
        "dramatic cinematic close-up shot with shallow depth of field, slow camera push in, single spotlight",
        "wide establishing shot at golden hour, camera slowly cranes up to reveal full landscape, warm backlight",
        "subject in single spotlight against dark background, camera orbits slowly, smoke haze in air",
        "slow motion action sequence, high contrast dramatic lighting, cinematic color grade, 9:16 framing",
        "tracking shot following subject through environment, natural golden hour lighting, smooth camera glide",
        "overhead bird's eye view slowly rotating, dramatic scale reveal, cinematic color grade",
        "intimate close-up with soft bokeh background, camera breathes slowly, warm rim lighting"
    ])

    if not GEMINI_ENABLED:
        scenes = []
        for i in range(data.num_scenes):
            kw = cat_kws[i % len(cat_kws)]
            scenes.append({
                "scene_index": i,
                "text": f"Scene {i+1}",
                "visual": f"{kw}, shot on ARRI Alexa, anamorphic lens, cinematic color grade",
                "mood": ["inspiring", "intense", "calm", "shocking", "neutral"][i % 5],
                "duration_s": 5,
                "hero": i == 0
            })
        return {"success": True, "scenes": scenes, "provider": "fallback"}

    try:
        prompt = f"""
Plan exactly {data.num_scenes} visual scenes for a video about \"{data.topic}\".
Script: {data.script[:500]}...

Return ONLY valid JSON array. Each "visual" must be a TEXT-TO-VIDEO prompt for Google Veo describing motion, camera movement, and atmosphere:
[{{\"scene_index\":0,\"text\":\"...\",\"visual\":\"A [subject] [doing action], [camera movement], [lighting], [mood]. Shot on ARRI Alexa, anamorphic lens.\",\"mood\":\"inspiring\",\"duration_s\":5,\"hero\":false}}]
"""
        text = _call_gemini(prompt)
        if "```json" in text: text = text.split("```json")[1].split("```")[0].strip()
        scenes = json.loads(text)
        logger.info(f"✅ [Stage 2 Fallback] Gemini planned {len(scenes)} scenes")
        return {"success": True, "scenes": scenes, "provider": "gemini_fallback"}
    except Exception as e:
        logger.error(f"Gemini scene planning failed: {e}")
        err_msg = str(e).lower()
        if "429" in err_msg or "quota" in err_msg or "blocked" in err_msg or "limit" in err_msg or "credentials" in err_msg or "quotaexceeded" in err_msg:
            GEMINI_ENABLED = False
            logger.error("🛑 Disabling Gemini dynamically due to quota/credentials error.")
        
        # Immediate fallback to local offline scenes with variety
        scenes = []
        for i in range(data.num_scenes):
            kw = cat_kws[i % len(cat_kws)]
            scenes.append({
                "scene_index": i,
                "text": f"Scene {i+1}",
                "visual": f"{kw}, shot on ARRI Alexa, anamorphic lens, cinematic color grade",
                "mood": ["inspiring", "intense", "calm", "shocking", "neutral"][i % 5],
                "duration_s": 5,
                "hero": i == 0
            })
        return {"success": True, "scenes": scenes, "provider": "fallback"}


app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
