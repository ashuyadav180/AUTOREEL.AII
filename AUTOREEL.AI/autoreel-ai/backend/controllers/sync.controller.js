import { listJobs, updateJob } from "../jobs/job.store.js";
import uploadService from "../services/youtube.service.js";
const { uploadVideo } = uploadService;

/**
 * Find and upload all videos that are COMPLETED locally but not on YouTube
 */
export const syncPendingUploads = async (req, res) => {
    try {
        const jobs = listJobs();
        const pendingJobs = jobs.filter(j =>
            j.status === "COMPLETED" &&
            j.output?.video &&
            !j.output?.youtubeId &&
            !j.youtubeId
        );

        if (pendingJobs.length === 0) {
            return res.json({
                success: true,
                message: "No pending uploads found",
                count: 0
            });
        }

        // Return immediately to avoid hanging the UI
        res.json({
            success: true,
            message: `Batch sync started for ${pendingJobs.length} videos in background`,
            count: pendingJobs.length
        });

        // Background loop
        (async () => {
            console.log(`🔄 SYNC: Background processing ${pendingJobs.length} videos...`);
            for (const job of pendingJobs) {
                try {
                    console.log(`📤 SYNC: Uploading ${job.id}...`);
                    const uploadResult = await uploadVideo({
                        videoPath: job.output.video,
                        title: job.output.title || `${job.topic} #shorts #motivation`,
                        description: job.output.description || `Automated reel for ${job.topic}`
                    });

                    const updatedOutput = {
                        ...job.output,
                        youtubeId: uploadResult.id,
                        youtubeUrl: `https://youtu.be/${uploadResult.id}`,
                        uploadError: null
                    };

                    updateJob(job.id, { output: updatedOutput });
                } catch (err) {
                    console.error(`❌ SYNC: Failed ${job.id}:`, err.message);
                    updateJob(job.id, {
                        output: { ...job.output, uploadError: err.message }
                    });

                    // Logic to break on quota error
                    if (err.message.toLowerCase().includes("quota") || err.message.toLowerCase().includes("exceeded")) {
                        console.warn("🛑 Quota exceeded, stopping background sync");
                        break;
                    }
                }
            }
        })();

    } catch (err) {
        console.error("❌ Sync failed:", err.message);
        res.status(500).json({
            success: false,
            message: "Bulk sync failed"
        });
    }
};
