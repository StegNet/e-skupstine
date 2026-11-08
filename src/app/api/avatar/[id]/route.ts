import { eq } from "drizzle-orm";
import { getUser } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/** Profile photos, for signed-in users only. The type was checked from the image bytes when it was stored. */
export async function GET(_req: Request, ctx: RouteContext<"/api/avatar/[id]">) {
  if (!(await getUser())) return new Response(null, { status: 401 }); // getUser tags the request for Sentry
  const { id } = await ctx.params;
  const row = await db.query.avatar.findFirst({ where: eq(s.avatar.userId, id) });
  if (!row) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.data), {
    // user.image carries a content hash (?v=), so a new photo gets a new URL.
    headers: { "Content-Type": row.contentType, "Cache-Control": "private, max-age=86400" },
  });
}
