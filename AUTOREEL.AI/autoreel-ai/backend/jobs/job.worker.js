import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import path from "path";
import axios from "axios";

// We need to import the pipeline and storage logic
import { runReelPipeline } from "../services/reel.pipeline.js";
import uploadService from "../services/youtube.service.js";
const { uploadVideo } = uploadService;

const VIDEO_AI_URL = process.env.VIDEO_AI_URL || "http://127.0.0.1:8004";
const SCRIPT_AI_URL = process.env.SCRIPT_AI_URL || "http://127.0.0.1:8005";
const CREDITS_PATH = "storage/credits.json";

/**
 * Deduct credits - simplified for worker
 * Note: Since this writes to a file, we might have contention if multiple workers do it.
 * In a real app, this should be in the main thread or use a DB.
 */
const deductRunwayCredit = () => {
    try {
        if (!fs.existsSync(CREDITS_PATH)) return;
        const data = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf-8"));
        
        if (process.env.FAL_API_KEY || (process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY)) {
            if (!data.kling) {
                data.kling = { used: 0, total: 100, lastUpdated: "" };
            }
            data.kling.used += 1;
            data.kling.lastUpdated = new Date().toISOString();
            console.log("Worker: Deducted Kling AI credit");
        } else {
            data.runway.used += 1;
            data.runway.lastUpdated = new Date().toISOString();
            console.log("Worker: Deducted RunwayML credit");
        }
        
        fs.writeFileSync(CREDITS_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Worker: Failed to deduct credit:", e); }
};

async function start() {
    const { job } = workerData;
    const jobId = job.id;

    console.log(`🧵 Worker started for job: ${jobId}`);

    try {
        if (job.type === "PROMPT_TO_VIDEO") {
            await runPromptToVideoJob(job);
        } else if (job.type === "CINEMATIC") {
            await runCinematicJob(job);
        } else {
            await runStandardJob(job);
        }
    } catch (err) {
        const msg = err.message || "WORKER_ERROR";
        parentPort.postMessage({ type: "failed", error: msg });
    }
}

async function runStandardJob(job) {
    const jobId = job.id;

    const onProgress = (currentStep, index, total, percent) => {
        parentPort.postMessage({ 
            type: "progress", 
            data: { currentStep, stepIndex: index, stepTotal: total, percent } 
        });
    };

    const result = await runReelPipeline(
        job.topic,
        job.category || "motivation",
        job.language || "en-US",
        job.voiceGender || "male",
        job.reelDuration || 60,
        async () => {
             // Cancellation check
             // This is tricky in a worker. We'll rely on the parent to terminate the worker
             // but the pipeline has a callback. We can pass a flag via a shared buffer if needed
             // or just check a variable that we set when parent sends a 'cancel' message.
             return false; 
        },
        onProgress,
        job.renderMode || "ai_video",
        job.enableVoice !== false,
        job.enableSubtitles !== false
    );

    if (result.videoRel) {
        result.video = result.videoRel;
    }

    parentPort.postMessage({ type: "completed", result });

    // Upload after completion so a slow/auth-blocked YouTube request never
    // leaves the rendered video stuck in the generation state.
    if (result.video && job.autoUpload !== false && !job.isMock) {
        const CATEGORY_TAGS = {
            motivation:      ["motivation", "mindset", "discipline", "success", "shorts", "viral"],
            storytelling:    ["story", "inspiration", "transformation", "shorts", "viral"],
            finance:         ["finance", "money", "investing", "wealth", "shorts", "viral"],
            dark_psychology: ["psychology", "mindset", "darkpsychology", "awareness", "shorts"],
            ai_news:         ["ai", "artificialintelligence", "tech", "chatgpt", "shorts", "viral"],
        };
        const tags = CATEGORY_TAGS[result.category] || ["shorts", "viral", "motivation"];

        try {
            parentPort.postMessage({ type: "progress", data: { currentStep: "Uploading to YouTube", percent: 100 } });

            const uploadResult = await uploadVideo({
                videoPath:   result.video,
                title:       result.title,
                description: result.description,
                tags,
            });

            parentPort.postMessage({
                type: "youtube",
                data: {
                    youtubeId: uploadResult.id,
                    youtubeUrl: `https://youtu.be/${uploadResult.id}`,
                }
            });
        } catch (uploadErr) {
            console.error("Worker: YouTube upload failed:", uploadErr.message);
            parentPort.postMessage({ type: "youtube_failed", error: uploadErr.message });
        }
    }
}

async function runPromptToVideoJob(job) {
    const jobId = job.id;

    parentPort.postMessage({ type: "progress", data: { currentStep: "Initializing generation...", percent: 10 } });
    parentPort.postMessage({ type: "progress", data: { currentStep: "Requesting AI Video Generation...", percent: 30 } });

    const response = await axios.post(`${VIDEO_AI_URL}/generate-raw-clip`, {
        prompt: job.topic,
        duration: job.reelDuration || 5
    }, { timeout: 600000 });

    if (!response.data.success) {
        throw new Error(response.data.message || "Video generation failed");
    }

    deductRunwayCredit();

    const result = {
        video: response.data.video_path,
        title: job.topic.substring(0, 50),
        description: `AI Generated video for: ${job.topic}`,
        category: job.category || "motivation"
    };

    parentPort.postMessage({ type: "progress", data: { currentStep: "Finalizing clip...", percent: 90 } });
    parentPort.postMessage({ type: "completed", result });
}

async function runCinematicJob(job) {
    const jobId = job.id;

    parentPort.postMessage({ type: "progress", data: { currentStep: "Initializing cinematic pipeline...", percent: 10 } });
    parentPort.postMessage({ type: "progress", data: { currentStep: "Planning cinematic scenes...", percent: 20 } });

    // Step 1: plan-scenes on Script AI
    const sceneCount = job.reelDuration <= 15 ? 3 : job.reelDuration <= 30 ? 5 : 8;
    const scenePlanRes = await axios.post(`${SCRIPT_AI_URL}/plan-scenes`, {
      script: job.topic,
      topic: job.topic,
      category: job.category || "storytelling",
      num_scenes: sceneCount
    }, { timeout: 120000 });

    if (!scenePlanRes.data.success) {
      throw new Error("Scene planning failed");
    }

    const scenes = scenePlanRes.data.scenes;
    parentPort.postMessage({ type: "progress", data: { currentStep: `Generating ${sceneCount} cinematic clips via Kling V3...`, percent: 40 } });

    // Step 2: generate-cinematic-clip on Video AI
    const videoRes = await axios.post(`${VIDEO_AI_URL}/generate-cinematic-clip`, {
      scenes: scenes.map((s, i) => ({
        index: i,
        text: s.text || "",
        visual: s.imagePrompt || s.visual || job.topic,
        mood: s.mood || "inspiring",
        hero: i === 0
      })),
      category: job.category || "storytelling",
      topic: job.topic,
      duration: job.reelDuration || 30
    }, { timeout: 1800000 }); // 30 min timeout

    if (!videoRes.data.success) {
        throw new Error(videoRes.data.message || "Cinematic video generation failed");
    }

    // Deduct credits:
    for (let i = 0; i < scenes.length; i++) {
        deductRunwayCredit();
    }

    const result = {
        video: videoRes.data.video_path,
        thumbnail: videoRes.data.thumbnail_path,
        title: job.topic.substring(0, 50),
        description: `Cinematic AI video for: ${job.topic}`,
        category: job.category || "storytelling"
    };

    parentPort.postMessage({ type: "progress", data: { currentStep: "Finalizing video...", percent: 90 } });
    parentPort.postMessage({ type: "completed", result });
}

start();
