import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../context/ToastContext";
import { useSocket } from "../hooks/useSocket";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

/* ── Inline styles ─────────────────────────────────────────────────────── */
const CARD = {
  background: "var(--surface)",
  borderRadius: "24px",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-lg)",
  overflow: "hidden",
};

export default function PromptToVideo({
  duration, setDuration,
  prompt, setPrompt,
  suggestions, setSuggestions,
  loading, setLoading,
  enhancing, setEnhancing,
  suggesting, setSuggesting,
  generationType, setGenerationType,
  renderMode, setRenderMode,
  language, setLanguage,
  voiceGender, setVoiceGender,
  currentJob, setCurrentJob,
  generatedVideo, setGeneratedVideo,
  uploading, setUploading,
  youtubeUrl, setYoutubeUrl,
  uploadDone, setUploadDone,
  ytConnected, setYtConnected,
  enableVoice, setEnableVoice,
  enableSubtitles, setEnableSubtitles,
  scriptPreview, setScriptPreview,
  showPreview, setShowPreview
}) {
  const { showToast } = useToast();
  const { connected, lastUpdate } = useSocket();

  const durations = [15, 30, 60, 90];
  const textareaRef = useRef(null);

  // ── Auto-resize textarea ───────────────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [prompt]);

  // ── Check YouTube connection on mount ─────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/api/youtube/status`)
      .then(r => setYtConnected(r.data?.connected ?? false))
      .catch(() => setYtConnected(false));
  }, []);

  // ── Debounced suggestions ─────────────────────────────────────────────
  useEffect(() => {
    if (prompt.length < 4) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setSuggesting(true);
      try {
        const res = await axios.post(`${API}/api/ai/suggestions`, { prompt });
        if (res.data.success && res.data.suggestions?.length) {
          setSuggestions(res.data.suggestions.slice(0, 3));
        }
      } catch { /* silent */ }
      finally { setSuggesting(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [prompt]);

  // ── Job WebSocket ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!lastUpdate || !currentJob) return;

    if ((lastUpdate.type === "update" || lastUpdate.type === "progress") && (lastUpdate.id === currentJob.id || lastUpdate.jobId === currentJob.id)) {
        setCurrentJob(prev => ({ ...prev, ...lastUpdate }));
        
        if (lastUpdate.status === "COMPLETED") {
            setGeneratedVideo(lastUpdate.output?.video);
            setLoading(false);
            showToast("success", "🎬", "Video generation complete!");
        } else if (lastUpdate.status === "FAILED") {
            setLoading(false);
            showToast("error", "✕", lastUpdate.lastError || lastUpdate.error || "Generation failed");
        } else if (lastUpdate.status === "CANCELLED") {
            setLoading(false);
            showToast("info", "🛑", "Generation cancelled");
        }
    }
  }, [lastUpdate]);

  // Fallback polling keeps the UI honest if a WebSocket event is missed during
  // a long render, backend restart, or upload failure.
  useEffect(() => {
    if (!loading || !currentJob?.id) return;

    const timer = setInterval(async () => {
      try {
        const res = await axios.get(`${API}/api/jobs/${currentJob.id}`);
        const job = res.data?.job;
        if (!job) return;

        setCurrentJob(prev => ({ ...prev, ...job }));

        if (job.status === "COMPLETED") {
          setGeneratedVideo(job.output?.video);
          setLoading(false);
          showToast("success", "✓", "Video generation complete!");
        } else if (job.status === "FAILED") {
          setLoading(false);
          showToast("error", "×", job.lastError || "Generation failed");
        } else if (job.status === "CANCELLED") {
          setLoading(false);
        }
      } catch {
        // Keep the render running; the next poll/socket update may recover.
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [loading, currentJob?.id, showToast]);

  /* ── Handlers ─────────────────────────────────────────────────────────── */

  // 🪄 ENHANCE — generate full script preview
  const handleEnhance = async () => {
    if (!prompt.trim()) { showToast("error", "⚠", "Enter a prompt first!"); return; }
    setEnhancing(true);
    showToast("info", "🪄", "Generating AI Script... please wait.");
    setShowPreview(false);
    setScriptPreview(null);
    try {
      const res = await axios.post(`${API}/api/ai/enhance-script`, {
        prompt,
        duration,
        category: "motivation",
        language,
      });
      if (res.data.success) {
        setScriptPreview({
          enhancedPrompt: res.data.enhancedPrompt,
          script: res.data.script,
          hook: res.data.hook,
        });
        setShowPreview(true);
        setSuggestions([]);
        showToast("success", "✨", "Script generated! Review below.");
      } else {
        showToast("error", "✕", res.data.error || "Enhancement failed — try again");
      }
    } catch {
      showToast("error", "✕", "Failed to reach AI service");
    } finally {
      setEnhancing(false);
    }
  };

  // 🎬 GENERATE — use the enhanced prompt if available, otherwise raw prompt
  const handleGenerate = async () => {
    const topic = scriptPreview?.enhancedPrompt || prompt;
    if (!topic.trim()) { showToast("error", "⚠", "Enter a prompt first!"); return; }
    setLoading(true);
    setGeneratedVideo(null);
    setCurrentJob(null);
    setShowPreview(false);
    setYoutubeUrl(null);
    setUploadDone(false);
    try {
      const res = await axios.post(`${API}/api/jobs`, {
        topic,
        reelDuration: duration,
        type: generationType,
        category: "motivation",
        renderMode,
        language,
        voiceGender,
        enableVoice,
        enableSubtitles,
      });
      if (res.data.success) {
        setCurrentJob(res.data.jobs[0]);
        showToast("info", "🚀", "Generation started! Tracking progress below...");
      }
    } catch {
      showToast("error", "✕", "Failed to start generation");
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!currentJob) return;
    // Check auth first
    if (!ytConnected) {
      try {
        const authRes = await axios.get(`${API}/api/youtube/auth`);
        if (authRes.data?.authUrl) {
          window.open(authRes.data.authUrl, "_blank", "width=500,height=650");
          showToast("info", "🔑", "Complete YouTube login in the popup, then click Upload again.");
          return;
        }
      } catch { /* fall through to upload attempt */ }
    }
    setUploading(true);
    try {
      const res = await axios.post(`${API}/api/jobs/${currentJob.id}/upload`);
      if (res.data.success) {
        setYoutubeUrl(res.data.youtubeUrl);
        setUploadDone(true);
        setYtConnected(true);
        showToast("success", "🎉", "Uploaded to YouTube Shorts!");
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Upload failed";
      // If it's an auth error, open the auth flow
      if (msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("token") || err.response?.status === 401) {
        try {
          const authRes = await axios.get(`${API}/api/youtube/auth`);
          if (authRes.data?.authUrl) {
            window.open(authRes.data.authUrl, "_blank", "width=500,height=650");
            showToast("info", "🔑", "Connect your YouTube account in the popup, then upload again.");
            setYtConnected(false);
            return;
          }
        } catch { /* ignore */ }
      }
      showToast("error", "✕", "Upload failed: " + msg);
    } finally { setUploading(false); }
  };

  const handleCancel = async () => {
    if (!currentJob) return;
    setCurrentJob({ ...currentJob, status: "CANCELLED" });
    setLoading(false);
    showToast("info", "🛑", "Cancelling...");
    try { await axios.post(`${API}/api/jobs/${currentJob.id}/cancel`); } catch { /* silent */ }
  };

  const dismissPreview = () => { setShowPreview(false); setScriptPreview(null); };

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={CARD}>

      {/* ── HEADER ── */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 40, height: 40, background: "linear-gradient(135deg,#6366f1,#a855f7)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✨</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Prompt → AI Video</h2>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text3)" }}>Powered by Gemini · Claude · RunwayML</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--green)" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)" }} />
          Engine ready
        </div>
      </div>

      <div style={{ padding: 24 }}>

        {/* ── PROMPT BOX ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>
            Describe Your Video
          </label>

          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. The dark psychology of why people stay poor…"
              style={{
                width: "100%", minHeight: 100, background: "var(--surface2)",
                border: "1px solid var(--border)", borderRadius: 16, padding: "16px 20px",
                color: "var(--text)", fontSize: 14, lineHeight: 1.6, resize: "none",
                outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)", transition: "border-color 0.2s",
              }}
              onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />
            {suggesting && (
              <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11, color: "var(--accent)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>🪄</motion.span>
                AI thinking...
              </div>
            )}
          </div>
        </div>

        {/* ── SUGGESTIONS ────────────────────────────────────────────────── */}
        <AnimatePresence>
          {suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              style={{ marginBottom: 16 }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.06em" }}>
                💡 Suggestions — click to use
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {suggestions.map((s, i) => (
                  <motion.button
                    key={i}
                    whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                    onClick={() => { setPrompt(s); setSuggestions([]); }}
                    style={{
                      padding: "6px 14px", background: "var(--accent-soft)", border: "1px solid rgba(99,102,241,0.25)",
                      borderRadius: 20, fontSize: 12, color: "var(--accent)", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── GENERATION MODE ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>Generation Mode</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "REEL", label: "🎬 Full Cinematic Reel", sub: "Voice + Music + Subtitles" },
              { id: "CINEMATIC", label: "🎥 Cinematic Video", sub: "Pure Kling V3 Direct (No Voice/Subs)" },
              { id: "PROMPT_TO_VIDEO", label: "⚡ Raw B-Roll Clip", sub: "Single Silent Clip Only" },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setGenerationType(m.id)}
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 12, cursor: "pointer",
                  border: generationType === m.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: generationType === m.id ? "var(--accent-soft)" : "var(--surface2)",
                  color: generationType === m.id ? "var(--accent)" : "var(--text2)",
                  fontSize: 13, fontWeight: 700, textAlign: "left", fontFamily: "inherit", transition: "all 0.18s",
                }}
              >
                <div style={{ marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontSize: 10, fontWeight: 500, color: generationType === m.id ? "var(--accent)" : "var(--text3)" }}>{m.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── VISUAL SOURCING MODE ─────────────────────────────────────────────── */}
        {generationType === "REEL" && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>
              Visual Asset Sourcing
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "ai_video", label: "🎨 AI Art Synthesis", sub: "SDXL Generation + Ken Burns" },
                { id: "stock", label: "📦 Premium Stock Media", sub: "Pexels Context Sourcing" },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setRenderMode(m.id)}
                  style={{
                    flex: 1, padding: "12px 16px", borderRadius: 12, cursor: "pointer",
                    border: renderMode === m.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: renderMode === m.id ? "var(--accent-soft)" : "var(--surface2)",
                    color: renderMode === m.id ? "var(--accent)" : "var(--text2)",
                    fontSize: 13, fontWeight: 700, textAlign: "left", fontFamily: "inherit", transition: "all 0.18s",
                  }}
                >
                  <div style={{ marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: renderMode === m.id ? "var(--accent)" : "var(--text3)" }}>{m.sub}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── DURATION ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>Video Duration</label>
          <div style={{ display: "flex", gap: 8 }}>
            {durations.map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                style={{
                  flex: 1, padding: "9px 4px", borderRadius: 10, cursor: "pointer",
                  border: duration === d ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: duration === d ? "var(--accent-soft)" : "var(--surface2)",
                  color: duration === d ? "var(--accent)" : "var(--text2)",
                  fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "all 0.18s",
                }}
              >{d}s</button>
            ))}
          </div>
        </div>

        {/* ── LANGUAGE & VOICE SELECTION ─────────────────────────────────── */}
        {generationType === "REEL" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>
                Script Language
              </label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                style={{
                  width: "100%", background: "var(--surface2)",
                  border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px",
                  color: "var(--text)", fontSize: 13, fontWeight: 700, outline: "none",
                  fontFamily: "inherit", cursor: "pointer", transition: "border-color 0.2s",
                  boxSizing: "border-box", height: "46px",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(99,102,241,0.5)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              >
                <option value="en-US">🇺🇸 English (US)</option>
                <option value="hi-IN">🇮🇳 Hindi (हिंदी)</option>
                <option value="es-ES">🇪🇸 Spanish (Español)</option>
                <option value="fr-FR">🇫🇷 French (Français)</option>
                <option value="de-DE">🇩🇪 German (Deutsch)</option>
                <option value="pt-BR">🇧🇷 Portuguese (Português)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "block" }}>
                Voice Gender
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { id: "male", label: "👨 Male Voice" },
                  { id: "female", label: "👩 Female Voice" },
                ].map(g => (
                  <button
                    key={g.id}
                    onClick={() => setVoiceGender(g.id)}
                    style={{
                      flex: 1, height: "46px", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                      border: voiceGender === g.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: voiceGender === g.id ? "var(--accent-soft)" : "var(--surface2)",
                      color: voiceGender === g.id ? "var(--accent)" : "var(--text2)",
                      fontSize: 13, fontWeight: 700, fontFamily: "inherit", transition: "all 0.18s",
                    }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CINEMATIC OPTIONS ────────────────────────────────────────────── */}
        {generationType === "REEL" && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, display: "block" }}>
              🎬 Cinematic Options
            </label>
            <div style={{ display: "flex", gap: 10 }}>

              {/* Voice toggle */}
              <button
                onClick={() => setEnableVoice(v => !v)}
                style={{
                  flex: 1, padding: "13px 16px", borderRadius: 12, cursor: "pointer",
                  border: enableVoice ? "1px solid rgba(99,102,241,0.6)" : "1px solid var(--border)",
                  background: enableVoice ? "var(--accent-soft)" : "var(--surface2)",
                  color: enableVoice ? "var(--accent)" : "var(--text3)",
                  fontFamily: "inherit", transition: "all 0.18s",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>🎙️ Voice Narration</div>
                  <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{enableVoice ? "ElevenLabs AI voice" : "Silent — no audio"}</div>
                </div>
                <div style={{
                  width: 38, height: 20, borderRadius: 10, transition: "background 0.2s",
                  background: enableVoice ? "var(--accent)" : "rgba(120,120,140,0.35)",
                  position: "relative", flexShrink: 0,
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: enableVoice ? 20 : 2,
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }} />
                </div>
              </button>

              {/* Subtitles toggle */}
              <button
                onClick={() => setEnableSubtitles(s => !s)}
                style={{
                  flex: 1, padding: "13px 16px", borderRadius: 12, cursor: "pointer",
                  border: enableSubtitles ? "1px solid rgba(99,102,241,0.6)" : "1px solid var(--border)",
                  background: enableSubtitles ? "var(--accent-soft)" : "var(--surface2)",
                  color: enableSubtitles ? "var(--accent)" : "var(--text3)",
                  fontFamily: "inherit", transition: "all 0.18s",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>📝 Subtitles</div>
                  <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{enableSubtitles ? "Burned-in captions" : "No text overlay"}</div>
                </div>
                <div style={{
                  width: 38, height: 20, borderRadius: 10, transition: "background 0.2s",
                  background: enableSubtitles ? "var(--accent)" : "rgba(120,120,140,0.35)",
                  position: "relative", flexShrink: 0,
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: enableSubtitles ? 20 : 2,
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }} />
                </div>
              </button>

            </div>
            {!enableVoice && !enableSubtitles && (
              <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(168,85,247,0.08)", borderRadius: 8, border: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "#a855f7", fontWeight: 600 }}>
                🎬 Pure Cinematic Mode — visual-only, no voice, no text overlay
              </div>
            )}
            {!enableVoice && enableSubtitles && (
              <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(99,102,241,0.08)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.2)", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                📝 Silent + Subtitles — captions will use the script text directly
              </div>
            )}
          </div>
        )}

        {/* ── ACTIONS ────────────────────────────────────────────────────── */}

        <div style={{ display: "flex", gap: 10 }}>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleEnhance}
            disabled={enhancing || loading}
            style={{
              flex: 1, padding: "14px", borderRadius: 12, border: "1px solid rgba(168,85,247,0.35)",
              background: enhancing ? "rgba(168,85,247,0.08)" : "transparent",
              color: "var(--text)", fontWeight: 700, cursor: enhancing ? "default" : "pointer",
              fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all 0.2s",
            }}
          >
            {enhancing
              ? <><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>✨</motion.span> Generating Script...</>
              : "✨ Enhance + Preview Script"
            }
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={loading || enhancing}
            style={{
              flex: 2, padding: "14px", borderRadius: 12, border: "none",
              background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
              color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer",
              fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            {loading ? "⏳ Rendering..." : "🎬 Generate Video"}
          </motion.button>
        </div>

        {/* ── SCRIPT PREVIEW BAR ─────────────────────────────────────────── */}
        <AnimatePresence>
          {showPreview && scriptPreview && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
              style={{
                marginTop: 20,
                background: "linear-gradient(135deg, rgba(99,102,241,0.07), rgba(168,85,247,0.04))",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 18,
                overflow: "hidden",
              }}
            >
              {/* Preview header */}
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    AI Script Ready — Review Before Generating
                  </span>
                </div>
                <button
                  onClick={dismissPreview}
                  style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                >✕</button>
              </div>

              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Enhanced prompt pill */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    🎯 Enhanced Prompt
                  </div>
                  <div style={{
                    padding: "10px 14px", background: "rgba(99,102,241,0.1)", borderRadius: 10,
                    fontSize: 13, color: "var(--accent)", fontStyle: "italic", lineHeight: 1.5,
                    border: "1px solid rgba(99,102,241,0.2)",
                  }}>
                    "{scriptPreview.enhancedPrompt}"
                  </div>
                </div>

                {/* Hook */}
                {scriptPreview.hook && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                      ⚡ Opening Hook
                    </div>
                    <div style={{
                      padding: "10px 14px", background: "rgba(249,115,22,0.08)", borderRadius: 10,
                      fontSize: 13, color: "#fb923c", fontWeight: 600, lineHeight: 1.5,
                      border: "1px solid rgba(249,115,22,0.2)",
                    }}>
                      {scriptPreview.hook}
                    </div>
                  </div>
                )}

                {/* Full script */}
                {scriptPreview.script && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                      📜 Full Script
                    </div>
                    <div style={{
                      padding: "14px 16px", background: "var(--surface2)", borderRadius: 10, maxHeight: 200,
                      overflowY: "auto", fontSize: 12, color: "var(--text2)", lineHeight: 1.7,
                      border: "1px solid var(--border)",
                    }}>
                      {scriptPreview.script}
                    </div>
                  </div>
                )}

                {/* CTA buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={handleGenerate}
                    style={{
                      flex: 2, padding: "13px", borderRadius: 12, border: "none",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
                      boxShadow: "0 4px 20px rgba(16,185,129,0.3)",
                    }}
                  >
                    🚀 Looks Good — Start Generation!
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => { dismissPreview(); }}
                    style={{
                      flex: 1, padding: "13px", borderRadius: 12,
                      border: "1px solid var(--border)", background: "transparent",
                      color: "var(--text3)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
                    }}
                  >
                    ✏ Edit Prompt
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── GENERATION PROGRESS ─────────────────────────────────────────── */}
        <AnimatePresence>
          {loading && currentJob && currentJob.status !== "COMPLETED" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              style={{ marginTop: 20, padding: 20, background: "var(--surface2)", borderRadius: 16, border: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
                <span style={{ color: "var(--text2)" }}>{currentJob.currentStep || "Initializing pipeline..."}</span>
                <span style={{ color: "var(--accent)" }}>{currentJob.percent || 0}%</span>
              </div>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden", marginBottom: 16 }}>
                <motion.div
                  animate={{ width: `${currentJob.percent || 0}%` }}
                  style={{ height: "100%", background: "linear-gradient(90deg, #6366f1, #a855f7)", borderRadius: 3 }}
                />
              </div>
              <button
                onClick={handleCancel}
                style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid var(--red)", background: "transparent", color: "var(--red)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}
              >
                🛑 Cancel Generation
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── RESULT ─────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {generatedVideo && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              style={{ marginTop: 24 }}
            >
              {/* Video player */}
              <div style={{
                borderRadius: 20, overflow: "hidden",
                border: "1px solid rgba(99,102,241,0.3)",
                background: "#000",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                position: "relative",
              }}>
                <video
                  src={`${API}/${generatedVideo}`}
                  controls autoPlay loop
                  style={{ width: "100%", maxHeight: 420, display: "block" }}
                />
                {/* Completed badge */}
                <div style={{
                  position: "absolute", top: 12, left: 12,
                  padding: "4px 10px", borderRadius: 20,
                  background: "rgba(16,185,129,0.9)",
                  backdropFilter: "blur(8px)",
                  fontSize: 11, fontWeight: 800, color: "#fff",
                  display: "flex", alignItems: "center", gap: 5,
                  letterSpacing: "0.04em",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
                  VIDEO READY
                </div>
              </div>

              {/* YouTube Upload Panel */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                style={{
                  marginTop: 16,
                  borderRadius: 18,
                  overflow: "hidden",
                  border: uploadDone
                    ? "1px solid rgba(16,185,129,0.4)"
                    : "1px solid rgba(255,0,0,0.25)",
                  background: uploadDone
                    ? "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.04))"
                    : "linear-gradient(135deg, rgba(255,0,0,0.07), rgba(200,30,30,0.03))",
                }}
              >
                {/* Panel header */}
                <div style={{
                  padding: "12px 18px",
                  borderBottom: uploadDone
                    ? "1px solid rgba(16,185,129,0.15)"
                    : "1px solid rgba(255,0,0,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* YouTube icon */}
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: uploadDone ? "#10b981" : "#ff0000",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14,
                    }}>
                      {uploadDone ? "✓" : "▶"}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: uploadDone ? "#10b981" : "#ff4444" }}>
                        {uploadDone ? "Published to YouTube Shorts!" : "Upload to YouTube Shorts"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 1 }}>
                        {ytConnected === false
                          ? "⚠ YouTube not connected — click Upload to authorize"
                          : ytConnected === true
                          ? "✅ YouTube connected · OAuth2 active"
                          : "Checking connection..."
                        }
                      </div>
                    </div>
                  </div>
                  {/* YT connection pill */}
                  <div style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: ytConnected ? "rgba(16,185,129,0.15)" : "rgba(255,100,50,0.15)",
                    color: ytConnected ? "#10b981" : "#fb923c",
                    border: `1px solid ${ytConnected ? "rgba(16,185,129,0.3)" : "rgba(255,100,50,0.3)"}`,
                  }}>
                    {ytConnected ? "CONNECTED" : ytConnected === false ? "NOT CONNECTED" : "CHECKING"}
                  </div>
                </div>

                <div style={{ padding: "14px 18px" }}>

                  {/* ── SUCCESS STATE ── */}
                  {uploadDone && youtubeUrl ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ display: "flex", flexDirection: "column", gap: 10 }}
                    >
                      <div style={{
                        padding: "12px 16px",
                        background: "rgba(16,185,129,0.1)",
                        borderRadius: 12,
                        border: "1px solid rgba(16,185,129,0.25)",
                        display: "flex", alignItems: "center", gap: 10,
                      }}>
                        <div style={{ fontSize: 22 }}>🎉</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#10b981", marginBottom: 2 }}>
                            Your Short is LIVE on YouTube!
                          </div>
                          <a
                            href={youtubeUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: 12, color: "var(--accent)",
                              textDecoration: "none", fontWeight: 600,
                              wordBreak: "break-all",
                            }}
                          >
                            {youtubeUrl}
                          </a>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <motion.a
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          href={youtubeUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            flex: 2, padding: "11px 16px", borderRadius: 12, border: "none",
                            background: "linear-gradient(135deg, #ff0000, #cc0000)",
                            color: "#fff", fontWeight: 700, cursor: "pointer",
                            fontSize: 13, textDecoration: "none",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            boxShadow: "0 4px 20px rgba(255,0,0,0.3)",
                          }}
                        >
                          ▶ Open on YouTube
                        </motion.a>
                        <motion.button
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={() => navigator.clipboard.writeText(youtubeUrl).then(() => showToast("success", "📋", "Link copied!"))}
                          style={{
                            flex: 1, padding: "11px", borderRadius: 12,
                            border: "1px solid var(--border)", background: "transparent",
                            color: "var(--text2)", fontWeight: 600, cursor: "pointer",
                            fontFamily: "inherit", fontSize: 13,
                          }}
                        >
                          📋 Copy Link
                        </motion.button>
                      </div>
                    </motion.div>
                  ) : (
                    /* ── UPLOAD BUTTON ── */
                    <motion.button
                      whileHover={uploading ? {} : { scale: 1.02, boxShadow: "0 6px 30px rgba(255,0,0,0.5)" }}
                      whileTap={uploading ? {} : { scale: 0.98 }}
                      onClick={handleUpload}
                      disabled={uploading}
                      style={{
                        width: "100%", padding: "15px", borderRadius: 14, border: "none",
                        background: uploading
                          ? "rgba(255,0,0,0.4)"
                          : "linear-gradient(135deg, #ff0000, #cc0000)",
                        color: "#fff", fontWeight: 800, cursor: uploading ? "default" : "pointer",
                        fontFamily: "inherit", fontSize: 14,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                        boxShadow: uploading ? "none" : "0 4px 24px rgba(255,0,0,0.35)",
                        transition: "all 0.2s",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {uploading ? (
                        <>
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
                            style={{ display: "inline-block", fontSize: 16 }}
                          >
                            ⏳
                          </motion.span>
                          Uploading to YouTube...
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 18 }}>▶</span>
                          {ytConnected === false ? "Connect YouTube & Upload" : "Upload to YouTube Shorts"}
                        </>
                      )}
                    </motion.button>
                  )}

                  {/* Download fallback */}
                  <motion.a
                    whileHover={{ scale: 1.01 }}
                    href={`${API}/${generatedVideo}`}
                    download
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      marginTop: 10, padding: "10px", borderRadius: 12,
                      border: "1px solid var(--border)", background: "transparent",
                      color: "var(--text3)", fontWeight: 600, fontSize: 12,
                      textDecoration: "none", transition: "color 0.2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--text3)"}
                  >
                    ⬇ Download MP4 instead
                  </motion.a>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}
