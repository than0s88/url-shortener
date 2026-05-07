import { NextResponse, type NextRequest } from "next/server";
import { findUrlByCode, incrementClicks } from "@/lib/urls";

// Native module (better-sqlite3) requires the Node.js runtime.
export const runtime = "nodejs";
// Do not cache — we need fresh DB lookups + click increments on every hit.
export const dynamic = "force-dynamic";

const RESERVED = new Set(["admin", "favicon.ico", "robots.txt", "sitemap.xml"]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;

  if (!code || RESERVED.has(code)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const row = findUrlByCode(code);
  if (!row) return new NextResponse("Not found", { status: 404 });

  // Fire-and-forget click increment — don't block the redirect on it.
  try {
    incrementClicks(code);
  } catch {
    // swallow — we'd rather still redirect than 500 the user
  }

  // 302 — exam spec asks for a 302 (temporary) redirect.
  return NextResponse.redirect(row.original_url, 302);
}
