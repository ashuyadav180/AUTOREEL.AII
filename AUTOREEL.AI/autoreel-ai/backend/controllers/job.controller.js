import {
  createNewJob,
  getJob,
  listJobs,
  updateJob,
  cancelJob
} from "../jobs/job.store.js";

import { queue } from "../jobs/job.engine.js";
import { getIO } from "../io-singleton.js";

/**
 * Create a new job
 */
export const createJob = async (req, res) => {
  try {
    const { topic, count = 1, isMock, category = "motivation", language = "en-US", voiceGender = "male", reelDuration = 60, renderMode = "stock", type = "REEL" } = req.body;
    const jobCount = Math.min(Math.max(parseInt(count) || 1, 1), 10); // Max 10

    if (!topic || topic.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Topic must be at least 3 characters"
      });
    }

    const createdJobs = [];
    for (let i = 0; i < jobCount; i++) {
      const jobTopic = type === "PROMPT_TO_VIDEO" ? topic.trim() : `${topic.trim()} (v${i + 1})`;
      const job = createNewJob(jobTopic, type, category);
      job.isMock = isMock || false;
      job.category = category;
      job.language = language;
      job.voiceGender = voiceGender;
      job.reelDuration = type === "PROMPT_TO_VIDEO" ? (parseInt(reelDuration) || 5) : ([30, 60, 90].includes(Number(reelDuration)) ? Number(reelDuration) : 60);
      job.renderMode = renderMode;
      createdJobs.push(job);
    }

    // Add to BullMQ-lite queue for background processing
    createdJobs.forEach(job => queue.add(job));

    return res.json({
      success: true,
      jobs: createdJobs,
      count: createdJobs.length
    });

  } catch (err) {
    console.error("❌ Create job failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to create job"
    });
  }
};

/**
 * Cancel a job
 */
export const cancelJobById = (req, res) => {
  const { id } = req.params;
  const job = cancelJob(id);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "Job not found"
    });
  }

  console.log(`🛑 Job cancelled by user: ${id}`);
  
  try {
    const io = getIO();
    io.emit("job:update", { jobId: id, status: "CANCELLED" });
  } catch(e) {}

  res.json({
    success: true,
    message: "Job cancelled",
    job
  });
};

/**
 * Retry/Resume a stuck or paused job
 */
export const retryJobById = (req, res) => {
  const { id } = req.params;
  const job = getJob(id);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "Job not found"
    });
  }

  if (["RUNNING", "COMPLETED"].includes(job.status)) {
    return res.status(400).json({
      success: false,
      message: "Job is already running or completed"
    });
  }

  console.log(`▶ Manually restarting job: ${id}`);
  
  // Add to BullMQ-lite queue
  queue.add(job); 

  res.json({
    success: true,
    message: "Job restarted"
  });
};

/**
 * Get single job
 */
export const getJobById = (req, res) => {
  const { id } = req.params;
  const job = getJob(id);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "Job not found"
    });
  }

  res.json({
    success: true,
    job
  });
};

/**
 * Get all jobs
 */
export const getAllJobs = (req, res) => {
  const jobs = listJobs();

  res.json({
    success: true,
    jobs
  });
};

import uploadService from "../services/youtube.service.js";
const { uploadVideo } = uploadService;

/**
 * Manually upload a job's video to YouTube
 */
export const uploadJobToYoutube = async (req, res) => {
  const { id } = req.params;
  const job = getJob(id);

  if (!job || !job.output || !job.output.video) {
    return res.status(404).json({ success: false, message: "Job or video not found" });
  }

  try {
    const io = getIO();
    updateJob(id, { currentStep: "Manual Uploading...", percent: 95 });
    io.emit("job:progress", { jobId: id, step: "Uploading to YouTube (Manual)...", percent: 95 });

    // Category-specific YouTube tags
    const CATEGORY_TAGS = {
      motivation:      ["motivation", "mindset", "success", "shorts"],
      storytelling:    ["story", "inspiration", "shorts"],
      finance:         ["finance", "money", "wealth", "shorts"],
      dark_psychology: ["psychology", "mindset", "shorts"],
      ai_news:         ["ai", "tech", "shorts"],
    };
    const tags = CATEGORY_TAGS[job.category] || ["shorts", "viral"];

    const uploadResult = await uploadVideo({
      videoPath: job.output.video,
      title: job.output.title || job.topic,
      description: job.output.description || `AI video about ${job.topic}`,
      tags
    });

    const updatedOutput = {
      ...job.output,
      youtubeId: uploadResult.id,
      youtubeUrl: `https://youtu.be/${uploadResult.id}`
    };

    updateJob(id, { 
      output: updatedOutput,
      percent: 100 
    });

    io.emit("job:youtube", { 
      jobId: id, 
      youtubeId: uploadResult.id, 
      youtubeUrl: `https://youtu.be/${uploadResult.id}` 
    });

    res.json({ success: true, message: "Uploaded to YouTube", youtubeUrl: `https://youtu.be/${uploadResult.id}` });

  } catch (err) {
    console.error("❌ Manual upload failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
