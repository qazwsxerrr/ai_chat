// server.js  (Node 18+ 推荐：自带 fetch)
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));

// 托管静态页面
app.use("/", express.static(path.join(__dirname, "public")));

function normalizeBaseUrl(input) {
  let base = (input || "").trim().replace(/\/+$/, "");
  return base;
}

function buildV1Endpoint(baseUrl, pathSuffix) {
  const base = normalizeBaseUrl(baseUrl);
  // 允许用户填 https://host 或 https://host/v1
  if (base.endsWith("/v1")) return base + pathSuffix.replace(/^\/v1/, "");
  return base + "/v1" + pathSuffix.replace(/^\/v1/, "");
}

// 拉取模型：GET /api/models?baseUrl=...  Header: x-api-key
app.get("/api/models", async (req, res) => {
  const baseUrl = req.query.baseUrl;
  const apiKey = req.header("x-api-key");

  if (!baseUrl || !apiKey) {
    return res.status(400).json({ error: "Missing baseUrl or apiKey" });
  }

  const url = buildV1Endpoint(baseUrl, "/models");

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const ct = upstream.headers.get("content-type") || "";
    res.status(upstream.status);
    if (ct) res.setHeader("content-type", ct);

    const text = await upstream.text();
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 代理对话：POST /api/chat  body: { baseUrl, apiKey, payload }
app.post("/api/chat", async (req, res) => {
  const { baseUrl, apiKey, payload } = req.body || {};
  if (!baseUrl || !apiKey || !payload) {
    return res.status(400).json({ error: "Missing baseUrl/apiKey/payload" });
  }

  const url = buildV1Endpoint(baseUrl, "/chat/completions");

  const controller = new AbortController();

// 只有“真正被客户端中断”才 abort
req.on("aborted", () => controller.abort());

// 客户端在响应未结束前就断开（比如点停止/刷新）才 abort
res.on("close", () => {
  if (!res.writableEnded) controller.abort();
});


  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // 透传状态码 & content-type
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type") || "";
    if (ct) res.setHeader("content-type", ct);

    // SSE/流式：直接把上游 body pipe 给浏览器
    if (upstream.body) {
      // Node fetch 返回 web stream
      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      const text = await upstream.text();
      res.send(text);
    }
  } catch (e) {
    // 若中途被 stop/abort，可能会走到这里
    if (!res.headersSent) res.status(500);
    res.end(
      JSON.stringify({ error: String(e?.message || e) }, null, 2)
    );
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Local AI Chat running: http://localhost:${PORT}`);
});
