/**
 * gemini.service.js
 * Uses Google Gemini to generate viral titles and hashtags for reels.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
let geminiEnabled = false;
let model = null;

if (GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        geminiEnabled = true;
        console.log("✅ Gemini Title Generator enabled");
    } catch (err) {
        console.warn("⚠️ Gemini init failed:", err.message);
    }
} else {
    console.warn("⚠️ GEMINI_API_KEY not set in backend .env — using fallback titles");
}

// ── CATEGORY HASHTAGS ──────────────────────────────────────────────────────
const CATEGORY_HASHTAGS = {
    motivation: "#motivation #mindset #discipline #successmindset #grindset #hardwork #mentalstrength #focused #motivationalquotes #neverquit #winning #success #nevergiveup #selfimprovement #levelup",
    storytelling: "#story #inspiration #reallife #successstory #transformation #riseup #trueinspiration #emotionalstory #lifechanging #motivation #shorts #viral #storytelling #reelsviral #growth",
    finance: "#finance #wealth #money #investing #passiveincome #financialfreedom #richhabits #moneytips #financialindependence #stockmarket #realestate #wealthmindset #moneyhabits #financialliteracy #rich",
    dark_psychology: "#psychology #darkpsychology #mindset #humanmind #manipulation #selfawareness #mentalhealth #psychologyfacts #brainhacks #consciousness #mindcontrol #behavior #awareness #influence #personalgrowth",
    ai_news: "#ai #artificialintelligence #chatgpt #openai #aitools #machinelearning #tech #futuretech #aifuture #gemini #airevolution #technology #innovation #aibusiness #digitaltransformation",
};

// ── FALLBACK TITLE TEMPLATES ───────────────────────────────────────────────
const FALLBACK_TITLES = {
    motivation: (topic) => `This ${topic} Mindset Will Change Everything 🔥 #shorts`,
    storytelling: (topic) => `The ${topic} Story Nobody Talks About 😢 #shorts`,
    finance: (topic) => `${topic}: The Money Truth Schools Hide 💰 #shorts`,
    dark_psychology: (topic) => `Dark Psychology of ${topic} (Most Don't Know This) 🧠 #shorts`,
    ai_news: (topic) => `AI Just Changed ${topic} Forever 🤖 #shorts`,
};

/**
 * Generate a viral title + description + hashtags using Gemini.
 * Falls back to templates if Gemini is unavailable.
 *
 * @param {string} topic
 * @param {string} category
 * @param {string} scriptExcerpt - First 200 chars of the generated script
 * @returns {Promise<{title: string, description: string, hashtags: string}>}
 */
export const generateTitleAndHashtags = async (topic, category, scriptExcerpt = "") => {
    const cat = category?.toLowerCase() || "motivation";
    const hashtags = CATEGORY_HASHTAGS[cat] || CATEGORY_HASHTAGS.motivation;

    if (!geminiEnabled || !model) {
        return buildFallback(topic, cat, scriptExcerpt, hashtags);
    }

    try {
        const prompt = `You are a viral YouTube Shorts and Instagram Reels content strategist.

Generate for a ${cat} reel about: "${topic}"

Script excerpt: "${scriptExcerpt.slice(0, 200)}"

Return ONLY valid JSON (no markdown, no backticks) in this format:
{
  "title": "A punchy, curiosity-driving title under 60 characters. Add 1 relevant emoji at the end.",
  "description": "A 2-sentence description that teases the content without spoiling it. Under 120 characters.",
  "hook": "A 1-line teaser for the description caption"
}

Rules:
- Title must be under 60 characters
- Make it sound human, not like AI wrote it
- Avoid: "Discover", "Unlock", "Journey", "Dive into"
- Use power words: Shocking, Nobody, Secret, Hidden, Truth, Dark, Real`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();

        // Strip any markdown code fences if present
        const jsonStr = raw.replace(/^```json?\n?/, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(jsonStr);

        return {
            title: `${parsed.title} #shorts`,
            description: `${parsed.description}\n\n${hashtags}\n#shorts #viral #${topic.replace(/\s+/g, "").toLowerCase().slice(0, 20)}`,
            hashtags,
        };
    } catch (err) {
        console.warn("⚠️ Gemini title generation failed:", err.message, "— using fallback");
        return buildFallback(topic, cat, scriptExcerpt, hashtags);
    }
};

function buildFallback(topic, cat, scriptExcerpt, hashtags) {
    const titleFn = FALLBACK_TITLES[cat] || FALLBACK_TITLES.motivation;
    const cleanedTopic = String(topic || "AI Short")
        .replace(/^create a cinematic 9:16 short-form video about\s+/i, "")
        .split(", with ")[0]
        .replace(/\s*\(v\d+\)\s*$/i, "")
        .trim();
    const titleTopic = cleanedTopic.length > 42 ? `${cleanedTopic.slice(0, 39).trim()}...` : cleanedTopic;
    const title = titleFn(titleTopic);
    const excerpt = scriptExcerpt.slice(0, 100);
    return {
        title,
        description: `${excerpt}...\n\n${hashtags}\n#shorts #viral #${topic.replace(/\s+/g, "").toLowerCase().slice(0, 20)}`,
        hashtags,
    };
}
