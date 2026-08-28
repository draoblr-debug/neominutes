import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { registerOAuthClient, exchangeToken, connectMcp, extractMinutes, sendMinutesEmail } from "./lib/mcp.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

// Express setup starts here
  app.use(express.json());

  app.post("/api/mcp/client-id", async (req, res) => {
    try {
      const { origin } = req.body;
      const result = await registerOAuthClient(origin);
      res.json(result);
    } catch (e: any) {
      console.error("Failed to register OAuth client:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/mcp/token
  app.post("/api/mcp/token", async (req, res) => {
    try {
      const { code, codeVerifier, clientId, redirectUri } = req.body;
      const data = await exchangeToken({ code, codeVerifier, clientId, redirectUri });
      res.json(data);
    } catch (e: any) {
      console.error("Token exchange failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/mcp/connect
  app.post("/api/mcp/connect", async (req, res) => {
    try {
      const { apiKey } = req.body;
      const result = await connectMcp(apiKey);
      res.json(result);
    } catch (error: any) {
      console.error("MCP connection error:", error);
      res.status(500).json({ error: error.message || "Failed to connect to MCP server" });
    }
  });

  // POST /api/mcp/extract-minutes
  app.post("/api/mcp/extract-minutes", async (req, res) => {
    try {
      const { resourceUri, toolName, textContent, apiKey } = req.body;
      const minutes = await extractMinutes({ resourceUri, toolName, textContent, apiKey });
      res.json(minutes);
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message || "Failed to extract minutes" });
    }
  });

  // POST /api/send-email
  app.post("/api/send-email", async (req, res) => {
    try {
      const { minutes, recipients, subject } = req.body;
      const result = await sendMinutesEmail({ minutes, recipients, subject });
      res.json(result);
    } catch (error: any) {
      console.error("Email send error:", error);
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
