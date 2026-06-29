import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import mime from "mime-types";

// Optional: install mime-types if you want better content tagging
// for now I'll just use a simple lookup or ignore it since S3 can often infer or we can set binary

/**
 * Storage Service
 * 
 * This service abstracts file storage (Local vs Cloud).
 * Supports Local FS and S3-compatible (R2/AWS/DigitalOcean).
 */

const configuredStorageType = process.env.STORAGE_TYPE || "local"; // local | s3
const STORAGE_ROOT = path.resolve(process.cwd(), "storage");
const hasPlaceholder = (value = "") => value.includes("<") || value.includes("your-") || value.includes("example");
const hasUsableS3Config = Boolean(
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME &&
    !hasPlaceholder(process.env.S3_ENDPOINT) &&
    !hasPlaceholder(process.env.S3_ACCESS_KEY_ID) &&
    !hasPlaceholder(process.env.S3_SECRET_ACCESS_KEY) &&
    !hasPlaceholder(process.env.S3_BUCKET_NAME)
);
const STORAGE_TYPE = configuredStorageType === "s3" && hasUsableS3Config ? "s3" : "local";

if (configuredStorageType === "s3" && STORAGE_TYPE === "local") {
    console.warn("Storage fallback: S3 is configured but missing usable credentials/endpoints. Using local storage.");
}

// S3 Configuration
const s3Client = STORAGE_TYPE === "s3" ? new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
}) : null;

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Helper to ensure directory exists (for local)
const ensureDir = async (dir) => {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
};

export const ensureStorageDirs = async () => {
    if (STORAGE_TYPE === "local") {
        const dirs = ["tmp", "video", "audio", "subtitles", "thumbnails"];
        for (const d of dirs) {
            await ensureDir(path.join(STORAGE_ROOT, d));
        }
    }
};

/**
 * Upload a file to storage
 * @param {string} sourcePath 
 * @param {string} category - tmp | video | audio etc
 * @returns {Promise<string>} - The relative path or URL
 */
export const uploadFile = async (sourcePath, category = "tmp") => {
    const filename = path.basename(sourcePath);
    
    if (STORAGE_TYPE === "s3") {
        const fileContent = await fs.readFile(sourcePath);
        const key = `${category}/${filename}`;
        
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: fileContent,
            // ACL: "public-read", // R2 doesn't always need this if bucket is public
            ContentType: getContentType(filename)
        }));

        return key; // Return the key as the relative path
    } else {
        const destRel = `storage/${category}/${filename}`;
        const destAbs = path.join(STORAGE_ROOT, category, filename);

        if (sourcePath !== destAbs) {
            await fs.copyFile(sourcePath, destAbs);
        }

        return destRel;
    }
};

/**
 * Get the public URL for a storage file
 */
export const getFileUrl = (relPath) => {
    if (STORAGE_TYPE === "s3") {
        const publicBase = process.env.S3_PUBLIC_URL || `${process.env.S3_ENDPOINT}/${BUCKET_NAME}`;
        return `${publicBase}/${relPath}`;
    } else {
        const API_URL = process.env.API_URL || "http://localhost:5000";
        return `${API_URL}/${relPath}`;
    }
};

/**
 * Get absolute path from relative storage path
 */
export const getAbsPath = (relPath) => {
    if (path.isAbsolute(relPath)) return relPath;
    if (STORAGE_TYPE === "local") {
        return path.resolve(process.cwd(), relPath);
    }
    // For S3, we don't really have an "absolute path" on the local disk
    // but the pipeline might need it for temporary processing.
    // Usually, we download from S3 to tmp if needed, but here we assume 
    // it might be referring to a local file that was just "uploaded" but still exists.
    return path.resolve(process.cwd(), relPath); 
};

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const map = {
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.json': 'application/json',
        '.srt': 'text/plain',
        '.vtt': 'text/vtt'
    };
    return map[ext] || 'application/octet-stream';
}

export default {
    uploadFile,
    getFileUrl,
    getAbsPath,
    ensureStorageDirs
};
