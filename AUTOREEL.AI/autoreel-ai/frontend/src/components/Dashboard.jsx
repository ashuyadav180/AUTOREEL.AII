import React, { useState, useEffect } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import PromptToVideo from "./PromptToVideo";
import AnalyticsView from "./AnalyticsView";
import ProfileView from "./ProfileView";
import SystemHealthView from "./SystemHealthView";
import Settings from "./Settings";
import ApiStatusPanel from "./ApiStatusPanel";
import { useToast } from "../context/ToastContext";
import { useSocket } from "../hooks/useSocket";


const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";
axios.defaults.withCredentials = true;

const resolveMediaUrl = (pathValue) => {
  if (!pathValue || typeof pathValue !== "string") return null;

  const normalized = pathValue.replace(/\\/g, "/");
  if (/^https?:\/\//i.test(normalized)) return normalized;

  const storageMatch = normalized.match(/(?:^|\/)(storage\/.+)$/i);
  if (storageMatch) {
    return `${API}/${storageMatch[1]}`;
  }

  return `${API}/storage/video/${normalized.replace(/^\/+/, "")}`;
};

const UsageProgressBar = ({ percent }) => {
  const color = percent > 50 ? "#22c55e" : percent > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ height: '6px', background: '#2A2A3A', borderRadius: '3px', marginTop: '12px', overflow: 'hidden' }}>
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        style={{ height: '100%', background: color, borderRadius: '3px' }}
      />
    </div>
  );
};

/* ── Compact API quick-status widget for sidebar ─────────────────────────── */
function ApiQuickStatus({ onOpenFull }) {
  const [status, setStatus] = React.useState(null);

  React.useEffect(() => {
    const check = async () => {
      try {
        const r = await axios.get(`${API}/api/ai/health`, { timeout: 4000 });
        setStatus(r.data?.services || null);
      } catch { setStatus(null); }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  const items = status ? [
    { id: "gemini",     label: "Gemini",      s: status.gemini?.status },
    { id: "claude",     label: "Claude",       s: status.claude?.status },
    { id: "openai",     label: "ChatGPT",      s: status.openai?.status },
    { id: "runway",     label: "RunwayML",     s: status.runway?.status },
    { id: "elevenlabs", label: "ElevenLabs",   s: status.elevenlabs?.status },
    { id: "pexels",     label: "Pexels",       s: status.pexels?.status },
  ] : [];

  const col = (s) => s === "active" || s === "configured" ? "#22c55e" : s === "error" || s === "offline" ? "#ef4444" : s === "no_key" ? "#555" : "#f97316";

  return (
    <div
      onClick={onOpenFull}
      style={{
        background: "#16161E", borderRadius: 14, padding: "12px 14px", marginBottom: 16,
        border: "1px solid #2A2A3A", cursor: "pointer", transition: "border-color 0.2s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#6366f1"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#2A2A3A"}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#888", letterSpacing: "0.06em" }}>API STATUS</span>
        <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>View all →</span>
      </div>
      {!status && (
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", padding: "4px 0" }}>Checking APIs…</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map(it => (
          <div key={it.id} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: `${col(it.s)}15`, border: `1px solid ${col(it.s)}30`, color: col(it.s),
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: col(it.s) }} />
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [page, setPage] = useState('studio');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { showToast } = useToast();
  const [stats, setStats] = useState({ total: 0, completed: 0, posted: 0, failed: 0 });
  const [trends, setTrends] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [health, setHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [previewVideo, setPreviewVideo] = useState(null);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    return JSON.parse(localStorage.getItem("dismissedAlerts") || "[]");
  });

  const { connected: socketConnected, lastUpdate } = useSocket();

  // ── PromptToVideo Shared/Persistent Studio State ──
  const [studioDuration, setStudioDuration] = useState(60);
  const [studioPrompt, setStudioPrompt] = useState("");
  const [studioSuggestions, setStudioSuggestions] = useState([]);
  const [studioLoading, setStudioLoading] = useState(false);
  const [studioEnhancing, setStudioEnhancing] = useState(false);
  const [studioSuggesting, setStudioSuggesting] = useState(false);
  const [studioGenerationType, setStudioGenerationType] = useState("REEL");
  const [studioRenderMode, setStudioRenderMode] = useState("ai_video");
  const [studioLanguage, setStudioLanguage] = useState("en-US");
  const [studioVoiceGender, setStudioVoiceGender] = useState("male");
  const [studioCurrentJob, setStudioCurrentJob] = useState(null);
  const [studioGeneratedVideo, setStudioGeneratedVideo] = useState(null);
  const [studioUploading, setStudioUploading] = useState(false);
  const [studioYoutubeUrl, setStudioYoutubeUrl] = useState(null);
  const [studioUploadDone, setStudioUploadDone] = useState(false);
  const [studioYtConnected, setStudioYtConnected] = useState(null);
  const [studioEnableVoice, setStudioEnableVoice] = useState(true);
  const [studioEnableSubtitles, setStudioEnableSubtitles] = useState(true);
  const [studioScriptPreview, setStudioScriptPreview] = useState(null);
  const [studioShowPreview, setStudioShowPreview] = useState(false);

  // Apply real-time socket job patches to local state
  useEffect(() => {
    if (!lastUpdate) return;
    const { type, jobId } = lastUpdate;
    if (type === 'progress') {
      // Patch just the changed fields in the jobs array — no re-fetch needed
      setJobs(prev => prev.map(j =>
        j.id === jobId
          ? { ...j, percent: lastUpdate.percent, currentStep: lastUpdate.currentStep, status: lastUpdate.status || j.status }
          : j
      ));

      // Update studio active job progress even when user is on another tab
      if (studioCurrentJob && (jobId === studioCurrentJob.id || lastUpdate.id === studioCurrentJob.id || lastUpdate.jobId === studioCurrentJob.id)) {
        setStudioCurrentJob(prev => prev ? { ...prev, ...lastUpdate } : null);
      }
    } else if (type === 'update') {
      // Status change (COMPLETED, FAILED, CANCELLED, RUNNING) — refresh full list
      fetchJobs();
      fetchStats();

      if (studioCurrentJob && (jobId === studioCurrentJob.id || lastUpdate.id === studioCurrentJob.id || lastUpdate.jobId === studioCurrentJob.id)) {
        setStudioCurrentJob(prev => {
          if (!prev) return null;
          const updated = { ...prev, ...lastUpdate };
          if (updated.status === "COMPLETED") {
            setStudioGeneratedVideo(updated.output?.video);
            setStudioLoading(false);
          } else if (updated.status === "FAILED" || updated.status === "CANCELLED") {
            setStudioLoading(false);
          }
          return updated;
        });
      }
    }
  }, [lastUpdate, studioCurrentJob]);

  // Close preview on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setPreviewVideo(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetchStats();
    fetchTrends();
    fetchJobs();
    fetchHealth();
    
    let interval;
    if (autoSync) {
        // Slow down polling now that Socket.io handles real-time updates
        interval = setInterval(() => {
            fetchStats();
            fetchJobs();
            fetchHealth();
        }, 60000);
    }
    return () => clearInterval(interval);
  }, [autoSync]);

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API}/api/dashboard/stats`);
      if (res.data.success) setStats(res.data.stats);
    } catch (err) { console.error("Stats fetch error:", err); }
  };

  const fetchTrends = async () => {
    setLoadingTrends(true);
    try {
      const res = await axios.post(`${API}/api/ai/trends`, { niche: "Psychology & Motivation" });
      if (res.data.success) setTrends(res.data.trends);
    } catch (err) { console.error("Trends fetch error:", err); }
    finally { setLoadingTrends(false); }
  };

  const fetchJobs = async () => {
     try {
       const res = await axios.get(`${API}/api/jobs`);
       if (res.data && res.data.jobs) {
         setJobs(res.data.jobs.slice(0, 10));
       }
     } catch (err) { console.error("Jobs fetch error:", err); }
  };

  const fetchHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await axios.get(`${API}/api/ai/health`);
      if (res.data.success) {
        setHealth(res.data.services);
        checkAlerts(res.data.services);
      }
    } catch (e) {
      console.error("Health fetch failed", e);
      setHealth({});
    } finally {
      setLoadingHealth(false);
    }
  };

  const checkAlerts = (services) => {
    const thresholds = {
        elevenlabs: 10000,
        stability: 5,
        runway: 50,
        synclabs: 10
    };
    
    Object.entries(thresholds).forEach(([key, val]) => {
        if (services[key] && services[key].credits < val) {
            axios.post(`${API}/api/alerts/low-credit`, {
                service: key,
                balance: services[key].credits,
                threshold: val
            }).catch(e => {});
        }
    });
  };

  const dismissAlert = (service) => {
    const updated = [...dismissedAlerts, service];
    setDismissedAlerts(updated);
    localStorage.setItem("dismissedAlerts", JSON.stringify(updated));
  };

  const handleSetPage = (p) => {
    setPage(p);
    setIsMobileMenuOpen(false);
    if (p === 'library') fetchLibrary();
  };

  const fetchLibrary = async () => {
    try {
      const res = await axios.get(`${API}/api/dashboard/library`);
      if (res.data.success) setLibrary(res.data.library);
    } catch (err) { console.error("Library fetch error:", err); }
  };

  const formatLastSynced = (date) => {
    if (!date) return "Never";
    const sec = Math.floor((new Date() - new Date(date)) / 1000);
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  };

  const formatErrorMsg = (errStr) => {
      if (!errStr) return "Generation waiting.";
      try {
          if (errStr.includes("JSON") || errStr.startsWith("{")) return "System API error occurred. Please retry.";
          if (errStr.length > 60) return errStr.substring(0, 60) + "...";
      } catch (e) {}
      return errStr;
  };

  const activeAlerts = health ? Object.entries({
    elevenlabs: 10000,
    stability: 5,
    runway: 50,
    synclabs: 10
  }).filter(([key, val]) => health[key] && health[key].credits < val && !dismissedAlerts.includes(key)) : [];

  const handleResumeJob = async (id) => {
    try {
      const res = await axios.post(`${API}/api/jobs/${id}/retry`);
      if (res.data.success) {
        showToast('success', '▶', 'Job resumed successfully');
        fetchJobs();
      }
    } catch (err) {
      console.error("Manual resume failed:", err);
      showToast('error', '✕', 'Failed to resume job');
    }
  };

  const handleCancelJob = async (id) => {
    try {
      const res = await axios.post(`${API}/api/jobs/${id}/cancel`);
      if (res.data.success) {
        showToast('info', '⏹', 'Job cancelled successfully');
        fetchJobs();
      }
    } catch (err) {
      console.error("Manual cancel failed:", err);
      showToast('error', '✕', 'Failed to cancel job');
    }
  };

  return (
    <div className="dashboard-root" style={{ background: '#0F0F14', color: '#FFFFFF', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* TOP NAVIGATION */}
      <nav className="topbar" style={{ height: '64px', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 100, borderBottom: '1px solid #1A1A24' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div className="logo" style={{ fontSize: '20px', fontWeight: '800' }}>
            <div className="logo-mark">A</div> AutoReel<span>.AI</span>
          </div>
          
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { id: 'studio', label: 'Studio' }, 
              { id: 'analytics', label: 'Analytics' }, 
              { id: 'library', label: 'Library' }, 
              { id: 'api-status', label: '🔌 API Status' },
              { id: 'system', label: 'System' }
            ].map(tab => (

              <button 
                key={tab.id}
                onClick={() => handleSetPage(tab.id)}
                className={`tab-btn ${page === tab.id ? 'active' : ''}`}
                style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '600' }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {page === 'system' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px', background: '#16161E', borderRadius: '10px', border: '1px solid #2A2A3A' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#888' }}>AUTO-SYNC</span>
              <div 
                onClick={() => setAutoSync(!autoSync)}
                style={{ width: '36px', height: '20px', background: autoSync ? '#6366f1' : '#333', borderRadius: '10px', position: 'relative', cursor: 'pointer', transition: '0.3s' }}
              >
                <motion.div animate={{ x: autoSync ? 18 : 2 }} style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px' }} />
              </div>
            </div>
          )}

          <div className="search-box">
             <span>🔍</span>
             <input type="text" placeholder="Search..." style={{ background: 'transparent', border: 'none', outline: 'none', color: '#FFF', fontSize: '13px', width: '120px' }} />
             <kbd>⌘K</kbd>
          </div>
          
          <div className="credits-pill" style={{ background: socketConnected ? 'rgba(34,197,94,0.05)' : 'rgba(249,115,22,0.05)', border: `1px solid ${socketConnected ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.15)'}`, color: socketConnected ? '#22c55e' : '#f97316' }}>
            <div className="dot" style={{ background: socketConnected ? '#22c55e' : '#f97316', boxShadow: socketConnected ? '0 0 8px #22c55e' : '0 0 8px #f97316' }}></div>
            <span>{socketConnected ? 'Live · Connected' : 'Offline'}</span>
          </div>

          <button className="refresh-btn" style={{ background: '#16161E', borderRadius: '10px' }}>🔔</button>
          
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px' }}>A</div>
        </div>
      </nav>

      <div className="app" style={{ display: 'grid', gridTemplateColumns: (page === 'system' || page === 'profile') ? '260px 1fr' : '260px 1fr 340px', flex: 1, minHeight: 0 }}>
        
        {/* SIDEBAR */}
        <aside className="sidebar" style={{ background: '#0F0F14', borderRight: '1px solid #1A1A24', padding: '24px 16px' }}>
          <div className="sidebar-section">
            <div className="sidebar-label" style={{ marginBottom: '12px' }}>CREATE</div>
            <button className={`nav-item ${page === 'studio' ? 'active' : ''}`} onClick={() => handleSetPage('studio')}>
              <span className="nav-icon">🎬</span> Video Creator <span className="nav-badge">v2</span>
            </button>
            <button className={`nav-item ${page === 'analytics' ? 'active' : ''}`} onClick={() => handleSetPage('analytics')}>
              <span className="nav-icon">📊</span> Analytics
            </button>
            <button className={`nav-item ${page === 'library' ? 'active' : ''}`} onClick={() => handleSetPage('library')}>
              <span className="nav-icon">📚</span> My Library
            </button>
          </div>

          <div className="sidebar-section" style={{ marginTop: '32px' }}>
            <div className="sidebar-label" style={{ marginBottom: '12px' }}>ACCOUNT</div>
            <button className={`nav-item ${page === 'system' ? 'active' : ''}`} onClick={() => handleSetPage('system')}>
              <span className="nav-icon">🛡️</span> System Health
            </button>
            <button className={`nav-item ${page === 'api-status' ? 'active' : ''}`} onClick={() => handleSetPage('api-status')}>
              <span className="nav-icon">🔌</span> API Status
              <span className="nav-badge" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Live</span>
            </button>
            <button className={`nav-item ${page === 'profile' ? 'active' : ''}`} onClick={() => handleSetPage('profile')}>
              <span className="nav-icon">👤</span> Profile
            </button>
            <button className={`nav-item ${page === 'billing' ? 'active' : ''}`} onClick={() => handleSetPage('billing')}>
              <span className="nav-icon">💳</span> Billing
            </button>
          </div>

          <div style={{ marginTop: 'auto', background: '#16161E', borderRadius: '20px', padding: '20px', border: '1px solid #2A2A3A' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '700' }}>Monthly Usage</span>
              <span style={{ fontSize: '12px', color: '#6366f1', fontWeight: '700', cursor: 'pointer' }} onClick={() => handleSetPage('billing')}>Upgrade ↗</span>
            </div>
            <div style={{ height: '6px', background: '#2A2A3A', borderRadius: '3px', marginBottom: '8px' }}>
              <div style={{ width: '68%', height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7)', borderRadius: '3px' }}></div>
            </div>
            <div style={{ fontSize: '11px', color: '#888' }}>680 / 1000 reels — 68% used</div>
          </div>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main className="center" style={{ padding: '32px', overflowY: 'auto' }}>
          
          <AnimatePresence mode="wait">
            {page === 'system' && (
              <motion.div
                key="system-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                style={{ height: '100%', overflow: 'hidden' }}
              >
                <SystemHealthView jobs={jobs} onRefreshJobs={fetchJobs} />
              </motion.div>
            )}

            {page === 'api-status' && (
              <motion.div
                key="api-status-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div style={{
                  background: 'var(--surface, #16161E)', borderRadius: 20,
                  border: '1px solid var(--border, #2A2A3A)', overflow: 'hidden',
                  maxWidth: 860, margin: '0 auto',
                }}>
                  <ApiStatusPanel />
                </div>
              </motion.div>
            )}

            {(page === 'studio' || page === 'analytics' || page === 'profile' || page === 'billing' || page === 'library') && (
              <motion.div 
                key={`page-${page}`} 
                initial={{ opacity: 0, y: 5 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
                style={{ 
                    background: (page === 'analytics' || page === 'profile' || page === 'billing') ? 'var(--bg-analytics)' : 'transparent',
                    margin: (page === 'analytics' || page === 'profile' || page === 'billing') ? '-32px' : '0',
                    padding: (page === 'analytics' || page === 'profile' || page === 'billing') ? '32px' : '0',
                    minHeight: '100%',
                    position: 'relative',
                    zIndex: 1
                }}
              >
                {page === 'profile' ? (
                    <ProfileView />
                ) : page === 'billing' ? (
                    <Settings initialTab="billing" />
                ) : page === 'analytics' ? (
                    <AnalyticsView jobsStats={stats} />
                ) : page === 'library' ? (
                    <div style={{ paddingBottom: '40px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
                            <div>
                                <h1 style={{ fontSize: '32px', fontWeight: '800', fontFamily: "'Bricolage Grotesque', sans-serif", margin: 0 }}>
                                    My <span style={{ color: '#6366f1' }}>Library</span>
                                </h1>
                                <p style={{ color: '#888', fontSize: '14px', margin: '4px 0 0' }}>Your collection of {library.length} AI-generated masterpiece reels</p>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={fetchLibrary} className="refresh-btn" style={{ background: '#16161E', padding: '10px 16px', borderRadius: '12px' }}>↻ Refresh</button>
                                <button className="create-btn" onClick={() => handleSetPage('studio')}>+ New Reel</button>
                            </div>
                        </div>

                        {library.length === 0 ? (
                            <div style={{ padding: '80px 0', textAlign: 'center', background: '#0D0D12', borderRadius: '24px', border: '1px dashed #2A2A3A' }}>
                                <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎬</div>
                                <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>No videos yet</h2>
                                <p style={{ color: '#888', marginBottom: '24px' }}>Start your first creation in the AI Studio.</p>
                                <button className="create-btn" onClick={() => handleSetPage('studio')}>Go to Studio</button>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                                {library.map((vid) => (
                                    <motion.div 
                                        key={vid.id} 
                                        layout
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="vid-card"
                                        style={{ background: '#16161E', borderRadius: '18px', border: '1px solid #2A2A3A', overflow: 'hidden', cursor: 'pointer' }}
                                        onClick={() => setPreviewVideo(vid)}
                                    >
                                        <div style={{ height: '180px', position: 'relative', overflow: 'hidden' }}>
                                            {/* CATEGORY GRADIENT BACKGROUND (Always visible if video is black/loading) */}
                                            <div style={{ 
                                                position: 'absolute', inset: 0, 
                                                background: vid.category === 'motivation' ? 'linear-gradient(135deg, #6366f1, #a855f7)' :
                                                           vid.category === 'finance' ? 'linear-gradient(135deg, #10b981, #3b82f6)' :
                                                           vid.category === 'ai news' ? 'linear-gradient(135deg, #f43f5e, #fb923c)' :
                                                           vid.category === 'fitness' ? 'linear-gradient(135deg, #f59e0b, #ef4444)' :
                                                           vid.category === 'dark psych' ? 'linear-gradient(135deg, #1f2937, #111827)' :
                                                           `linear-gradient(135deg, hsl(${([...vid.topic].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360)}, 70%, 40%), hsl(${([...vid.topic].reduce((acc, char) => acc + char.charCodeAt(0), 0) * 2 % 360)}, 70%, 20%))`,
                                                opacity: 0.9
                                            }} />

                                            {resolveMediaUrl(vid.videoPath) && (
                                                <video
                                                    src={resolveMediaUrl(vid.videoPath)}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, opacity: 0.7, mixBlendMode: 'screen' }}
                                                    preload="metadata"
                                                    muted
                                                    onMouseOver={e => { e.target.play(); e.target.style.opacity = 1; e.target.style.mixBlendMode = 'normal'; }}
                                                    onMouseOut={e => { e.target.pause(); e.target.currentTime = 0; e.target.style.opacity = 0.7; e.target.style.mixBlendMode = 'screen'; }}
                                                />
                                            )}

                                            <div style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', color: '#fff', fontSize: '9px', fontWeight: '900', padding: '3px 8px', borderRadius: '20px', textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                {vid.category || 'Reel'}
                                            </div>
                                            
                                            <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', color: '#fff', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px' }}>0:45</div>
                                            
                                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(99,102,241,0)', transition: '0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="vid-overlay">
                                                <div style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, opacity: 0, transition: '0.2s', border: '1px solid rgba(255,255,255,0.1)' }} className="vid-play-btn">▶</div>
                                            </div>
                                        </div>
                                        <div style={{ padding: '16px' }}>
                                            <h3 style={{ fontSize: '15px', fontWeight: '700', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vid.topic}</h3>
                                            <div style={{ fontSize: '11px', color: '#888', marginBottom: '16px' }}>{new Date(vid.createdAt).toLocaleDateString()} • {vid.category || 'Reel'}</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setPreviewVideo(vid); }}
                                                    style={{ flex: 1, textAlign: 'center', padding: '10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                                                >
                                                    ▶ Preview
                                                </button>
                                                <a 
                                                    href={resolveMediaUrl(vid.videoPath)} 
                                                    download 
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="btn-dl" 
                                                    style={{ padding: '10px 14px', background: '#1A1A24', border: '1px solid #2A2A3A', borderRadius: '8px', color: '#888', textDecoration: 'none', fontSize: '16px', display: 'flex', alignItems: 'center' }}
                                                >
                                                    ⬇
                                                </a>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}

                        {/* VIDEO PREVIEW MODAL */}
                        <AnimatePresence>
                          {previewVideo && (
                            <motion.div
                              key="preview-modal"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              onClick={() => setPreviewVideo(null)}
                              style={{
                                position: 'fixed', inset: 0, zIndex: 9999,
                                background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '24px'
                              }}
                            >
                              <motion.div
                                initial={{ scale: 0.92, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.92, y: 20 }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  background: '#111118', borderRadius: '24px',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
                                  maxWidth: '720px', width: '100%',
                                  overflow: 'hidden'
                                }}
                              >
                                {/* Video Player */}
                                <div style={{ position: 'relative', background: '#000', maxHeight: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {previewVideo.videoPath ? (
                                    <video
                                      key={previewVideo.id}
                                      src={resolveMediaUrl(previewVideo.videoPath)}
                                      controls
                                      autoPlay
                                      style={{ width: '100%', maxHeight: '420px', objectFit: 'contain' }}
                                    />
                                  ) : (
                                    <div style={{
                                      height: '280px', width: '100%',
                                      background: `linear-gradient(135deg, hsl(${([...previewVideo.topic].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360)}, 70%, 30%), hsl(${([...previewVideo.topic].reduce((acc, c) => acc + c.charCodeAt(0), 0) * 2 % 360)}, 70%, 15%))`,
                                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12
                                    }}>
                                      <div style={{ fontSize: 48 }}>🎬</div>
                                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>No video file available</div>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => setPreviewVideo(null)}
                                    style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                  >✕</button>
                                </div>

                                {/* Metadata + Actions */}
                                <div style={{ padding: '24px' }}>
                                  <h2 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 8px', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{previewVideo.topic}</h2>
                                  <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#888', marginBottom: '20px' }}>
                                    <span>📅 {new Date(previewVideo.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                    <span>🏷️ {previewVideo.category || 'AI Reel'}</span>
                                    {previewVideo.language && <span>🌐 {previewVideo.language}</span>}
                                  </div>
                                  <div style={{ display: 'flex', gap: '12px' }}>
                                    {previewVideo.videoPath && (
                                      <a
                                        href={resolveMediaUrl(previewVideo.videoPath)}
                                        download
                                        style={{ flex: 1, textAlign: 'center', padding: '12px', background: '#6366f1', color: '#fff', textDecoration: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: '700' }}
                                      >
                                        ⬇ Download Video
                                      </a>
                                    )}
                                    <button
                                      onClick={() => setPreviewVideo(null)}
                                      style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#888', borderRadius: '12px', fontSize: '13px', cursor: 'pointer' }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>
                              </motion.div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                    </div>
                ) : (
                    <>
                        {/* STUDIO UI (Previously built) */}
                        <div style={{ marginBottom: '32px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <h1 style={{ fontSize: '32px', fontWeight: '800', fontFamily: "'Bricolage Grotesque', sans-serif", margin: 0 }}>
                              Video <span style={{ color: '#6366f1' }}>Studio</span>
                            </h1>
                            <button className="upgrade-btn" style={{ background: '#6366f1', boxShadow: '0 4px 15px rgba(99,102,241,0.3)' }} onClick={() => handleSetPage('studio')}>✦ Generate Reel</button>
                          </div>
                          <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>Generate short-form reels with AI — powered by AutoReel Engine v2</p>
                        </div>
        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
                          {[
                            { label: 'TOTAL JOBS', val: stats.total, change: '↑ 12 today', type: 'total' },
                            { label: 'COMPLETED', val: stats.completed, change: `99.4% success rate`, type: 'completed' },
                            { label: 'AUTO-POSTED', val: stats.posted, change: 'YouTube & TikTok', type: 'posted' },
                            { label: 'FAILED', val: stats.failed, change: 'Needs retry', type: 'failed' }
                          ].map(s => (
                            <div key={s.label} className={`stat-card ${s.type}`} style={{ padding: '24px', borderRadius: '20px', border: '1px solid #2A2A3A', background: '#16161E' }}>
                              <div style={{ fontSize: '11px', fontWeight: '800', color: '#888', marginBottom: '12px', letterSpacing: '0.05em' }}>{s.label}</div>
                              <div className={`stat-val ${s.type}`} style={{ fontSize: '36px', fontWeight: '800', fontFamily: "'Bricolage Grotesque', sans-serif" }}>{s.val}</div>
                              <div style={{ fontSize: '12px', marginTop: '8px', color: s.type === 'failed' ? '#ef4444' : '#888' }}>{s.change}</div>
                            </div>
                          ))}
                        </div>
        
                        <PromptToVideo
                          duration={studioDuration} setDuration={setStudioDuration}
                          prompt={studioPrompt} setPrompt={setStudioPrompt}
                          suggestions={studioSuggestions} setSuggestions={setStudioSuggestions}
                          loading={studioLoading} setLoading={setStudioLoading}
                          enhancing={studioEnhancing} setEnhancing={setStudioEnhancing}
                          suggesting={studioSuggesting} setSuggesting={setStudioSuggesting}
                          generationType={studioGenerationType} setGenerationType={setStudioGenerationType}
                          renderMode={studioRenderMode} setRenderMode={setStudioRenderMode}
                          language={studioLanguage} setLanguage={setStudioLanguage}
                          voiceGender={studioVoiceGender} setVoiceGender={setStudioVoiceGender}
                          currentJob={studioCurrentJob} setCurrentJob={setStudioCurrentJob}
                          generatedVideo={studioGeneratedVideo} setGeneratedVideo={setStudioGeneratedVideo}
                          uploading={studioUploading} setUploading={setStudioUploading}
                          youtubeUrl={studioYoutubeUrl} setYoutubeUrl={setStudioYoutubeUrl}
                          uploadDone={studioUploadDone} setUploadDone={setStudioUploadDone}
                          ytConnected={studioYtConnected} setYtConnected={setStudioYtConnected}
                          enableVoice={studioEnableVoice} setEnableVoice={setStudioEnableVoice}
                          enableSubtitles={studioEnableSubtitles} setEnableSubtitles={setStudioEnableSubtitles}
                          scriptPreview={studioScriptPreview} setScriptPreview={setStudioScriptPreview}
                          showPreview={studioShowPreview} setShowPreview={setStudioShowPreview}
                        />
                    </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {page !== 'system' && page !== 'profile' && page !== 'api-status' && (
          <aside className="jobs-panel" style={{ background: '#0F0F14', borderLeft: '1px solid #1A1A24', padding: '24px 16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
               <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>Jobs <span style={{ color: '#888', fontSize: '14px', fontWeight: '500' }}>{jobs.length}</span></h2>
               <button className="refresh-btn" onClick={fetchJobs} style={{ background: '#16161E' }}>↻</button>
            </div>

            {/* Compact API Quick-Status */}
            <ApiQuickStatus onOpenFull={() => handleSetPage('api-status')} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
              {jobs.map(j => {
                  const downloadUrl = resolveMediaUrl(j.output?.videoRel || j.output?.video || j.video_path || (j.steps && j.steps.video));
                  return (
                  <div key={j.id} className={`job-item ${j.status === 'FAILED' || j.status === 'CANCELLED' ? 'failed' : j.status === 'COMPLETED' ? 'completed' : (j.status === 'PAUSED' || j.status === 'PENDING') ? 'paused' : 'processing'}`} style={{ padding: '16px', borderRadius: '16px', border: '1px solid #2A2A3A', background: '#16161E' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <div style={{ fontSize: '13px', fontWeight: '700', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.topic || j.prompt || "AI Generating..."}</div>
                          <span className={`job-chip ${j.status === 'FAILED' || j.status === 'CANCELLED' ? 'failed' : j.status === 'COMPLETED' ? 'completed' : (j.status === 'PAUSED' || j.status === 'PENDING') ? 'paused' : 'active'}`}>
                              {j.status === 'FAILED' ? '✕ Failed' : j.status === 'CANCELLED' ? '⏹ Canceled' : j.status === 'COMPLETED' ? '✓ Done' : (j.status === 'PAUSED' || j.status === 'PENDING') ? '⏸ Paused' : '🔄 Active'}
                          </span>
                      </div>
                      
                      {(j.status === 'FAILED' || j.status === 'PAUSED' || j.status === 'PENDING' || j.status === 'CANCELLED') && (
                          <div style={{ background: ((j.status === 'FAILED' || j.status === 'CANCELLED') ? 'rgba(239,68,68,0.05)' : 'rgba(99,102,241,0.05)'), padding: '12px', borderRadius: '12px', border: `1px solid ${(j.status === 'FAILED' || j.status === 'CANCELLED') ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)'}`, color: (j.status === 'FAILED' || j.status === 'CANCELLED') ? '#ef4444' : '#6366f1', fontSize: '11px', marginBottom: '12px', lineHeight: 1.4 }}>
                              {j.status === 'CANCELLED' ? 'Job was cancelled manually.' : formatErrorMsg(j.lastError || j.error || "Currently waiting or paused")}
                          </div>
                      )}

                      <div style={{ display: 'flex', gap: '8px' }}>
                          {j.status === 'COMPLETED' && downloadUrl && (
                              <a href={downloadUrl} download className="btn-dl" style={{ color: '#22c55e', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', padding: '6px 12px', fontSize: '11px', textDecoration: 'none', borderRadius: '8px' }}>⬇ Download</a>
                          )}
                          {(j.status === 'FAILED' || j.status === 'PAUSED' || j.status === 'CANCELLED') && (
                              <button onClick={() => handleResumeJob(j.id)} className="btn-resume" style={{ color: '#6366f1', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', padding: '6px 12px', fontSize: '11px', borderRadius: '8px', cursor: 'pointer' }}>▶ Resume</button>
                          )}
                          {(j.status === 'RUNNING' || j.status === 'PENDING' || j.status === 'FAILED' || j.status === 'PAUSED') && (
                              <button onClick={() => handleCancelJob(j.id)} className="btn-cancel" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '6px 12px', fontSize: '11px', borderRadius: '8px', cursor: 'pointer' }}>⏹ Cancel</button>
                          )}
                          <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#555', alignSelf: 'center' }}>{new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

                      </div>
                  </div>
                  );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
