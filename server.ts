import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Resend } from "resend";

// Helper to initialize Resend safely
let resendClient: Resend | null = null;
function getResend() {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY environment variable is required to send emails.");
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

// Express setup starts here
  app.use(express.json());

  // OAuth Client Registration Cache
  const oauthClients = new Map<string, string>(); // origin -> client_id

  app.post("/api/mcp/client-id", async (req, res) => {
    try {
      const { origin } = req.body;
      const redirectUri = `${origin}/oauth/callback`;
      
      if (oauthClients.has(origin)) {
        return res.json({ clientId: oauthClients.get(origin), redirectUri });
      }

      const { discoverAuthorizationServerMetadata, registerClient } = await import("@modelcontextprotocol/sdk/client/auth.js");
+      const authServerUrl = process.env.NEOSAPIEN_MCP_URL || "https://api.neosapien.xyz/mcp";
      const meta = await discoverAuthorizationServerMetadata(authServerUrl);
      const clientInfo = await registerClient(authServerUrl, {
        metadata: meta,
        clientMetadata: {
          client_name: 'AI Studio Web App',
          redirect_uris: [redirectUri]
        }
      });
      
      oauthClients.set(origin, clientInfo.client_id);
      res.json({ clientId: clientInfo.client_id, redirectUri });
    } catch (e: any) {
      console.error("Failed to register OAuth client:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/mcp/token
  app.post("/api/mcp/token", async (req, res) => {
    try {
      const { code, codeVerifier, clientId, redirectUri } = req.body;
      const response = await fetch("https://api.neosapien.xyz/mcp/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || "Failed to exchange token");
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
      const mcpUrl = process.env.NEOSAPIEN_MCP_URL || "https://api.neosapien.xyz/mcp";
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const transport = new SSEClientTransport(new URL(mcpUrl), {
        eventSourceInit: { 
          fetch: (url: string | URL, init: any) => {
            init.headers = { ...init.headers, ...headers };
            return fetch(url, init);
          }
        },
        requestInit: { headers }
      } as any);

      const client = new Client({ name: "meeting-tracker", version: "1.0.0" }, { capabilities: {} });
      
      await client.connect(transport);
      
      const resources = await client.listResources();
      const tools = await client.listTools();
      
      res.json({ resources: resources.resources, tools: tools.tools });
    } catch (error: any) {
      console.error("MCP connection error:", error);
      res.status(500).json({ error: error.message || "Failed to connect to MCP server" });
    }
  });

  // POST /api/mcp/extract-minutes
  app.post("/api/mcp/extract-minutes", async (req, res) => {
    try {
      const { resourceUri, toolName, textContent, apiKey } = req.body;
      let rawText = textContent || "";

      // If we need to fetch it from MCP
      if (!rawText) {
        const mcpUrl = process.env.NEOSAPIEN_MCP_URL || "https://api.neosapien.xyz/mcp";
        const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

        const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
        const transport = new SSEClientTransport(new URL(mcpUrl), {
          eventSourceInit: { 
            fetch: (url: string | URL, init: any) => {
              init.headers = { ...init.headers, ...headers };
              return fetch(url, init);
            }
          },
          requestInit: { headers }
        } as any);

        const client = new Client({ name: "meeting-tracker", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);

        if (resourceUri) {
          const resourceResult = await client.readResource({ uri: resourceUri });
          rawText = resourceResult.contents.map(c => (c as any).text || (c as any).value || JSON.stringify(c)).join("\n");
        } else if (toolName) {
          const toolResult = await client.callTool({ name: toolName, arguments: {} });
          rawText = toolResult.content.map(c => (c as any).text || JSON.stringify(c)).join("\n");
        } else {
          return res.status(400).json({ error: "No resource URI or tool name provided" });
        }
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is required to extract structured action items and speakers." });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      console.log("Extracting minutes from Neosapien text...");
      
      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          speakers: {
            type: Type.ARRAY,
            description: "List of distinct speaker names or generic labels (e.g., 'Speaker 1', 'Speaker 2', 'Rajeev') identified in the meeting.",
            items: { type: Type.STRING },
          },
          summary: {
            type: Type.STRING,
            description: "A concise summary of the meeting, capturing key discussions and decisions.",
          },
          actionItems: {
            type: Type.ARRAY,
            description: "List of extracted action items",
            items: {
              type: Type.OBJECT,
              properties: {
                task: { type: Type.STRING },
                assignee: { type: Type.STRING, description: "Person assigned to the task (or 'Unassigned')" },
                deadline: { type: Type.STRING, description: "Deadline if mentioned, otherwise leave empty" },
              },
              required: ["task", "assignee"],
            },
          },
        },
        required: ["speakers", "summary", "actionItems"],
      };

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          "Please analyze the following transcript/summary from Neosapien and extract the speakers, a comprehensive summary, and action items.\n\n" + rawText
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.2,
        },
      });

      const text = response.text;
      const minutes = text ? JSON.parse(text) : null;

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

      if (!minutes || !recipients || recipients.length === 0) {
        return res.status(400).json({ error: "Missing minutes or recipients" });
      }

      const resend = getResend();

      // Format Email HTML
      const actionItemsHtml = minutes.actionItems
        .map(
          (item: any) =>
            `<li><strong>${item.task}</strong> - Assigned to: ${item.assignee} ${item.deadline ? `(Due: ${item.deadline})` : ""
            }</li>`
        )
        .join("");

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #111;">Meeting Minutes</h2>
          <hr />
          <h3>Summary</h3>
          <p style="white-space: pre-wrap; line-height: 1.5;">${minutes.summary}</p>
          
          <h3>Action Items</h3>
          <ul>
            ${actionItemsHtml || "<li>No action items recorded.</li>"}
          </ul>
          <hr />
          <p style="font-size: 12px; color: #666;">Automated meeting tracker powered by AI Studio</p>
        </div>
      `;

      console.log(`Sending email to ${recipients.join(", ")}...`);
      
      const { data, error } = await resend.emails.send({
        from: "Meeting Tracker <onboarding@resend.dev>", // using Resend's testing domain by default
        to: recipients,
        subject: subject || "Meeting Minutes & Action Items",
        html: html,
      });

      if (error) {
        throw new Error(error.message);
      }

      res.json({ success: true, id: data?.id });
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
