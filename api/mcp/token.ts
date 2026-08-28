import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeToken } from "../../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { code, codeVerifier, clientId, redirectUri } = req.body;
    const data = await exchangeToken({ code, codeVerifier, clientId, redirectUri });
    res.json(data);
  } catch (e: any) {
    console.error("Token exchange failed:", e);
    res.status(500).json({ error: e.message });
  }
}
