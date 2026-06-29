import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

// Dark theme tokens (matches Dashboard)
const T = {
  bg:       "#0F0F14",
  surface:  "#16161E",
  surface2: "#1A1A24",
  border:   "#2A2A3A",
  text:     "#FFFFFF",
  text2:    "#CCCCDD",
  text3:    "#888899",
};

/* ── Status color / icon helpers ──────────────────────────────────────────── */
const STATUS = {
  active:     { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   glow: "0 0 8px rgba(34,197,94,0.5)",  icon: "✓", label: "Active"  },
  offline:    { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   glow: "0 0 8px rgba(239,68,68,0.4)",  icon: "✕", label: "Offline" },
  error:      { color: "#f97316", bg: "rgba(249,115,22,0.12)",  glow: "0 0 8px rgba(249,115,22,0.4)", icon: "⚠", label: "Error"   },
  no_key:     { color: "#6b7280", bg: "rgba(107,114,128,0.1)",  glow: "none",                          icon: "—", label: "No Key"  },
  quota:      { color: "#eab308", bg: "rgba(234,179,8,0.12)",   glow: "0 0 8px rgba(234,179,8,0.4)",  icon: "⚡", label: "Quota"  },
  configured: { color: "#6366f1", bg: "rgba(99,102,241,0.12)",  glow: "0 0 8px rgba(99,102,241,0.4)", icon: "⚙", label: "Set"    },
  unknown:    { color: "#6b7280", bg: "rgba(107,114,128,0.08)", glow: "none",                          icon: "?", label: "Unknown" },
};

const getStatus = (s) => STATUS[s] || STATUS.unknown;

/* ── Pulsing dot ───────────────────────────────────────────────────────────── */
const Dot = ({ status }) => {
  const s = getStatus(status);
  return (
    <motion.div
      animate={status === "active" ? { opacity: [1, 0.4, 1] } : {}}
      transition={{ repeat: Infinity, duration: 2 }}
      style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, boxShadow: s.glow, flexShrink: 0 }}
    />
  );
};

/* ── Provider row ──────────────────────────────────────────────────────────── */
const ProviderRow = ({ provider, isUsed, tierLabel }) => {
  const s = getStatus(provider.status);
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
        borderRadius: 8, marginBottom: 4,
        background: isUsed ? "rgba(99,102,241,0.1)" : s.bg,
        border: isUsed ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: s.bg, color: s.color, border: `1px solid ${s.color}40`, flexShrink: 0,
      }}>
        {provider.tier}
      </div>

      <Dot status={provider.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>
            {provider.label}
          </span>
          {isUsed && (
            <span style={{
              fontSize: 9, fontWeight: 800, color: "#6366f1",
              background: "rgba(99,102,241,0.15)", padding: "1px 6px", borderRadius: 20,
              letterSpacing: "0.04em", textTransform: "uppercase",
            }}>USED</span>
          )}
          {tierLabel && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: T.text3,
              background: T.surface2, padding: "1px 5px", borderRadius: 10,
            }}>{tierLabel}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
          {provider.usedFor}
          {provider.credits != null && (
            <span style={{ marginLeft: 6, color: s.color }}>
              {typeof provider.credits === "number"
                ? `${provider.credits.toLocaleString()}${provider.limit ? `/${provider.limit.toLocaleString()}` : ""} credits`
                : provider.credits}
            </span>
          )}
          {provider.error && (
            <span style={{ marginLeft: 6, color: "#ef4444" }}>— {provider.error.slice(0, 60)}</span>
          )}
        </div>
      </div>

      <div style={{
        fontSize: 11, fontWeight: 700, color: s.color,
        background: s.bg, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
      }}>
        {s.icon} {s.label}
      </div>
    </motion.div>
  );
};

/* ── Stage card ────────────────────────────────────────────────────────────── */
const StageCard = ({ stage, usedProviders, expanded }) => {
  const [open, setOpen] = useState(expanded);
  const lastUsed = usedProviders || {};

  const usedId = (() => {
    if (stage.stage === 1) return lastUsed.script;
    if (stage.stage === 2) return lastUsed.scenes;
    if (stage.stage === 3) return lastUsed.images?.split("+")[0];
    if (stage.stage === 4) return lastUsed.video?.split("+")[0];
    if (stage.stage === 5) return lastUsed.voice;
    return null;
  })();

  const microUp = stage.microservice?.up;
  const activeCount = stage.providers.filter(p => p.status === "active").length;
  const failedCount = stage.providers.filter(p => p.status === "error" || p.status === "offline").length;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          background: T.surface2, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 18 }}>{stage.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
              Stage {stage.stage}: {stage.name}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: microUp ? "#22c55e" : "#ef4444",
              background: microUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              padding: "1px 6px", borderRadius: 10,
              border: `1px solid ${microUp ? "#22c55e30" : "#ef444430"}`,
            }}>
              :{stage.microservice?.port} {microUp ? "UP" : "DOWN"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
            {activeCount} active · {failedCount} failed · {stage.providers.length - activeCount - failedCount} no key
          </div>
        </div>

        {usedId && (
          <div style={{
            fontSize: 10, fontWeight: 700, color: "#6366f1",
            background: "rgba(99,102,241,0.1)", padding: "3px 10px", borderRadius: 20,
            whiteSpace: "nowrap",
          }}>
            Last: {usedId}
          </div>
        )}

        <span style={{ color: T.text3, fontSize: 14, transform: open ? "rotate(180deg)" : "none", transition: "0.2s" }}>
          ▾
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden", padding: "10px 12px 12px" }}
          >
            {stage.providers.map((p, i) => (
              <ProviderRow
                key={p.id}
                provider={p}
                isUsed={!!(usedId && (usedId.includes(p.id) || p.id.includes(usedId)))}
                tierLabel={i === 0 ? "PRIMARY" : `Fallback ${i}`}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Last generation log ───────────────────────────────────────────────────── */
const LastGenerations = ({ jobs }) => {
  if (!jobs || jobs.length === 0) return (
    <div style={{ padding: "40px", textAlign: "center", color: T.text3, fontSize: 12 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
      No generation history yet. Start creating a video to see which APIs were used!
    </div>
  );

  return (
    <div>
      {jobs.map((job, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          style={{
            padding: "14px 16px", borderRadius: 12, marginBottom: 10,
            background: i === 0 ? "rgba(99,102,241,0.08)" : T.surface2,
            border: i === 0 ? "1px solid rgba(99,102,241,0.25)" : `1px solid ${T.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            {i === 0 && <span style={{ fontSize: 9, color: "#6366f1", fontWeight: 800, background: "rgba(99,102,241,0.15)", padding: "2px 8px", borderRadius: 20 }}>LATEST</span>}
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text, flex: 1 }}>
              🎬 {job.jobId}
            </span>
            <span style={{ fontSize: 10, color: T.text3 }}>
              {new Date(job.timestamp).toLocaleTimeString()}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {Object.entries(job.providers || {}).map(([stage, provider]) => {
              const failed = provider === "none" || provider === "failed";
              return (
                <div key={stage} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 8,
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: failed ? "#ef4444" : "#22c55e",
                  }} />
                  <div>
                    <div style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.04em" }}>{stage}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: failed ? "#ef4444" : "#a855f7" }}>{provider}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      ))}
    </div>
  );
};

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function ApiStatusPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("pipeline");
  const [lastChecked, setLastChecked] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const doFetch = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await axios.get(`${API}/api/ai/service-status`, { timeout: 12000 });
      if (res.data.success) {
        setData(res.data);
        setLastChecked(new Date());
        setError(null);
      }
    } catch (err) {
      setError(`Could not reach backend (${err.message || err}) — is it running on port 5000?`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    doFetch();
    const interval = setInterval(doFetch, 30000);
    return () => clearInterval(interval);
  }, [doFetch]);

  const summary  = data?.summary  || {};
  const stages   = data?.stages   || [];
  const lastJobs = data?.lastJobs || [];
  const lastUsed = lastJobs[0]?.providers || {};

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: T.text }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "20px 24px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: T.surface, position: "sticky", top: 0, zIndex: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, fontSize: 22,
            background: "linear-gradient(135deg,#6366f1,#a855f7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(99,102,241,0.35)",
          }}>🔌</div>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.text }}>API Status Monitor</h3>
            <p style={{ margin: 0, fontSize: 11, color: T.text3 }}>
              Live status · Which APIs were used last generation
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastChecked && (
            <span style={{ fontSize: 10, color: T.text3 }}>
              Updated {lastChecked.toLocaleTimeString()}
            </span>
          )}
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => doFetch(true)}
            disabled={refreshing}
            style={{
              padding: "7px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: T.surface2, border: `1px solid ${T.border}`,
              color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <motion.span
              animate={refreshing ? { rotate: 360 } : {}}
              transition={{ repeat: Infinity, duration: 0.8 }}
            >↻</motion.span>
            {refreshing ? "Checking…" : "Refresh"}
          </motion.button>
        </div>
      </div>

      {/* ── Summary pills ─────────────────────────────────────────────────── */}
      {data && (
        <div style={{
          display: "flex", gap: 10, padding: "16px 24px",
          borderBottom: `1px solid ${T.border}`, flexWrap: "wrap",
        }}>
          {[
            { label: "Total APIs", value: summary.totalApis,  color: "#6366f1" },
            { label: "Active",     value: summary.activeApis, color: "#22c55e" },
            { label: "Failed",     value: summary.failedApis, color: "#ef4444" },
            { label: "No Key",     value: summary.noKeyApis,  color: "#6b7280" },
          ].map(pill => (
            <div key={pill.label} style={{
              flex: "1 1 auto", padding: "10px 16px", borderRadius: 12, textAlign: "center",
              background: `${pill.color}12`, border: `1px solid ${pill.color}30`,
            }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: pill.color }}>{pill.value}</div>
              <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, marginTop: 2, letterSpacing: "0.04em" }}>
                {pill.label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 4, padding: "12px 24px 0",
        borderBottom: `1px solid ${T.border}`,
      }}>
        {[
          { id: "pipeline", label: "🔄 Pipeline Stages" },
          { id: "history",  label: "📋 Generation History" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px", borderRadius: "10px 10px 0 0", fontSize: 12, fontWeight: 700,
              background: tab === t.id ? T.surface : "transparent",
              border: tab === t.id ? `1px solid ${T.border}` : "1px solid transparent",
              borderBottom: tab === t.id ? `1px solid ${T.surface}` : `1px solid ${T.border}`,
              marginBottom: tab === t.id ? -1 : 0,
              color: tab === t.id ? T.text : T.text3, cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px", maxHeight: "62vh", overflowY: "auto" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: T.text3 }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              style={{ fontSize: 32, display: "inline-block" }}
            >⟳</motion.div>
            <div style={{ marginTop: 12, fontSize: 13 }}>Pinging all APIs…</div>
            <div style={{ marginTop: 4, fontSize: 11, color: T.text3 }}>Gemini, RunwayML, ElevenLabs, Pexels…</div>
          </div>
        )}

        {error && (
          <div style={{
            padding: "16px 20px", borderRadius: 12, marginTop: 8,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444", fontSize: 13,
          }}>
            ⚠ {error}
          </div>
        )}

        {!loading && !error && tab === "pipeline" && (
          <AnimatePresence>
            {stages.map((stage, i) => (
              <motion.div
                key={stage.stage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
              >
                <StageCard stage={stage} usedProviders={lastUsed} expanded={i === 0} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {!loading && !error && tab === "history" && (
          <LastGenerations jobs={lastJobs} />
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "12px 24px", borderTop: `1px solid ${T.border}`,
        fontSize: 10, color: T.text3, display: "flex", alignItems: "center", gap: 8,
        background: T.surface,
      }}>
        <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
          <Dot status="active" />
        </motion.div>
        Auto-refreshes every 30s · Fallback priority: Tier 1 → 2 → 3 → 4 (local)
      </div>
    </div>
  );
}
