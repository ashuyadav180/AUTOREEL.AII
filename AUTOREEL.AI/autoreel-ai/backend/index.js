// index.js

import "dotenv/config"; // LOAD ENV FIRST
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import { rateLimit } from "express-rate-limit";

import reelRoutes from "./routes/reelRoutes.js";
import uploadRoutes from "./routes/upload.routes.js";
import aiRoutes from "./routes/ai.routes.js";

import jobRoutes from "./routes/job.routes.js";

import dashboardRoutes from "./routes/dashboard.routes.js";
import userRoutes from "./routes/user.routes.js";

import { initJobStore } from "./jobs/job.store.js";
import { resumePendingJobs } from "./jobs/job.engine.js";

import { initMusicLibrary } from "./services/music.service.js";
import { setIO } from "./io-singleton.js";

const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin);


const app = express();
const server = http.createServer(app);

/* ---------- MIDDLEWARE ---------- */
app.use(cors({
  origin: function(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json());
app.use("/storage", express.static("storage"));

/* ---------- RATE LIMIT ---------- */
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 500, // Limit each IP to 500 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again after 5 minutes." },
});
app.use(limiter);

/* ---------- SOCKET ---------- */
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  }
});
setIO(io);
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`🔌 Client disconnected: ${socket.id}`));
});

/* ---------- HEALTH ---------- */
app.get("/health", (req, res) => {
  res.json({ success: true });
});

/* ---------- ROUTES ---------- */
app.use("/", reelRoutes);
app.use("/api", uploadRoutes);
app.use("/", jobRoutes); 

app.use("/api/ai", aiRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/user", userRoutes);

/* ---------- INIT ---------- */
initJobStore();
resumePendingJobs();

initMusicLibrary();

/* ---------- SERVER ---------- */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);

});
