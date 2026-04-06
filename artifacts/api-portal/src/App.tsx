import { useState, useEffect, useCallback } from "react";

const MODELS = [
  { id: "gpt-5.2",          provider: "openai"    },
  { id: "gpt-5-mini",       provider: "openai"    },
  { id: "gpt-5-nano",       provider: "openai"    },
  { id: "o4-mini",          provider: "openai"    },
  { id: "o3",               provider: "openai"    },
  { id: "claude-opus-4-6",  provider: "anthropic" },
  { id: "claude-sonnet-4-6",provider: "anthropic" },
  { id: "claude-haiku-4-5", provider: "anthropic" },
];

const ENDPOINTS = [
  { method: "GET",  path: "/v1/models",           type: "both",      desc: "List all available models (OpenAI + Anthropic)" },
  { method: "POST", path: "/v1/chat/completions",  type: "openai",    desc: "OpenAI-compatible chat completions. Supports gpt-* and claude-* models, tool calls, and streaming." },
  { method: "POST", path: "/v1/messages",          type: "anthropic", desc: "Anthropic Messages API format. Supports claude-* and gpt-* models with automatic conversion." },
];

const STEPS = [
  { n: 1, title: "打开 CherryStudio 设置",  desc: "启动 CherryStudio，点击左侧「设置」→「模型服务」" },
  { n: 2, title: "添加服务商",               desc: "点击「+」新建服务商，类型选 OpenAI 或 Anthropic 均可（两种格式均兼容）" },
  { n: 3, title: "填写连接信息",             desc: "API 地址填写上方 Base URL，API Key 填写你的 PROXY_API_KEY" },
  { n: 4, title: "选择模型并测试",           desc: "在模型列表中勾选所需模型，点击「检测」验证连通性，即可开始对话" },
];

interface BackendStatus {
  url:       string;
  label:     string | null;
  failures:  number;
  status:    "up" | "down";
  addedAt:   number;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    try { navigator.clipboard.writeText(text).catch(() => fallback(text)); } catch { fallback(text); }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };
  const fallback = (text: string) => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
  };
  return { copied, copy };
}

export default function App() {
  const [online,   setOnline]   = useState<boolean | null>(null);
  const [backends, setBackends] = useState<BackendStatus[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [spinning, setSpinning] = useState(false);
  const { copied, copy } = useCopy();
  const baseUrl = window.location.origin;

  useEffect(() => {
    fetch("/api/healthz").then((r) => setOnline(r.ok)).catch(() => setOnline(false));
  }, []);

  const fetchBackends = useCallback(async () => {
    setSpinning(true);
    try {
      const r = await fetch("/api/backends");
      if (r.ok) {
        const data = await r.json() as { backends: BackendStatus[] };
        setBackends(data.backends ?? []);
        setLastSync(new Date());
      }
    } catch { /* ignore */ }
    finally { setSpinning(false); }
  }, []);

  useEffect(() => {
    void fetchBackends();
    const t = setInterval(() => { void fetchBackends(); }, 30_000);
    return () => clearInterval(t);
  }, [fetchBackends]);

  const curlExample =
`curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role":"user","content":"Hello!"}]
  }'`;

  const s: Record<string, React.CSSProperties> = {
    page:          { minHeight: "100vh", backgroundColor: "hsl(222,47%,11%)", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", padding: "0 0 60px" },
    header:        { background: "linear-gradient(135deg,hsl(222,47%,14%),hsl(222,47%,16%))", borderBottom: "1px solid hsl(222,47%,20%)", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
    headerLeft:    { display: "flex", alignItems: "center", gap: 12 },
    icon:          { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
    title:         { margin: 0, fontSize: 20, fontWeight: 700, color: "#f1f5f9" },
    sub:           { margin: 0, fontSize: 13, color: "#94a3b8" },
    statusBadge:   { display: "flex", alignItems: "center", gap: 8, background: "hsl(222,47%,18%)", borderRadius: 20, padding: "6px 14px", fontSize: 13 },
    dot:           (alive: boolean | null): React.CSSProperties => ({ width: 8, height: 8, borderRadius: "50%", backgroundColor: alive === null ? "#94a3b8" : alive ? "#22c55e" : "#ef4444", boxShadow: alive ? "0 0 0 3px rgba(34,197,94,0.25)" : undefined }),
    main:          { maxWidth: 880, margin: "0 auto", padding: "32px 20px" },
    section:       { marginBottom: 32 },
    sectionTitle:  { fontSize: 14, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 },
    card:          { background: "hsl(222,47%,14%)", border: "1px solid hsl(222,47%,20%)", borderRadius: 12, padding: "18px 22px" },
    row:           { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
    label:         { fontSize: 12, color: "#64748b", marginBottom: 4 },
    value:         { fontSize: 14, color: "#e2e8f0", wordBreak: "break-all" },
    copyBtn:       (active: boolean): React.CSSProperties => ({ flexShrink: 0, background: active ? "#22c55e22" : "hsl(222,47%,20%)", border: `1px solid ${active ? "#22c55e" : "hsl(222,47%,26%)"}`, color: active ? "#22c55e" : "#94a3b8", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", transition: "all .2s" }),
    endpointCard:  { background: "hsl(222,47%,14%)", border: "1px solid hsl(222,47%,20%)", borderRadius: 12, padding: "16px 20px", marginBottom: 10 },
    endpointTop:   { display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" },
    methodBadge:   (m: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: m === "GET" ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)", color: m === "GET" ? "#22c55e" : "#a78bfa", border: `1px solid ${m === "GET" ? "rgba(34,197,94,0.3)" : "rgba(139,92,246,0.3)"}` }),
    typeBadge:     (t: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, background: t === "openai" ? "rgba(59,130,246,0.15)" : t === "anthropic" ? "rgba(249,115,22,0.15)" : "rgba(100,116,139,0.15)", color: t === "openai" ? "#60a5fa" : t === "anthropic" ? "#fb923c" : "#94a3b8", border: `1px solid ${t === "openai" ? "rgba(59,130,246,0.3)" : t === "anthropic" ? "rgba(249,115,22,0.3)" : "rgba(100,116,139,0.3)"}` }),
    endpointPath:  { fontSize: 14, color: "#e2e8f0", fontFamily: "Menlo,monospace", flex: 1, minWidth: 0, wordBreak: "break-all" },
    endpointDesc:  { fontSize: 13, color: "#64748b", marginTop: 4 },
    modelGrid:     { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 },
    modelCard:     { background: "hsl(222,47%,14%)", border: "1px solid hsl(222,47%,20%)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    modelId:       { fontSize: 13, color: "#e2e8f0", fontFamily: "Menlo,monospace" },
    stepsGrid:     { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 },
    stepCard:      { background: "hsl(222,47%,14%)", border: "1px solid hsl(222,47%,20%)", borderRadius: 12, padding: "18px" },
    stepNum:       { width: 32, height: 32, borderRadius: "50%", marginBottom: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 },
    stepTitle:     { fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 },
    stepDesc:      { fontSize: 13, color: "#64748b", lineHeight: 1.5 },
    codeBlock:     { background: "hsl(222,47%,10%)", border: "1px solid hsl(222,47%,18%)", borderRadius: 10, padding: "16px 18px", fontFamily: "Menlo,monospace", fontSize: 13, lineHeight: 1.6, overflowX: "auto", position: "relative" },
    codeText:      { color: "#e2e8f0", whiteSpace: "pre" },
    codeCopyBtn:   (active: boolean): React.CSSProperties => ({ position: "absolute", top: 12, right: 12, background: active ? "#22c55e22" : "hsl(222,47%,20%)", border: `1px solid ${active ? "#22c55e" : "hsl(222,47%,26%)"}`, color: active ? "#22c55e" : "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, transition: "all .2s" }),
    divider:       { height: 1, background: "hsl(222,47%,18%)", margin: "28px 0" },
    footer:        { textAlign: "center", fontSize: 12, color: "#475569", marginTop: 40 },
  };

  const upCount   = backends.filter((b) => b.status === "up").length;
  const downCount = backends.filter((b) => b.status === "down").length;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.icon}>🔀</div>
          <div>
            <h1 style={s.title}>AI Proxy API</h1>
            <p style={s.sub}>OpenAI + Anthropic 双兼容反代</p>
          </div>
        </div>
        <div style={s.statusBadge}>
          <div style={s.dot(online)} />
          <span style={{ color: online === null ? "#94a3b8" : online ? "#22c55e" : "#ef4444" }}>
            {online === null ? "检测中…" : online ? "服务正常" : "服务异常"}
          </span>
        </div>
      </header>

      <main style={s.main}>

        {/* Connection Details */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Connection Details</div>
          <div style={s.card}>
            <div style={{ ...s.row, marginBottom: 16 }}>
              <div>
                <div style={s.label}>Base URL</div>
                <div style={s.value}>{baseUrl}</div>
              </div>
              <button style={s.copyBtn(copied === "baseurl")} onClick={() => copy(baseUrl, "baseurl")}>
                {copied === "baseurl" ? "Copied!" : "Copy"}
              </button>
            </div>
            <div style={s.row}>
              <div>
                <div style={s.label}>Authorization Header</div>
                <div style={s.value}>Authorization: Bearer {"<YOUR_PROXY_API_KEY>"}</div>
              </div>
              <button style={s.copyBtn(copied === "authheader")} onClick={() => copy("Authorization: Bearer YOUR_PROXY_API_KEY", "authheader")}>
                {copied === "authheader" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        {/* Backend Pool */}
        <div style={s.section}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div style={{ ...s.sectionTitle, marginBottom: 0 }}>
              Backend Pool &nbsp;
              {backends.length > 0 && (
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  ({upCount} 在线{downCount > 0 ? `，${downCount} 离线` : ""} · {backends.length} 总计)
                </span>
              )}
            </div>
            <button
              style={{ ...s.copyBtn(false), display: "flex", alignItems: "center", gap: 5 }}
              onClick={() => { void fetchBackends(); }}
              disabled={spinning}
            >
              <span style={{ display: "inline-block", animation: spinning ? "spin 1s linear infinite" : "none" }}>↻</span>
              {spinning ? "刷新中…" : lastSync ? `刷新 · ${lastSync.toLocaleTimeString()}` : "刷新"}
            </button>
          </div>

          {backends.length === 0 ? (
            <div style={{ ...s.card, textAlign: "center", padding: "32px 20px", color: "#475569" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔌</div>
              <div style={{ fontSize: 14, marginBottom: 4 }}>暂无子账号接入</div>
              <div style={{ fontSize: 12 }}>子账号启动后会自动出现在这里（30 秒自动刷新）</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {backends.map((b) => (
                <div
                  key={b.url}
                  style={{
                    ...s.card,
                    borderLeft: `3px solid ${b.status === "up" ? "#22c55e" : "#ef4444"}`,
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    flexWrap: "wrap",
                  }}
                >
                  {/* Status dot */}
                  <div style={{
                    width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                    backgroundColor: b.status === "up" ? "#22c55e" : "#ef4444",
                    boxShadow: b.status === "up" ? "0 0 0 3px rgba(34,197,94,0.2)" : "0 0 0 3px rgba(239,68,68,0.2)",
                  }} />

                  {/* Label + URL */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                      {b.label ?? "未命名子账号"}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", fontFamily: "Menlo,monospace", wordBreak: "break-all" }}>
                      {b.url}
                    </div>
                  </div>

                  {/* Status badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20,
                      background: b.status === "up" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      color: b.status === "up" ? "#22c55e" : "#ef4444",
                      border: `1px solid ${b.status === "up" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                    }}>
                      {b.status === "up" ? "在线" : "离线"}
                    </span>
                    {b.failures > 0 && (
                      <span style={{ fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", padding: "3px 9px", borderRadius: 20 }}>
                        失败 {b.failures} 次
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "#475569" }}>
                      注册于 {new Date(b.addedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API Endpoints */}
        <div style={s.section}>
          <div style={s.sectionTitle}>API Endpoints</div>
          {ENDPOINTS.map((ep) => (
            <div key={ep.path} style={s.endpointCard}>
              <div style={s.endpointTop}>
                <span style={s.methodBadge(ep.method)}>{ep.method}</span>
                <span style={s.endpointPath}>{baseUrl}{ep.path}</span>
                <span style={s.typeBadge(ep.type)}>
                  {ep.type === "both" ? "OpenAI / Anthropic" : ep.type === "openai" ? "OpenAI 格式" : "Anthropic 格式"}
                </span>
                <button style={s.copyBtn(copied === ep.path)} onClick={() => copy(`${baseUrl}${ep.path}`, ep.path)}>
                  {copied === ep.path ? "Copied!" : "Copy"}
                </button>
              </div>
              <div style={s.endpointDesc}>{ep.desc}</div>
            </div>
          ))}
        </div>

        {/* Models */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Available Models</div>
          <div style={s.modelGrid}>
            {MODELS.map((m) => (
              <div key={m.id} style={s.modelCard}>
                <span style={s.modelId}>{m.id}</span>
                <span style={s.typeBadge(m.provider)}>{m.provider === "openai" ? "OpenAI" : "Anthropic"}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={s.divider} />

        {/* CherryStudio guide */}
        <div style={s.section}>
          <div style={s.sectionTitle}>CherryStudio 配置指引</div>
          <div style={s.stepsGrid}>
            {STEPS.map((st) => (
              <div key={st.n} style={s.stepCard}>
                <div style={s.stepNum}>{st.n}</div>
                <div style={s.stepTitle}>{st.title}</div>
                <div style={s.stepDesc}>{st.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Curl example */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Quick Test (curl)</div>
          <div style={s.codeBlock}>
            <span style={{ ...s.codeText, display: "block" }}>
              <span style={{ color: "#94a3b8" }}>{"# OpenAI-compatible request with Anthropic model\n"}</span>
              <span style={{ color: "#60a5fa" }}>{"curl "}</span>
              <span style={{ color: "#fbbf24" }}>{`${baseUrl}/v1/chat/completions `}</span>
              <span style={{ color: "#e2e8f0" }}>{"\\\n  "}</span>
              <span style={{ color: "#60a5fa" }}>{"-H "}</span><span style={{ color: "#34d399" }}>{'"Authorization: Bearer YOUR_PROXY_API_KEY" '}</span><span style={{ color: "#e2e8f0" }}>{"\\\n  "}</span>
              <span style={{ color: "#60a5fa" }}>{"-H "}</span><span style={{ color: "#34d399" }}>{'"Content-Type: application/json" '}</span><span style={{ color: "#e2e8f0" }}>{"\\\n  "}</span>
              <span style={{ color: "#60a5fa" }}>{"-d "}</span><span style={{ color: "#34d399" }}>{"'{\n    \"model\": \"claude-sonnet-4-6\",\n    \"messages\": [{\"role\":\"user\",\"content\":\"Hello!\"}]\n  }'"}</span>
            </span>
            <button style={s.codeCopyBtn(copied === "curl")} onClick={() => copy(curlExample, "curl")}>
              {copied === "curl" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div style={s.footer}>
          <p>Powered by Express · OpenAI SDK · Anthropic SDK · Replit AI Integrations</p>
        </div>
      </main>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
