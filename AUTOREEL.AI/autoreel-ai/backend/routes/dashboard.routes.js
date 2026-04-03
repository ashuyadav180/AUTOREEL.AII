import express from "express";
import { getJobStats, getLibraryJobs, getAnalyticsSeries, getAnalyticsByCategory } from "../jobs/job.store.js";

const router = express.Router();

const getVideoPath = (output = {}) => {
  const candidates = [output.videoRel, output.video];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;

    const normalized = candidate.replace(/\\/g, "/");
    const storageMatch = normalized.match(/(?:^|\/)(storage\/.+)$/i);
    if (storageMatch) {
      return storageMatch[1];
    }
  }

  return null;
};

/** GET /api/dashboard/stats */
router.get("/stats", (req, res) => {
  try {
    const stats = getJobStats();
    res.json({
      success: true,
      stats: {
        ...stats,
        posted: stats.completed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/dashboard/analytics?days=30 */
router.get("/analytics", (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const stats       = getJobStats();
    const series      = getAnalyticsSeries(days);
    const categories  = getAnalyticsByCategory();

    res.json({
      success: true,
      stats: {
        total:     stats.total,
        completed: stats.completed,
        failed:    stats.failed,
        running:   stats.running,
      },
      series,      // [{ label: 'Mar 1', count: 4 }, ...]
      categories,  // [{ category: 'motivation', count: 12 }, ...]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/dashboard/library */
router.get("/library", (req, res) => {
  try {
    const library = getLibraryJobs(50).map(j => ({
      id: j.id,
      topic: j.topic || "Untitled AI Video",
      category: j.category || "motivation",
      videoPath: getVideoPath(j.output),
      createdAt: j.createdAt,
      language: j.output?.language || j.language || null
    }));
      
    res.json({ success: true, library });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
