import { Worker } from "worker_threads";
import path from "path";
import fs from "fs";
import {
  updateJob,
  failJob,
  completeJob,
  incrementRetry,
  getJob,
  listJobs
} from "./job.store.js";

import { getIO } from "../io-singleton.js";
import { sendVideoReadyEmail, sendVideoFailedEmail } from "../services/emailService.js";

const getCreatorProfile = () => {
  try {
    const profilePath = path.join(process.cwd(), "storage", "user_profile.json");
    if (fs.existsSync(profilePath)) {
      const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
      return {
        email: data.email || "creator@autoreel.ai",
        displayName: data.displayName || "AutoReel Creator"
      };
    }
  } catch (err) {
    console.error("Error reading user profile for email:", err);
  }
  return {
    email: "creator@autoreel.ai",
    displayName: "AutoReel Creator"
  };
};

const MAX_RETRIES = 3;

/**
 * BullMQ-lite Queue Implementation
 */
class JobQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.activeWorkers = new Map(); // jobId -> Worker
  }

  add(job) {
    console.log(`📥 Job added to queue: ${job.id}`);
    this.queue.push(job);
    this.processNext();
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const job = this.queue.shift();
    try {
      await runJob(job);
    } catch (err) {
      console.error(`❌ Queue process error [${job.id}]:`, err.message);
    } finally {
      this.processing = false;
      this.processNext(); // Loop
    }
  }

  cancelJob(jobId) {
    // 1. Remove from pending queue if it is still waiting
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(j => j.id !== jobId);
    if (this.queue.length < initialLength) {
        console.log(`🛑 Removed job ${jobId} from pending queue`);
    }

    // 2. Terminate active worker if running
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
        console.log(`🛑 Terminating worker for cancelled job: ${jobId}`);
        worker.terminate();
        this.activeWorkers.delete(jobId);
    }
  }
}

export const queue = new JobQueue();

/**
 * Main Job Runner (Spawns Worker)
 */
export const runJob = async (job) => {
  const jobId = job.id;

  // Fetch latest state to ensure it wasn't cancelled while in queue
  const latestJob = getJob(jobId);
  if (latestJob && latestJob.status === "CANCELLED") {
    console.log(`🛑 Skipping cancelled job before start: ${jobId}`);
    return;
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    console.log(`🚀 Job started (Worker): ${jobId} | topic="${job.topic}"`);

    updateJob(jobId, { status: "RUNNING", startedAt: Date.now() });
    getIO().emit("job:update", { jobId, status: "RUNNING" });

    const workerPath = path.resolve(process.cwd(), "jobs", "job.worker.js");
    const worker = new Worker(workerPath, {
      workerData: { job }
    });

    queue.activeWorkers.set(jobId, worker);

    worker.on("message", (msg) => {
      const io = getIO();
      
      switch (msg.type) {
        case "progress":
          updateJob(jobId, msg.data);
          io.emit("job:progress", { jobId, ...msg.data });
          break;

        case "youtube":
          {
            const current = getJob(jobId);
            const output = { ...(current?.output || {}), ...msg.data };
            updateJob(jobId, {
              output,
              currentStep: "Uploaded to YouTube",
              percent: 100,
              lastError: null
            });
            io.emit("job:update", { jobId, status: "COMPLETED", output });
          }
          io.emit("job:youtube", { jobId, ...msg.data });
          break;

        case "youtube_failed":
          updateJob(jobId, {
            currentStep: "Video ready - YouTube upload failed",
            percent: 100,
            lastError: msg.error
          });
          io.emit("job:update", { jobId, status: "COMPLETED", error: msg.error });
          break;

        case "completed":
          completeJob(jobId, { output: msg.result, completedAt: Date.now() });
          io.emit("job:update", { jobId, status: "COMPLETED", output: msg.result });
          queue.activeWorkers.delete(jobId);
          
          // Send video ready notification email asynchronously
          (async () => {
            try {
              const profile = getCreatorProfile();
              const videoTitle = msg.result.title || job.topic;
              const niche = msg.result.category || job.category || "General";
              
              let videoUrl = msg.result.video || "";
              if (videoUrl && !videoUrl.startsWith("http")) {
                const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
                videoUrl = `${baseUrl}/${videoUrl}`;
              }
              
              await sendVideoReadyEmail(profile.email, profile.displayName, videoTitle, videoUrl, niche);
            } catch (err) {
              console.error(`[Email Notification] Error sending video ready email for job ${jobId}:`, err.message);
            }
          })();

          finish(msg.result);
          break;

        case "failed":
          handleFailure(jobId, msg.error);
          queue.activeWorkers.delete(jobId);
          finish(null);
          break;
      }
    });

    worker.on("error", (err) => {
      console.error(`❌ Worker error [${jobId}]:`, err.message);
      handleFailure(jobId, err.message);
      queue.activeWorkers.delete(jobId);
      finish(null);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`❌ Worker exited with code ${code} [${jobId}]`);
        // If not already handled by 'message:failed' or 'error'
        const current = getJob(jobId);
        if (current && current.status === "RUNNING") {
            handleFailure(jobId, `Worker exited with code ${code}`);
        }
      }
      queue.activeWorkers.delete(jobId);
      finish(null);
    });
  });
};

const handleFailure = (jobId, errorMessage) => {
  const io = getIO();
  console.error(`❌ Job failure: ${jobId} | ${errorMessage}`);
  
  const retries = incrementRetry(jobId);
  const isPermanent = ["quota", "limit", "exceeded", "authorized"].some(
      (k) => errorMessage.toLowerCase().includes(k)
  );

  if (isPermanent || retries > MAX_RETRIES) {
    failJob(jobId, { status: "FAILED", lastError: errorMessage, failedAt: Date.now() });
    io.emit("job:update", { jobId, status: "FAILED", error: errorMessage });
    
    // Send video failed notification email asynchronously
    (async () => {
      try {
        const profile = getCreatorProfile();
        const jobDetails = getJob(jobId);
        const videoTopic = jobDetails?.topic || "AI Video Job";
        await sendVideoFailedEmail(profile.email, profile.displayName, videoTopic, errorMessage);
      } catch (err) {
        console.error(`[Email Notification] Error sending video failed email for job ${jobId}:`, err.message);
      }
    })();
  } else {
    updateJob(jobId, { status: "PAUSED", lastError: errorMessage });
    io.emit("job:update", { jobId, status: "PAUSED", retries });
  }
};

/**
 * Resume jobs that were interrupted on server restart
 */
export const resumePendingJobs = () => {
  console.log("🔄 Checking for interrupted jobs...");
  const jobs = listJobs();
  const interrupted = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING");

  if (!interrupted.length) { console.log("✅ No interrupted jobs."); return; }

  console.log(`⚠️ Marking ${interrupted.length} interrupted jobs as PAUSED (Manual start required)...`);
  interrupted.forEach((job) => {
    updateJob(job.id, { status: "PAUSED", lastError: "Interrupted by server restart" });
    // DO NOT queue.add(job) -> Wait for user to click Resume
  });
};
