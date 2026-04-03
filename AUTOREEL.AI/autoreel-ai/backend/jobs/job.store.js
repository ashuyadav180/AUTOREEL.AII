import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import db from "./db.js";

/**
 * ---------- INTERNAL HELPERS ----------
 */

const serializeJob = (job) => {
  if (!job) return null;
  const result = { ...job };
  if (result.output) {
    result.output = JSON.stringify(result.output);
  }
  return result;
};

const deserializeJob = (row) => {
  if (!row) return null;
  const job = { ...row };
  if (job.output) {
    try {
      job.output = JSON.parse(job.output);
    } catch (e) {
      console.error("Failed to parse job output JSON", e);
      job.output = {};
    }
  }
  return job;
};

/**
 * Migration: Move jobs from jobs.db.json to SQLite if JSON exists
 */
const migrateFromJson = () => {
  const JSON_PATH = path.resolve(process.cwd(), "jobs", "jobs.db.json");
  if (!fs.existsSync(JSON_PATH)) return;

  try {
    const raw = fs.readFileSync(JSON_PATH, "utf-8").trim();
    if (!raw) return;

    const jobs = JSON.parse(raw);
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    console.log(`🚚 Migrating ${jobs.length} jobs from JSON to SQLite...`);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO jobs (
        id, topic, type, status, retries, createdAt, 
        currentStep, stepIndex, stepTotal, percent, lastError, output
      ) VALUES (
        @id, @topic, @type, @status, @retries, @createdAt,
        @currentStep, @stepIndex, @stepTotal, @percent, @lastError, @output
      )
    `);

    const transaction = db.transaction((jobList) => {
      for (const job of jobList) {
        insert.run({
          id: job.id,
          topic: job.topic || "",
          type: job.type || "REEL",
          status: job.status || "PENDING",
          retries: job.retries || 0,
          createdAt: job.createdAt || Date.now(),
          currentStep: job.currentStep || null,
          stepIndex: job.stepIndex || null,
          stepTotal: job.stepTotal || null,
          percent: job.percent || 0,
          lastError: job.lastError || null,
          output: job.output ? JSON.stringify(job.output) : null
        });
      }
    });

    transaction(jobs);
    console.log("✅ Migration complete.");

    // Backup and remove JSON file
    const backupPath = `${JSON_PATH}.bak`;
    fs.renameSync(JSON_PATH, backupPath);
    console.log(`📦 JSON DB backed up to ${backupPath}`);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  }
};

/**
 * ---------- PUBLIC API ----------
 */

/**
 * Automatically delete jobs older than `days`
 */
export const deleteOldJobs = (days = 15) => {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const info = db.prepare("DELETE FROM jobs WHERE createdAt < ?").run(cutoff);
  
  if (info.changes > 0) {
    console.log(`🧹 Deleted ${info.changes} jobs older than ${days} days.`);
  }
  return info.changes;
};

/**
 * Initialize Job Store
 */
export const initJobStore = () => {
  migrateFromJson();
  console.log("✅ Job Store initialized (SQLite)");
  
  // Clean up old jobs on startup
  deleteOldJobs(15);
  
  // Schedule daily cleanup
  setInterval(() => {
    deleteOldJobs(15);
  }, 24 * 60 * 60 * 1000);
};

/**
 * Create new job
 */
export const createNewJob = (topic, type = "REEL", category = "motivation") => {
  const job = {
    id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
    topic,
    type,
    category,
    status: "PENDING",
    retries: 0,
    createdAt: Date.now()
  };

  db.prepare("INSERT INTO jobs (id, topic, type, category, status, retries, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(job.id, job.topic, job.type, job.category, job.status, job.retries, job.createdAt);

  return job;
};

/**
 * Get job by ID
 */
export const getJob = (jobId) => {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  return deserializeJob(row);
};

/**
 * Update job safely
 */
export const updateJob = (jobId, updates = {}) => {
  const current = getJob(jobId);
  if (!current) return null;

  const merged = { ...current, ...updates };
  const serialized = serializeJob(merged);

  const columns = Object.keys(updates);
  if (columns.length === 0) return current;

  const setClause = columns.map(col => `${col} = ?`).join(", ");
  const values = columns.map(col => {
    const val = updates[col];
    return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val;
  });

  db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`).run(...values, jobId);

  return getJob(jobId);
};

/**
 * Increment retry count
 */
export const incrementRetry = (jobId) => {
  db.prepare("UPDATE jobs SET retries = retries + 1 WHERE id = ?").run(jobId);
  const row = db.prepare("SELECT retries FROM jobs WHERE id = ?").get(jobId);
  return row ? row.retries : 0;
};

/**
 * Mark job completed
 */
export const completeJob = (jobId, data = {}) => {
  return updateJob(jobId, {
    status: "COMPLETED",
    completedAt: Date.now(),
    ...data
  });
};

/**
 * Mark job failed
 */
export const failJob = (jobId, data = {}) => {
  return updateJob(jobId, {
    status: "FAILED",
    failedAt: Date.now(),
    ...data
  });
};

/**
 * Cancel job
 */
export const cancelJob = (jobId) => {
  return updateJob(jobId, {
    status: "CANCELLED",
    cancelledAt: Date.now()
  });
};

/**
 * List all jobs
 */
export const listJobs = (limit = 100) => {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?").all(limit);
  return rows.map(deserializeJob);
};

/**
 * Get aggregated stats for the dashboard
 */
export const getJobStats = () => {
  const total = db.prepare("SELECT COUNT(*) as count FROM jobs").get().count;
  const completed = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'COMPLETED'").get().count;
  const failed = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'FAILED'").get().count;
  const running = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'RUNNING'").get().count;

  return {
    total,
    completed,
    failed,
    running,
    successRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0
  };
};

/**
 * Get jobs for the library (completed only)
 */
export const getLibraryJobs = (limit = 20) => {
  const rows = db.prepare("SELECT * FROM jobs WHERE status = 'COMPLETED' ORDER BY createdAt DESC LIMIT ?").all(limit);
  return rows.map(deserializeJob);
};

/**
 * Get per-day job completions for the last N days — for line chart
 */
export const getAnalyticsSeries = (days = 30) => {
  const series = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = now - (i + 1) * 86400000;
    const dayEnd   = now - i * 86400000;
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM jobs WHERE status = 'COMPLETED' AND createdAt >= ? AND createdAt < ?"
    ).get(dayStart, dayEnd).c;
    const label = new Date(dayStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    series.push({ label, count });
  }
  return series;
};

/**
 * Get per-category completion breakdown — for bar chart
 */
export const getAnalyticsByCategory = () => {
  const rows = db.prepare(
    "SELECT category, COUNT(*) as c FROM jobs WHERE status = 'COMPLETED' AND category IS NOT NULL GROUP BY category ORDER BY c DESC LIMIT 8"
  ).all();
  return rows.map(r => ({ category: r.category, count: r.c }));
};
