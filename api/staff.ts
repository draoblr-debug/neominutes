import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStaffDirectory } from "../lib/staff.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.json({ staff: getStaffDirectory() });
}
