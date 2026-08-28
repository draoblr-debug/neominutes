import type { VercelRequest, VercelResponse } from "@vercel/node";
import { registerOAuthClient } from "../../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { origin } = req.body;
    const result = await registerOAuthClient(origin);
    res.json(result);
  } catch (e: any) {
    console.error("Failed to register OAuth client:", e);
    res.status(500).json({ error: e.message });
  }
}
