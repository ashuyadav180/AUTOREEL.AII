import express from "express";
import axios from "axios";

const router = express.Router();

const SCRIPT_AI_URL = process.env.SCRIPT_AI_URL || "http://127.0.0.1:8005";
const VIDEO_AI_URL = process.env.VIDEO_AI_URL || "http://127.0.0.1:8004";

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
    const { prompt, duration = 60, category = "motivation" } = req.body;
    console.log(`📜 enhance-script: "${prompt}"`);

    // Step 1: enhance the cinematic prompt
    const enhanceRes = await axios.post(`${SCRIPT_AI_URL}/enhance-prompt`, { prompt });
    const enhancedPrompt = enhanceRes.data.enhanced_prompt || prompt;

    // Step 2: generate a full script from the enhanced prompt
    const scriptRes = await axios.post(`${SCRIPT_AI_URL}/generate-script`, {
      topic: enhancedPrompt,
      category,
      duration,
      language: "en-US"
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

import fs from "fs";
import path from "path";

const CREDITS_PATH = path.join(process.cwd(), "storage", "credits.json");

// Helper to get internal credits
const getInternalCredits = () => {
  try {
    if (!fs.existsSync(CREDITS_PATH)) return { runway: { used: 0, total: 100 } };
    return JSON.parse(fs.readFileSync(CREDITS_PATH, "utf-8"));
  } catch (e) { return { runway: { used: 0, total: 100 } }; }
};

// GET /api/ai/health
router.get("/health", async (req, res) => {
  const internal = getInternalCredits();
  
  const results = {
    gemini: { status: "unknown", credits: "Free Tier", lastSynced: new Date() },
    claude: { status: "unknown", credits: "Quota Based", lastSynced: new Date() },
    stability: { status: "unknown", credits: 0, lastSynced: new Date() },
    runway: { 
      status: "active", 
      credits: internal.runway.total - internal.runway.used, 
      total: internal.runway.total,
      lastSynced: new Date(internal.runway.lastUpdated || new Date())
    },
    elevenlabs: { status: "unknown", credits: 0, limit: 10000, lastSynced: new Date() },
    pexels: { status: "unknown", credits: "0", lastSynced: new Date() },
    synclabs: { status: "unknown", credits: 0, lastSynced: new Date() }
  };

  const timeout = 5000; // 5s timeout for any individual AI service check

  const [elData, stData, scriptData, pexData, syncData] = await Promise.allSettled([
    // 1. ElevenLabs
    axios.get("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      timeout
    }),
    // 2. Stability AI
    axios.get("https://api.stability.ai/v1/user/balance", {
      headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}` },
      timeout
    }),
    // 3. Script AI
    axios.get(`${SCRIPT_AI_URL}/health`, { timeout }),
    // 4. Pexels
    axios.get("https://api.pexels.com/v1/collections/featured", {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      timeout
    }),
    // 5. SyncLabs
    axios.get("https://api.synclabs.so/v1/me", {
      headers: { "x-api-key": process.env.SYNCLABS_API_KEY },
      timeout
    })
  ]);

  if (elData.status === 'fulfilled') {
    const d = elData.value.data;
    results.elevenlabs = {
      status: "active",
      credits: (d.character_limit || 0) - (d.character_count || 0),
      limit: d.character_limit || 10000,
      lastSynced: new Date()
    };
  } else {
    results.elevenlabs.status = "error";
    results.elevenlabs.error = elData.reason?.response?.data?.detail?.message || "Service unavailable";
  }

  if (stData.status === 'fulfilled') {
    results.stability = { status: "active", credits: stData.value.data.credits, lastSynced: new Date() };
  } else {
    results.stability.status = "error";
  }

  if (scriptData.status === 'fulfilled') {
    results.gemini.status = scriptData.value.data.gemini ? "active" : "offline";
    results.claude.status = scriptData.value.data.claude ? "active" : "offline";
  } else {
    results.gemini.status = "offline";
    results.claude.status = "offline";
  }

  if (pexData.status === 'fulfilled') {
    const h = pexData.value.headers;
    results.pexels = {
      status: "active",
      credits: h["x-ratelimit-remaining"] || "High",
      limit: h["x-ratelimit-limit"] || "200",
      type: "rate-limit",
      lastSynced: new Date()
    };
  } else {
    results.pexels.status = "error";
    results.pexels.error = "Rate limit exceeded or invalid key";
  }

  // SyncLabs Processing
  if (syncData.status === 'fulfilled') {
    results.synclabs = {
      status: "active",
      credits: syncData.value.data.credits || 0,
      limit: syncData.value.data.limit || 100,
      lastSynced: new Date()
    };
  } else {
    results.synclabs = { status: "error", credits: 0, limit: 100, error: "Authentication failed", lastSynced: new Date() };
  }

  res.json({ success: true, services: results });
});

// POST /api/alerts/low-credit
router.post("/alerts/low-credit", async (req, res) => {
  const { service, balance, threshold } = req.body;
  console.log(`⚠️ LOW CREDIT ALERT: ${service} is at ${balance} (Threshold: ${threshold})`);
  // Here you could send an email or Slack notification
  res.json({ success: true, notified: true });
});

export default router;
