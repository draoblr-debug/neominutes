import type { VercelRequest, VercelResponse } from "@vercel/node";
import { extractMinutes } from "../../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { resourceUri, toolName, textContent, memoryContext, apiKey } = req.body;
    const minutes = await extractMinutes({ resourceUri, toolName, textContent, memoryContext, apiKey });
    res.json(minutes);
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: error.message || "Failed to extract minutes" });
  }
}
