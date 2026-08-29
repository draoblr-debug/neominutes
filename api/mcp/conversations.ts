import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchConversations } from "../../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { query, page, limit, apiKey } = req.body;
    const result = await searchConversations(apiKey, { query, page, limit });
    res.json(result);
  } catch (error: any) {
    console.error("Conversation search error:", error);
    res.status(500).json({ error: error.message || "Failed to search conversations" });
  }
}
