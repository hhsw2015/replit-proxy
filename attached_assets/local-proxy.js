#!/usr/bin/env node
/**
 * AI Proxy 本地转发脚本
 * ─────────────────────────────────────────────────────────────────
 * 将本地请求透明转发到部署在 Replit 上的 AI 反代服务（主实例）
 * 无需 npm install，纯 Node.js 内置模块
 *
 * 用法：
 *   node local-proxy.js
 *
 * CherryStudio / OpenAI 客户端配置：
 *   Base URL:  http://localhost:3000
 *   API Key:   你的 PROXY_API_KEY
 * ─────────────────────────────────────────────────────────────────
 */

const https = require("https");
const http = require("http");

// ══════════════════════════════════════════════════════════════════
// ▼ 修改这里
// ══════════════════════════════════════════════════════════════════
const REPLIT_HOST = "你的节点";
const LOCAL_PORT  = 3000;
// ══════════════════════════════════════════════════════════════════

const banner = `
╔══════════════════════════════════════════════════════════════╗
║              AI Proxy 本地转发  local-proxy.js               ║
╠══════════════════════════════════════════════════════════════╣
║  本地监听:  http://localhost:${LOCAL_PORT.toString().padEnd(32)}║
║  转发目标:  https://${REPLIT_HOST.substring(0, 41).padEnd(41)}║
╠══════════════════════════════════════════════════════════════╣
║  CherryStudio 配置:                                          ║
║    Base URL → http://localhost:${LOCAL_PORT.toString().padEnd(28)}║
║    API Key  → 填你的 PROXY_API_KEY                           ║
╚══════════════════════════════════════════════════════════════╝
`;
console.log(banner);

const server = http.createServer((req, res) => {
  const url   = req.url  || "/";
  const method = req.method || "GET";
  const ts = new Date().toISOString().substring(11, 23);

  const bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);

    // 构建转发请求头
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === "host") continue;
      fwdHeaders[k] = v;
    }
    fwdHeaders["host"] = REPLIT_HOST;
    if (body.length > 0) fwdHeaders["content-length"] = body.length;

    const options = {
      hostname: REPLIT_HOST,
      port: 443,
      path: url,
      method,
      headers: fwdHeaders,
      timeout: 120_000,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      const sc = proxyRes.statusCode || 200;
      console.log(`[${ts}] ${method} ${url}  →  ${sc}`);

      // 透传响应头
      res.writeHead(sc, proxyRes.headers);

      // 透传响应体（支持流式 SSE）
      proxyRes.on("data", (chunk) => res.write(chunk));
      proxyRes.on("end",  ()       => res.end());
      proxyRes.on("error", (err)   => { console.error("  ↳ 响应错误:", err.message); res.end(); });
    });

    proxyReq.on("error",   (err) => {
      console.error(`[${ts}] ${method} ${url}  ✗  ${err.message}`);
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "转发失败: " + err.message } }));
    });
    proxyReq.on("timeout", ()     => proxyReq.destroy(new Error("超时")));

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(LOCAL_PORT, "127.0.0.1", () => {
  console.log("✅ 本地代理已启动，按 Ctrl+C 停止\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ 端口 ${LOCAL_PORT} 已被占用，请修改脚本顶部的 LOCAL_PORT\n`);
  } else {
    console.error("服务器错误:", err.message);
  }
  process.exit(1);
});
