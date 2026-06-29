import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Configuration for services
const services = [
    { name: "script_ai", port: 8015, path: "ai-services/script_ai" },
    { name: "voice_ai", port: 8012, path: "ai-services/voice_ai" },
    { name: "subtitle_ai", port: 8003, path: "ai-services/subtitle_ai" },
    { name: "image_ai", port: 8006, path: "ai-services/image_ai" },
    { name: "video_ai", port: 8014, path: "ai-services/video_ai" },
];

const findRoot = () => {
    if (fs.existsSync(path.join(process.cwd(), "ai-services"))) return process.cwd();
    if (fs.existsSync(path.join(process.cwd(), "..", "ai-services"))) return path.resolve(process.cwd(), "..");
    throw new Error("Could not find project root (ai-services directory missing). Run from 'autoreel-ai' or 'autoreel-ai/backend'.");
};

const PROJECT_ROOT = findRoot();

console.log(`📂 Project Root detected: ${PROJECT_ROOT}`);
console.log("🚀 Starting AutoReel AI Services...");




services.forEach((service) => {
    const servicePath = path.join(PROJECT_ROOT, service.path);

    // Detect Python interpreter (venv or system)
    let pythonPath = "python";
    if (process.platform === "win32") {
        const venvPath = path.join(servicePath, "venv", "Scripts", "python.exe");
        if (fs.existsSync(venvPath)) pythonPath = venvPath;
    } else {
        const venvPath = path.join(servicePath, "venv", "bin", "python");
        if (fs.existsSync(venvPath)) pythonPath = venvPath;
    }

    console.log(`[${service.name}] Starting on port ${service.port}... (using ${pythonPath})`);

    // Spawn the process
    // We use 'python -m uvicorn' to ensure we use the installed module in that environment
    const child = spawn(
        pythonPath,
        ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(service.port), "--reload"],
        {
            cwd: servicePath,
            shell: true,
            stdio: "pipe", // Capture output
        }
    );

    // Handle stdout
    child.stdout.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        lines.forEach(line => {
            console.log(`[${service.name}] ${line}`);
        });
    });

    // Handle stderr (Wait for standard logs)
    child.stderr.on("data", (data) => {
        const lines = data.toString().trim().split("\n");
        lines.forEach(line => {
            // Filter out some noisy logs if needed, or just print all
            console.error(`[${service.name}] ${line}`);
        });
    });

    child.on("close", (code) => {
        console.log(`[${service.name}] Process exited with code ${code}`);
    });

    child.on("error", (err) => {
        console.error(`[${service.name}] Failed to start: ${err.message}`);
    });
});

console.log("✅ All service spawn commands issued.");
// Keep process alive
console.log("Press Ctrl+C to stop all services.");
setInterval(() => { }, 1000);

process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, p) => {
    console.error('CRITICAL: Unhandled Rejection:', reason);
});
