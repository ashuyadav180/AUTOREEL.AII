import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { google } from "googleapis";

const PROJECT_ROOT = process.cwd();

const CREDENTIALS_PATH = path.join(
  PROJECT_ROOT,
  "config",
  "client_secret.json"
);

const TOKEN_PATH = path.join(
  PROJECT_ROOT,
  "config",
  "youtube.oauth.json"
);

const sanitizeYoutubeTitle = (title = "") => {
  const cleaned = String(title)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned || "AI Generated Short";
  return safe.length > 95 ? `${safe.slice(0, 92).trim()}...` : safe;
};

// ---------- Load Credentials ----------
let credentials = null;
let oauth2Client = null;
let youtube = null;

try {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8").trim();
    if (raw) {
      credentials = JSON.parse(raw);
    }
  }
} catch (err) {
  console.warn("⚠️ Failed to load client_secret.json:", err.message);
}

if (credentials) {
  try {
    oauth2Client = new google.auth.OAuth2(
      credentials.installed?.client_id || credentials.web?.client_id,
      credentials.installed?.client_secret || credentials.web?.client_secret,
      (credentials.installed?.redirect_uris || credentials.web?.redirect_uris)?.[0]
    );

    // ---------- Auto-save refreshed tokens ----------
    oauth2Client.on("tokens", (tokens) => {
      try {
        // Merge new tokens with existing ones (keep refresh_token if not returned)
        let existing = {};
        if (fs.existsSync(TOKEN_PATH)) {
          const raw = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
          if (raw) existing = JSON.parse(raw);
        }
        const merged = { ...existing, ...tokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
        console.log("🔄 YouTube token auto-refreshed and saved.");
      } catch (e) {
        console.warn("⚠️ Failed to save refreshed token:", e.message);
      }
    });

    // ---------- Load Token (SAFE) ----------
    if (fs.existsSync(TOKEN_PATH)) {
      const raw = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
      if (raw.length > 0) {
        oauth2Client.setCredentials(JSON.parse(raw));
      } else {
        console.warn("⚠️ youtube.oauth.json is empty, ignoring it");
      }
    }

    // ---------- YouTube Client ----------
    youtube = google.youtube({
      version: "v3",
      auth: oauth2Client,
    });
  } catch (err) {
    console.warn("⚠️ Failed to initialize YouTube client:", err.message);
  }
} else {
  console.warn("⚠️ client_secret.json missing or invalid - YouTube upload disabled");
}

// ---------- OAuth Callback ----------
const handleOAuthCallback = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("✅ YouTube OAuth token saved.");
};

// ---------- Ensure Token is Fresh ----------
const ensureFreshToken = async () => {
  if (!oauth2Client) throw new Error("OAuth client not initialized");

  const creds = oauth2Client.credentials;
  const isExpired = !creds.access_token || (creds.expiry_date && Date.now() >= creds.expiry_date - 60000);

  if (isExpired) {
    if (!creds.refresh_token) {
      throw new Error("Access token expired and no refresh_token available. Please re-authenticate at /api/youtube/auth");
    }
    console.log("🔄 Access token expired — refreshing...");
    const { credentials: newCreds } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(newCreds);

    // Persist manually in case event doesn't fire
    try {
      let existing = {};
      if (fs.existsSync(TOKEN_PATH)) {
        const raw = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
        if (raw) existing = JSON.parse(raw);
      }
      const merged = { ...existing, ...newCreds };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
      console.log("✅ Token refreshed and saved.");
    } catch (e) {
      console.warn("⚠️ Could not save refreshed token:", e.message);
    }
  }
};

// ---------- Upload ----------
const uploadVideo = async ({ videoPath, title, description, tags = [] }) => {
  if (!youtube) {
    throw new Error("YouTube client not initialized. Check client_secret.json");
  }

  // Ensure token is valid before uploading
  await ensureFreshToken();
  const safeTitle = sanitizeYoutubeTitle(title);

  console.log(`🚀 Starting YouTube Upload: "${title}"`);
  console.log(`   📁 File: ${videoPath}`);

  // Combine passed tags with default shorts tags (deduplicated)
  const allTags = [...new Set([...tags, "shorts", "viral", "youtubeshorts", "reels"])];

    const videoBuffer = fs.readFileSync(videoPath);
    const videoStream = Readable.from(videoBuffer);

  const res = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: safeTitle,
        description,
        categoryId: "22",  // People & Blogs
        tags: allTags,
        defaultLanguage: "en",
      },
      status: {
        privacyStatus:            "public",
        selfDeclaredMadeForKids:  false,
        madeForKids:              false,
      },
    },
    media: {
      body: videoStream,
    },
  }, {
    timeout: 0, // 0 prevents timeout aborts for slow video uploads
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  console.log(`✅ YouTube Upload Success! Video ID: ${res.data.id}`);
  return res.data;
};

// ---------- Connection Status ----------
const getConnectionStatus = async () => {
  if (!credentials) return { status: "Config Missing" };
  if (!fs.existsSync(TOKEN_PATH)) return { status: "Not Connected" };

  try {
    const raw = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
    if (!raw) return { status: "Not Connected" };
    
    const tokens = JSON.parse(raw);
    const isExpired = tokens.expiry_date && Date.now() >= tokens.expiry_date;
    
    // We can also try to get the channel info to verify the token works
    return {
      status: "Connected",
      isExpired,
      hasRefreshToken: !!tokens.refresh_token,
      expiryDate: tokens.expiry_date,
    };
  } catch (e) {
    return { status: "Error", message: e.message };
  }
};

// ---------- Disconnect ----------
const disconnect = async () => {
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
    console.log("🗑️ YouTube token deleted.");
  }
  return { success: true };
};

export default {
  handleOAuthCallback,
  uploadVideo,
  getConnectionStatus,
  disconnect,
};
