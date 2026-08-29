export interface StaffMember {
  name: string;
  dept: string;
  email: string;
}

// The staff directory is intentionally kept out of the (public) repo — it's
// supplied at runtime via the STAFF_DIRECTORY environment variable so names
// and work emails are never committed to git or shipped in the JS bundle
// source. Set it in Vercel's Environment Variables UI as a JSON array, e.g.
// [{"name":"Jane Doe","dept":"Engineering","email":"jane@example.com"}]
export function getStaffDirectory(): StaffMember[] {
  const raw = process.env.STAFF_DIRECTORY;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: any) => p && typeof p.name === "string" && typeof p.email === "string" && p.email
    );
  } catch (e) {
    console.error("Failed to parse STAFF_DIRECTORY env var (expected a JSON array):", e);
    return [];
  }
}
