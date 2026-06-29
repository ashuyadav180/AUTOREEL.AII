/**
 * scheduler.service.js — AutoReel.ai
 * Time-based scheduled auto-posting system.
 * Exports: startScheduler, setSchedule, getStatus, pauseScheduler, resumeScheduler
 */

import axios from "axios";
import { createNewJob } from "../jobs/job.store.js";
import { runJob } from "../jobs/job.engine.js";

// ── DEFAULT CONFIG ─────────────────────────────────────────────────────────
const DAILY_JOB_LIMIT = 50;

const AI_SERVICES = [
  process.env.SCRIPT_AI_URL || "http://127.0.0.1:8005",
  process.env.VOICE_AI_URL || "http://127.0.0.1:8002",
  process.env.SUBTITLE_AI_URL || "http://127.0.0.1:8003",
  process.env.VIDEO_AI_URL || "http://127.0.0.1:8004",
].map((baseUrl) => `${baseUrl.replace(/\/$/, "")}/health`);

const DEFAULT_TOPICS_BY_CATEGORY = {
  motivation: ["discipline", "success mindset", "mental toughness", "self improvement", "confidence"],
  finance: ["passive income", "investing basics", "wealth habits", "money mindset", "saving vs investing"],
  dark_psychology: ["manipulation tactics", "reading people", "dark triad", "cognitive biases", "persuasion"],
  storytelling: ["rags to riches", "second chances", "impossible dream", "never gave up", "true transformation"],
  ai_news: ["ChatGPT update", "AI jobs impact", "new AI tools", "future of AI", "AI vs humans"],
};

// ── STATE ──────────────────────────────────────────────────────────────────
let paused = true;        // Start paused by default
let jobsToday = 0;
let jobInProgress = false;
let nextRunTimeout = null;
let nextRunTime = null;   // ISO string of next planned run

// Active schedule: array of "HH:MM" strings e.g. ["06:00", "12:00", "18:00"]
let scheduleConfig = {
  times: ["06:00", "13:00", "19:00"],
  category: "motivation",
  language: "en-US",
  voiceGender: "male",
  reelDuration: 60,
};

// ── HELPERS ────────────────────────────────────────────────────────────────

const checkAIHealth = async () => {
  try {
    await Promise.all(AI_SERVICES.map((url) => axios.get(url, { timeout: 3000 })));
    return true;
  } catch {
    return false;
  }
};

/** Calculate ms until the next scheduled time */
const msUntilNextRun = () => {
  const now = new Date();
  const nowMs = now.getTime();

  const todayRuns = scheduleConfig.times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  });

  // Find next future time today
  const upcoming = todayRuns.filter((t) => t > nowMs + 30_000).sort();
  if (upcoming.length) {
    nextRunTime = new Date(upcoming[0]).toISOString();
    return upcoming[0] - nowMs;
  }

  // Nothing left today → earliest time tomorrow
  const earliest = todayRuns.sort()[0];
  const tomorrow = earliest + 24 * 60 * 60 * 1000;
  nextRunTime = new Date(tomorrow).toISOString();
  return tomorrow - nowMs;
};

const resetDailyCounter = () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() < 2) {
    jobsToday = 0;
    console.log("🌅 New day — daily job counter reset");
  }
};

// ── EXECUTOR ───────────────────────────────────────────────────────────────

const executeAutomation = async () => {
  resetDailyCounter();

  if (paused) {
    console.log("⏸️ Scheduler paused");
    scheduleNext();
    return;
  }
  if (jobInProgress) {
    console.log("⏳ Job already running — skipping this slot");
    scheduleNext();
    return;
  }
  if (jobsToday >= DAILY_JOB_LIMIT) {
    console.log("🛑 Daily job limit reached");
    scheduleNext();
    return;
  }

  const healthy = await checkAIHealth();
  if (!healthy) {
    console.log("🚫 AI services down — skipping this slot");
    scheduleNext();
    return;
  }

  const { category, language, voiceGender, reelDuration } = scheduleConfig;
  const topics = DEFAULT_TOPICS_BY_CATEGORY[category] || DEFAULT_TOPICS_BY_CATEGORY.motivation;
  const topic = topics[Math.floor(Math.random() * topics.length)];

  console.log(`⏰ Auto-generating | topic="${topic}" | category=${category}`);

  const job = createNewJob(topic);
  job.category = category;
  job.language = language;
  job.voiceGender = voiceGender;
  job.reelDuration = reelDuration;
  job.isMock = false;

  jobInProgress = true;
  jobsToday++;

  runJob(job)
    .catch(() => { })
    .finally(() => {
      jobInProgress = false;
      scheduleNext();
    });
};

// ── SCHEDULING ─────────────────────────────────────────────────────────────

const scheduleNext = () => {
  if (nextRunTimeout) clearTimeout(nextRunTimeout);

  const delay = msUntilNextRun();
  console.log(`⏳ Next auto-run in ${Math.round(delay / 60000)} min (${nextRunTime})`);
  nextRunTimeout = setTimeout(executeAutomation, delay);
};

// ── PUBLIC EXPORTS ─────────────────────────────────────────────────────────

export const startScheduler = () => {
  console.log("🧠 Scheduler started (paused by default — enable via dashboard)");
  scheduleNext();
};

export const getSchedulerStatus = () => ({
  paused,
  jobsToday,
  jobInProgress,
  nextRunTime,
  schedule: scheduleConfig,
  dailyLimit: DAILY_JOB_LIMIT,
});

export const setSchedule = (config) => {
  if (config.times && Array.isArray(config.times)) {
    scheduleConfig.times = config.times.filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 5);
  }
  if (config.category) scheduleConfig.category = config.category;
  if (config.language) scheduleConfig.language = config.language;
  if (config.voiceGender) scheduleConfig.voiceGender = config.voiceGender;
  if (config.reelDuration) scheduleConfig.reelDuration = Number(config.reelDuration);

  console.log("📅 Schedule updated:", scheduleConfig);
  // Re-schedule with new times
  scheduleNext();
};

export const pauseScheduler = () => {
  paused = true;
  console.log("⏸️ Scheduler paused by user");
};

export const resumeScheduler = () => {
  paused = false;
  console.log("▶️ Scheduler resumed by user");
  scheduleNext();
};
