import express from "express";
import fs from "fs";
import path from "path";
import {
    sendWelcomeEmail,
    sendOtpEmail,
    sendResetPasswordEmail,
    sendVideoReadyEmail,
    sendVideoFailedEmail,
    sendSubscriptionSuccessEmail
} from "../services/emailService.js";


const router = express.Router();
const STORAGE_PATH = path.join(process.cwd(), "storage", "user_profile.json");

// Helper to read profile
const readProfile = () => {
    try {
        if (!fs.existsSync(STORAGE_PATH)) return null;
        return JSON.parse(fs.readFileSync(STORAGE_PATH, "utf-8"));
    } catch (err) {
        console.error("Error reading profile:", err);
        return null;
    }
};

// Helper to write profile
const writeProfile = (data) => {
    try {
        fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error("Error writing profile:", err);
        return false;
    }
};

// GET /api/user/profile
router.get("/profile", (req, res) => {
    let profile = readProfile();
    
    if (!profile) {
        // Return a default profile instead of 404 to prevent blank pages
        profile = {
            displayName: "AutoReel Creator",
            email: "creator@autoreel.ai",
            plan: "Free Plan",
            memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            stats: { totalGenerated: 0, totalPosted: 0, accountAge: "0 Days" },
            preferences: { niche: "Motivation", duration: "10s", voiceLanguage: "English", autoEnhance: true },
            platformStatus: {
                youtube: { status: 'Connect', channel: null, subs: null },
                tiktok: { status: 'Connect', channel: null, subs: null },
                instagram: { status: 'Coming Soon', channel: null, subs: null }
            }
        };
    }
    
    res.json({ success: true, profile });
});

// PATCH /api/user/preferences
router.patch("/preferences", (req, res) => {
    const profile = readProfile();
    if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });

    // Update fields (handles deep merging for preferences if needed, but here simple top-level or specific nested)
    const updates = req.body;
    
    // Process updates
    Object.keys(updates).forEach(key => {
        if (key === 'preferences') {
            profile.preferences = { ...profile.preferences, ...updates.preferences };
        } else {
            profile[key] = updates[key];
        }
    });

    if (writeProfile(profile)) {
        res.json({ success: true, profile });
    } else {
        res.status(500).json({ success: false, message: "Failed to save preferences" });
    }
});

// DELETE /api/user/account (Mock)
router.delete("/account", (req, res) => {
    // In a real app, this would delete DB records. Here we just reset to a baseline.
    const baseline = {
        displayName: "AutoReel Creator",
        email: "creator@autoreel.ai",
        plan: "Free Plan",
        preferences: { niche: "Motivation", duration: "10s", voiceLanguage: "English", autoEnhance: true }
    };
    if (writeProfile(baseline)) {
        res.json({ success: true, message: "Account data cleared" });
    } else {
        res.status(500).json({ success: false, message: "Reset failed" });
    }
});

// POST /api/user/test-email
router.post("/test-email", async (req, res) => {
    const { templateType, toEmail, data = {} } = req.body;
    
    if (!toEmail) {
        return res.status(400).json({ success: false, message: "Recipient email (toEmail) is required" });
    }
    
    try {
        let result;
        const name = data.name || "AutoReel Creator";
        
        switch (templateType) {
            case "welcome":
                result = await sendWelcomeEmail(toEmail, name);
                break;
            case "otp":
                const otp = data.otpCode || Math.floor(100000 + Math.random() * 900000).toString();
                result = await sendOtpEmail(toEmail, otp);
                break;
            case "resetPassword":
                const resetLink = data.resetLink || "https://autoreel.ai/reset-password?token=test_token_123";
                result = await sendResetPasswordEmail(toEmail, resetLink);
                break;
            case "videoReady":
                const videoTitle = data.videoTitle || "5 Mindset Rules for Success";
                const videoUrl = data.videoUrl || "https://autoreel.ai/storage/reels/test-reel.mp4";
                const niche = data.niche || "Motivation";
                result = await sendVideoReadyEmail(toEmail, name, videoTitle, videoUrl, niche);
                break;
            case "videoFailed":
                const videoTopic = data.videoTopic || "Failed Cinematic Reel Prompt";
                const errorMsg = data.errorMessage || "ElevenLabs Voice Generation Quota Exceeded";
                result = await sendVideoFailedEmail(toEmail, name, videoTopic, errorMsg);
                break;
            case "subscription":
                const planName = data.planName || "Pro Plan";
                const price = data.price || "$29.00";
                result = await sendSubscriptionSuccessEmail(toEmail, name, planName, price);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: "Invalid templateType. Must be one of: welcome, otp, resetPassword, videoReady, videoFailed, subscription"
                });
        }
        
        res.json({ success: true, message: `Test email (${templateType}) sent successfully`, result });
    } catch (err) {
        console.error("Test email route error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;

