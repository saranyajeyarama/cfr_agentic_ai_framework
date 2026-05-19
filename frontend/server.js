import express from "express";
import path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const __dirname = new URL('.', import.meta.url).pathname;

const BACKEND_URL = process.env.BACKEND_URL;

// ── API proxy ──────────────────────────────────────────────────────────────
// In local dev, Vite handles /api proxying. This proxy runs in production
// (npm start). BACKEND_URL must be set to the backend Cloud Run service URL.
if (BACKEND_URL) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: BACKEND_URL,
      changeOrigin: true,
      // Strip /api prefix: frontend calls /api/health → backend receives /health
      pathRewrite: { '^/api': '' },
      on: {
        proxyReq: async (proxyReq) => {
          // Attach a Google OIDC identity token so the private Cloud Run backend
          // accepts the request. Falls back silently in local/non-GCP environments.
          try {
            const metadataRes = await fetch(
              `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${BACKEND_URL}`,
              { headers: { 'Metadata-Flavor': 'Google' } }
            );
            if (metadataRes.ok) {
              const token = await metadataRes.text();
              proxyReq.setHeader('Authorization', `Bearer ${token}`);
            }
          } catch {
            // Not on GCP (local docker-compose) — forward without auth token
          }
        },
        error: (err, req, res) => {
          console.error('[proxy error]', err.message);
          res.status(502).json({ error: 'Backend unreachable', detail: err.message });
        },
      },
    })
  );
  console.log(`API proxy: /api/* → ${BACKEND_URL}`);
} else {
  console.warn('BACKEND_URL not set — /api routes will 404 in production');
}

// ── Static files ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dist")));

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
