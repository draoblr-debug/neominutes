import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMinutesEmail } from "../lib/mcp.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { minutes, recipients, subject } = req.body;
    const result = await sendMinutesEmail({ minutes, recipients, subject });
    res.json(result);
  } catch (error: any) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
}
