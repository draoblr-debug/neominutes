import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Resend } from "resend";

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

// Best-effort cache; a serverless function's memory is not guaranteed to persist
// across invocations, so registerClient() may run again on a cold start.
const oauthClients = new Map<string, string>(); // origin -> client_id

function getMcpUrl() {
  return process.env.NEOSAPIEN_MCP_URL || "https://api.neosapien.xyz/mcp";
}

export async function registerOAuthClient(origin: string) {
  const redirectUri = `${origin}/oauth/callback`;

  if (oauthClients.has(origin)) {
    return { clientId: oauthClients.get(origin)!, redirectUri };
  }

  const { discoverAuthorizationServerMetadata, registerClient } = await import("@modelcontextprotocol/sdk/client/auth.js");
  const authServerUrl = getMcpUrl();
  const meta = await discoverAuthorizationServerMetadata(authServerUrl);
  const clientInfo = await registerClient(authServerUrl, {
    metadata: meta,
    clientMetadata: {
      client_name: "AI Studio Web App",
      redirect_uris: [redirectUri],
    },
  });

  oauthClients.set(origin, clientInfo.client_id);
  return { clientId: clientInfo.client_id, redirectUri };
}

export async function exchangeToken(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}) {
  const { code, codeVerifier, clientId, redirectUri } = params;
  const response = await fetch("https://api.neosapien.xyz/mcp/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Failed to exchange token");
  return data;
}

async function createMcpClient(apiKey?: string) {
  const mcpUrl = getMcpUrl();
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers },
  });

  const client = new Client({ name: "meeting-tracker", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

// Tool results come back as MCP content blocks (usually [{type:"text", text:"...json..."}]);
// this pulls out the first block that parses as JSON.
function parseToolResult(result: any): any {
  const blocks = (result?.content as any[]) || [];
  for (const block of blocks) {
    const raw = block?.text ?? block?.json;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        continue;
      }
    } else if (raw && typeof raw === "object") {
      return raw;
    }
  }
  return null;
}

export interface RecentConversation {
  id: string;
  title: string;
  summary: string;
  participants: string[];
  topics: string[];
  startedAt?: string;
}

// Neosapien exposes memories through MCP tools (search_memories / list_all_memories),
// not through MCP "resources" — so recent conversations have to be pulled with a tool call.
async function fetchRecentConversations(client: any, tools: any[]): Promise<RecentConversation[]> {
  const toolName = tools.find((t) => t.name === "search_memories")
    ? "search_memories"
    : tools.find((t) => t.name === "list_all_memories")
    ? "list_all_memories"
    : null;
  if (!toolName) return [];

  try {
    const result = await client.callTool({ name: toolName, arguments: { limit: 5, sort_by: "created_at", sort_order: "desc" } });
    const parsed = parseToolResult(result);
    const items: any[] = parsed?.items || parsed?.memories || (Array.isArray(parsed) ? parsed : []);
    return items.slice(0, 5).map((it) => {
      const m = it.memory || it;
      return {
        id: m._id || m.id,
        title: m.title || "Untitled conversation",
        summary: m.summary || "",
        participants: m.participants || [],
        topics: m.topics || [],
        startedAt: m.started_at || m.created_at,
      };
    });
  } catch (e) {
    console.error("Failed to fetch recent conversations:", e);
    return [];
  }
}

export async function connectMcp(apiKey?: string) {
  const client = await createMcpClient(apiKey);
  // Not every MCP server implements resources/list — don't let that fail the whole connection.
  const resources = await client.listResources().catch(() => ({ resources: [] as any[] }));
  const tools = await client.listTools();
  const conversations = await fetchRecentConversations(client, tools.tools);
  return { resources: resources.resources, tools: tools.tools, conversations };
}

export async function extractMinutes(params: {
  resourceUri?: string;
  toolName?: string;
  textContent?: string;
  memoryContext?: { title?: string; summary?: string; topics?: string[]; participants?: string[] };
  apiKey?: string;
}) {
  const { resourceUri, toolName, memoryContext, apiKey } = params;
  let rawText = params.textContent || "";

  if (!rawText && memoryContext) {
    rawText = [
      memoryContext.title ? `Title: ${memoryContext.title}` : "",
      memoryContext.participants?.length ? `Participants: ${memoryContext.participants.join(", ")}` : "",
      memoryContext.topics?.length ? `Topics: ${memoryContext.topics.join(", ")}` : "",
      memoryContext.summary ? `Summary: ${memoryContext.summary}` : "",
    ].filter(Boolean).join("\n");
  }

  if (!rawText) {
    const client = await createMcpClient(apiKey);

    if (resourceUri) {
      const resourceResult = await client.readResource({ uri: resourceUri });
      rawText = resourceResult.contents.map((c) => (c as any).text || (c as any).value || JSON.stringify(c)).join("\n");
    } else if (toolName) {
      const toolResult = await client.callTool({ name: toolName, arguments: {} });
      rawText = (toolResult.content as any[]).map((c: any) => c.text || JSON.stringify(c)).join("\n");
    } else {
      throw new Error("No resource URI, tool name, or memory context provided");
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to extract structured action items and speakers.");
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
    model: "gemini-3.6-flash",
    contents: [
      "Please analyze the following transcript/summary from Neosapien and extract the speakers, a comprehensive summary, and action items.\n\n" + rawText,
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2,
    },
  });

  const text = response.text;
  return text ? JSON.parse(text) : null;
}

export async function sendMinutesEmail(params: { minutes: any; recipients: string[]; subject?: string }) {
  const { minutes, recipients, subject } = params;

  if (!minutes || !recipients || recipients.length === 0) {
    throw new Error("Missing minutes or recipients");
  }

  const resend = getResend();

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
    from: "Meeting Tracker <onboarding@resend.dev>",
    to: recipients,
    subject: subject || "Meeting Minutes & Action Items",
    html,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true, id: data?.id };
}
