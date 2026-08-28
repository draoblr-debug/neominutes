import type { VercelRequest, VercelResponse } from "@vercel/node";
import { connectMcp } from "../../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { apiKey } = req.body;
    const result = await connectMcp(apiKey);
    res.json(result);
  } catch (error: any) {
    console.error("MCP connection error:", error);
    res.status(500).json({ error: error.message || "Failed to connect to MCP server" });
  }
}
