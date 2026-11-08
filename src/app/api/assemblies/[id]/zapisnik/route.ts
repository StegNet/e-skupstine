import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { buildSigJson, loadAssembly } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "zapisnik"]);

/** The zapisnik for the committee and host at any time, and for attendees once sealed.
 * ?original=1 gives the unsigned PDF (what own_keys signs); ?format=sig gives zapisnik.sig.json. */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/assemblies/[id]/zapisnik">) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await loadAssembly(id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const row = await db.query.seal.findFirst({ where: eq(s.seal.assemblyId, id) });
  if (!row) return new Response("Not found", { status: 404 });
  if (!ctx.isManager && !ctx.isCommittee && !(row.sealedAt && ctx.attendance)) {
    logger.warn("zapisnik download refused", { assemblyId: id, sealed: !!row.sealedAt });
    return new Response("Forbidden", { status: 403 });
  }
  const format = req.nextUrl.searchParams.get("format") === "sig" ? "sig" : req.nextUrl.searchParams.get("original") === "1" ? "original" : "pdf";
  logger.info("zapisnik downloaded", { assemblyId: id, format, sealed: !!row.sealedAt, signed: !!row.signedPdf });
  const name = `zapisnik-${id.slice(0, 8)}`;
  if (req.nextUrl.searchParams.get("format") === "sig") {
    return Response.json(await buildSigJson(id), {
      headers: { "Content-Disposition": `attachment; filename="${name}.sig.json"`, "Cache-Control": "no-store" },
    });
  }
  const pdf = req.nextUrl.searchParams.get("original") === "1" ? row.pdf : (row.signedPdf ?? row.pdf);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
