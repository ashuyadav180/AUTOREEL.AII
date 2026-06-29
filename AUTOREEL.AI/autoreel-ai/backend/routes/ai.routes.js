import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

const router = express.Router();

const SCRIPT_AI_URL = process.env.SCRIPT_AI_URL || "http://127.0.0.1:8005";
const VIDEO_AI_URL  = process.env.VIDEO_AI_URL  || "http://127.0.0.1:8004";
const IMAGE_AI_URL  = process.env.IMAGE_AI_URL  || "http://127.0.0.1:8006";
const VOICE_AI_URL  = process.env.VOICE_AI_URL  || "http://127.0.0.1:8002";

// ─── Job provider log (in-memory, persisted to file) ─────────────────────────
const PROVIDER_LOG_PATH = path.join(process.cwd(), "storage", "provider_log.json");

const readProviderLog = () => {
  try {
    if (fs.existsSync(PROVIDER_LOG_PATH)) return JSON.parse(fs.readFileSync(PROVIDER_LOG_PATH, "utf-8"));
  } catch {}
  return { jobs: [] };
};

export const writeProviderLog = (jobId, providers) => {
  try {
    const log = readProviderLog();
    const entry = { jobId, providers, timestamp: new Date().toISOString() };
    log.jobs = [entry, ...log.jobs].slice(0, 50); // keep last 50
    fs.mkdirSync(path.dirname(PROVIDER_LOG_PATH), { recursive: true });
    fs.writeFileSync(PROVIDER_LOG_PATH, JSON.stringify(log, null, 2));
  } catch (e) { console.error("Provider log write failed:", e.message); }
};

// POST /api/ai/suggestions
router.post("/suggestions", async (req, res) => {
  try {
    const { prompt } = req.body;
    const response = await axios.post(`${SCRIPT_AI_URL}/get-suggestions`, { prompt });
    res.json(response.data);
  } catch (error) {
    console.error("❌ Suggestions proxy failed:", error.message);
    res.json({ success: true, suggestions: [] }); // fail silently so UI isn't broken
  }
});

// POST /api/ai/enhance-script – returns a FULL production script for the review panel
router.post("/enhance-script", async (req, res) => {
  try {
    const { prompt, duration = 60, category = "motivation", language = "en-US" } = req.body;
    console.log(`📜 enhance-script: "${prompt}" in ${language}`);

    // Step 1: enhance the cinematic prompt
    const enhanceRes = await axios.post(`${SCRIPT_AI_URL}/enhance-prompt`, { prompt });
    const enhancedPrompt = enhanceRes.data.enhanced_prompt || prompt;

    // Step 2: generate a full script from the enhanced prompt
    const scriptRes = await axios.post(`${SCRIPT_AI_URL}/generate-script`, {
      topic: enhancedPrompt,
      category,
      duration,
      language
    });

    if (!scriptRes.data.success) {
      return res.json({
        success: false,
        error: scriptRes.data.message || "Script generation failed due to AI quota limits."
      });
    }

    res.json({
      success: true,
      enhancedPrompt,
      script: scriptRes.data.script || "",
      hook: scriptRes.data.hook || "",
    });
  } catch (error) {
    console.error("❌ enhance-script failed:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/enhance-prompt
router.post("/enhance-prompt", async (req, res) => {
  try {
    const { prompt } = req.body;
    console.log(`✨ Proxying enhance-prompt: "${prompt}"`);
    
    const response = await axios.post(`${SCRIPT_AI_URL}/enhance-prompt`, { prompt });
    res.json(response.data);
  } catch (error) {
    console.error("❌ Enhance prompt proxy failed:", error.message);
    res.status(500).json({ 
      success: false, 
      error_code: "ENHANCE_PROXY_FAILED",
      message: error.message 
    });
  }
});

// POST /api/ai/generate-clip
router.post("/generate-clip", async (req, res) => {
  try {
    const { prompt, duration } = req.body;
    console.log(`🎬 Proxying generate-clip: "${prompt}" (${duration}s)`);
    
    const response = await axios.post(`${VIDEO_AI_URL}/generate-raw-clip`, { prompt, duration });
    res.json(response.data);
  } catch (error) {
    console.error("❌ Generate clip proxy failed:", error.message);
    res.status(500).json({ 
      success: false, 
      error_code: "GENERATE_CLIP_PROXY_FAILED",
      message: error.message 
    });
  }
});

// POST /api/ai/trends
router.post("/trends", async (req, res) => {
  try {
    const { niche } = req.body;
    const response = await axios.post(`${SCRIPT_AI_URL}/get-trends`, { niche });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ success: false, trends: [] });
  }
});

const CREDITS_PATH = path.join(process.cwd(), "storage", "credits.json");

const getInternalCredits = () => {
  try {
    if (!fs.existsSync(CREDITS_PATH)) return { runway: { used: 0, total: 100 }, kling: { used: 0, total: 100 } };
    const data = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf-8"));
    if (!data.kling) {
      data.kling = { used: 0, total: 100, lastUpdated: "" };
    }
    return data;
  } catch { return { runway: { used: 0, total: 100 }, kling: { used: 0, total: 100 } }; }
};

// ─── GET /api/ai/service-status  (comprehensive, all 9 APIs) ─────────────────
router.get("/service-status", async (req, res) => {
  const timeout = 5000;
  const internal = getInternalCredits();

  // ── Parallel checks ──────────────────────────────────────────────────────
  const [
    elData, stData, scriptData, imgData, voiceData,
    videoData, pexData, syncData, openaiData
  ] = await Promise.allSettled([
    axios.get("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, timeout
    }),
    axios.get("https://api.stability.ai/v1/user/balance", {
      headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}` }, timeout
    }),
    axios.get(`${SCRIPT_AI_URL}/health`, { timeout }),
    axios.get(`${IMAGE_AI_URL}/health`,  { timeout }),
    axios.get(`${VOICE_AI_URL}/health`,  { timeout }),
    axios.get(`${VIDEO_AI_URL}/health`,  { timeout }),
    axios.get("https://api.pexels.com/v1/collections/featured", {
      headers: { Authorization: process.env.PEXELS_API_KEY }, timeout
    }),
    axios.get("https://api.synclabs.so/v1/me", {
      headers: { "x-api-key": process.env.SYNCLABS_API_KEY }, timeout
    }),
    // OpenAI – check models endpoint (lightweight)
    process.env.OPENAI_API_KEY
      ? axios.get("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout
        })
      : Promise.reject(new Error("No OPENAI_API_KEY"))
  ]);

  // ── Script AI providers ───────────────────────────────────────────────────
  const scriptHealth = scriptData.status === "fulfilled" ? scriptData.value.data : {};

  // ── Image AI providers ───────────────────────────────────────────────────
  const imgHealth = imgData.status === "fulfilled" ? imgData.value.data : {};

  // ── Voice AI providers ───────────────────────────────────────────────────
  const voiceHealth = voiceData.status === "fulfilled" ? voiceData.value.data : {};

  // ── Video AI providers ───────────────────────────────────────────────────
  const videoHealth = videoData.status === "fulfilled" ? videoData.value.data : {};

  // ── ElevenLabs ───────────────────────────────────────────────────────────
  let elevenlabs = { status: "error", label: "ElevenLabs", role: "voice", primary: false };
  if (elData.status === "fulfilled") {
    const d = elData.value.data;
    const remaining = (d.character_limit || 0) - (d.character_count || 0);
    elevenlabs = {
      status: remaining > 0 ? "active" : "quota",
      label: "ElevenLabs",  role: "voice", primary: false,
      usedFor: "Voice (fallback)",
      credits: remaining, limit: d.character_limit || 10000,
    };
  } else if (elData.status === "rejected") {
    const resp = elData.reason?.response;
    const detail = resp?.data?.detail;
    if (detail && detail.status === "missing_permissions" && detail.message.includes("user_read")) {
      elevenlabs = {
        status: "active",
        label: "ElevenLabs",
        role: "voice",
        primary: false,
        usedFor: "Voice (fallback)",
        credits: "Active (Key lacks user_read)",
        limit: "Unlimited"
      };
    } else {
      elevenlabs.error = detail?.message || elData.reason?.message || "API connection failed";
    }
  }

  // ── Stability AI ─────────────────────────────────────────────────────────
  let stability = { status: "no_key", label: "Stability SDXL", role: "image", primary: false };
  if (stData.status === "fulfilled") {
    stability = { status: "active", label: "Stability SDXL", role: "image", primary: false,
      usedFor: "Images (fallback)", credits: stData.value.data.credits };
  } else if (!process.env.STABILITY_API_KEY) {
    stability.status = "no_key";
  } else {
    stability.status = "error";
  }

  // ── OpenAI ───────────────────────────────────────────────────────────────
  let openai = { status: "no_key", label: "OpenAI ChatGPT", role: "script", primary: false };
  if (!process.env.OPENAI_API_KEY) {
    openai.status = "no_key";
  } else if (openaiData.status === "fulfilled") {
    openai = { status: "active", label: "OpenAI ChatGPT", role: "script", primary: false,
      usedFor: "Script (fallback 2)" };
  } else {
    openai = { status: "error", label: "OpenAI ChatGPT", role: "script", primary: false,
      error: openaiData.reason?.response?.data?.error?.message || "API error" };
  }

  // ── Pexels ───────────────────────────────────────────────────────────────
  let pexels = { status: "error", label: "Pexels Stock", role: "video", primary: false };
  if (pexData.status === "fulfilled") {
    const h = pexData.value.headers;
    pexels = {
      status: "active", label: "Pexels Stock", role: "video", primary: false,
      usedFor: "Video clips (stock mode)",
      credits: h["x-ratelimit-remaining"] || "High",
      limit: h["x-ratelimit-limit"] || "200/hr",
    };
  }

  // ── Kling AI ────────────────────────────────────────────────────────────
  const kling = {
    status: (process.env.FAL_API_KEY || (process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY)) ? "active" : "no_key",
    label: "Kling AI v3.0", role: "video", primary: true,
    usedFor: "AI Video (text2video)",
    credits: (internal.kling ? internal.kling.total - internal.kling.used : 100),
    total: (internal.kling ? internal.kling.total : 100),
  };


  // ── Runway ML ───────────────────────────────────────────────────────────
  const runwayOk = videoHealth.runway_key || bool(process.env.RUNWAYML_API_SECRET);
  const runway = {
    status: process.env.RUNWAYML_API_SECRET ? (videoHealth.runway_key ? "active" : "active") : "no_key",
    label: "RunwayML", role: "video", primary: false,
    usedFor: "AI Video (img2video)",
    credits: internal.runway.total - internal.runway.used,
    total: internal.runway.total,
  };

  // ── Assemble per-stage pipeline view ─────────────────────────────────────
  const stages = [
    {
      stage: 1, name: "Script Generation",
      emoji: "📝",
      microservice: { name: "Script AI", port: Number(new URL(SCRIPT_AI_URL).port || 80), up: scriptData.status === "fulfilled" },
      providers: [
        { id: "gemini",  label: "Gemini 2.0 Flash",    status: scriptHealth.gemini  ? "active" : "offline", tier: 1, usedFor: "Script (primary)" },
        { id: "claude",  label: "Claude 3.5 Sonnet",   status: scriptHealth.claude  ? "active" : "offline", tier: 2, usedFor: "Script (fallback 1)" },
        { id: "pollinations", label: "Pollinations AI", status: "active",             tier: 3, usedFor: "Script (free fallback)" },
        { id: "local",   label: "Local Template",       status: "active",             tier: 4, usedFor: "Script (offline fallback)" },
      ]
    },
    {
      stage: 2, name: "Scene Planning",
      emoji: "🎭",
      microservice: { name: "Script AI", port: Number(new URL(SCRIPT_AI_URL).port || 80), up: scriptData.status === "fulfilled" },
      providers: [
        { id: "claude",  label: "Claude 3.5 Sonnet",   status: scriptHealth.claude  ? "active" : "offline", tier: 1, usedFor: "Scenes (primary)" },
        { id: "gemini",  label: "Gemini 2.0 Flash",    status: scriptHealth.gemini  ? "active" : "offline", tier: 2, usedFor: "Scenes (fallback 1)" },
        { id: "local",   label: "Local Scene Planner", status: "active",             tier: 3, usedFor: "Scenes (offline fallback)" },
      ]
    },
    {
      stage: 3, name: "Image Generation",
      emoji: "🎨",
      microservice: { name: "Image AI", port: 8006, up: imgData.status === "fulfilled" },
      providers: [
        { ...stability, id: "stability", label: "Stability SDXL", status: stability.status, tier: 1, usedFor: "Images (primary)", primary: true },
        { id: "pollinations", label: "Pollinations FLUX.1", status: "active",  tier: 2, usedFor: "Images (fallback 1)" },
        { id: "hf_flux",      label: "HuggingFace FLUX.1",  status: process.env.HF_API_TOKEN ? "active" : "no_key", tier: 3, usedFor: "Images (fallback 2)" },
      ]
    },
    {
      stage: 4, name: "Video / Clips",
      emoji: "🎬",
      microservice: { name: "Video AI", port: Number(new URL(VIDEO_AI_URL).port || 80), up: videoData.status === "fulfilled" },
      providers: [
        { id: "kling",   label: "Kling AI v3.0",       status: kling.status,  tier: 1, usedFor: "AI Video clips (primary)", credits: kling.credits, total: kling.total },
        { id: "runway",  label: "RunwayML img2video",  status: runway.status, tier: 2, usedFor: "AI Video clips (fallback 1)", credits: runway.credits, total: runway.total },
        { id: "kenbur",  label: "Ken Burns (FFmpeg)",  status: "active",      tier: 3, usedFor: "Image animation (fallback 2)" },
        { ...pexels, id: "pexels",  label: "Pexels Stock Media",  status: pexels.status, tier: 4, usedFor: "Stock clips (stock mode)", primary: false },
        { id: "loremflickr", label: "LoremFlickr",     status: "active",      tier: 5, usedFor: "Image fallback" },
      ]
    },
    {
      stage: 5, name: "Voice Synthesis",
      emoji: "🎙️",
      microservice: { name: "Voice AI", port: Number(new URL(VOICE_AI_URL).port || 80), up: voiceData.status === "fulfilled" },
      providers: [
        { ...elevenlabs, id: "elevenlabs", label: "ElevenLabs",         status: elevenlabs.status, tier: 1, usedFor: "Voice (primary)", primary: true },
        { id: "edgetts",    label: "Edge TTS (Free)",   status: "active",        tier: 2, usedFor: "Voice (free fallback)" },
      ]
    },
  ];

  // Read last-used providers from job log
  const providerLog = readProviderLog();

  res.json({
    success: true,
    stages,
    lastJobs: providerLog.jobs.slice(0, 5),
    summary: {
      totalApis: stages.reduce((a, s) => a + s.providers.length, 0),
      activeApis: stages.reduce((a, s) => a + s.providers.filter(p => p.status === "active").length, 0),
      failedApis: stages.reduce((a, s) => a + s.providers.filter(p => p.status === "error" || p.status === "offline").length, 0),
      noKeyApis: stages.reduce((a, s) => a + s.providers.filter(p => p.status === "no_key").length, 0),
    },
    checkedAt: new Date().toISOString(),
  });
});

function bool(v) { return !!v; }

// GET /api/ai/provider-log  – which API was used for each recent job
router.get("/provider-log", (req, res) => {
  res.json({ success: true, ...readProviderLog() });
});

// POST /api/ai/provider-log  – pipeline calls this after each stage
router.post("/provider-log", (req, res) => {
  const { jobId, providers } = req.body;
  if (jobId && providers) writeProviderLog(jobId, providers);
  res.json({ success: true });
});

// Keep old /health for backwards compat
router.get("/health", async (req, res) => {
  const timeout = 4000;
  const scriptData = await axios.get(`${SCRIPT_AI_URL}/health`, { timeout }).catch(() => null);
  const scriptHealth = scriptData?.data || {};
  res.json({
    success: true,
    services: {
      gemini:     { status: scriptHealth.gemini  ? "active" : "offline" },
      claude:     { status: scriptHealth.claude  ? "active" : "offline" },
      openai:     { status: scriptHealth.openai  ? "active" : (process.env.OPENAI_API_KEY ? "error" : "no_key") },
      elevenlabs: { status: process.env.ELEVENLABS_API_KEY ? "configured" : "no_key" },
      runway:     { status: process.env.RUNWAYML_API_SECRET ? "configured" : "no_key" },
      pexels:     { status: process.env.PEXELS_API_KEY ? "configured" : "no_key" },
    }
  });
});

// POST /api/alerts/low-credit
router.post("/alerts/low-credit", async (req, res) => {
  const { service, balance, threshold } = req.body;
  console.log(`⚠️ LOW CREDIT ALERT: ${service} is at ${balance} (Threshold: ${threshold})`);
  res.json({ success: true, notified: true });
});

// POST /api/ai/generate-cinematic
router.post("/generate-cinematic", async (req, res) => {
  try {
    const { prompt, duration = 30 } = req.body;

    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Prompt required" });
    }

    console.log(`🎬 Cinematic pipeline: "${prompt}"`);

    // ── STEP 1: Script AI → Scene Plan ──────────────────────────────
    const sceneCount = duration <= 15 ? 3 : duration <= 30 ? 5 : 8;

    const scenePlanRes = await axios.post(`${SCRIPT_AI_URL}/plan-scenes`, {
      script: prompt,
      topic: prompt,
      category: "storytelling",
      num_scenes: sceneCount
    }, { timeout: 30000 });

    if (!scenePlanRes.data.success) {
      throw new Error("Scene planning failed");
    }

    const scenes = scenePlanRes.data.scenes;
    console.log(`✅ ${scenes.length} scenes planned`);

    // ── STEP 2: Video AI → Kling V3 → Final MP4 ──────────────────────
    const videoRes = await axios.post(`${VIDEO_AI_URL}/generate-cinematic-clip`, {
      scenes: scenes.map((s, i) => ({
        index: i,
        text: s.text || "",
        visual: s.imagePrompt || s.visual || prompt,
        mood: s.mood || "inspiring",
        hero: i === 0
      })),
      category: "storytelling",
      topic: prompt,
      duration: duration
    }, { timeout: 900000 });

    if (!videoRes.data.success) {
      throw new Error(videoRes.data.message || "Video generation failed");
    }

    return res.json({
      success: true,
      video_path: videoRes.data.video_path,
      thumbnail_path: videoRes.data.thumbnail_path,
      scenes_count: scenes.length
    });

  } catch (err) {
    console.error("❌ Cinematic error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
