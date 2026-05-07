import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/auth";

// Next.js 16 renamed `middleware` → `proxy`. Same shape, same matcher.
export function proxy(req: NextRequest) {
  if (!checkBasicAuth(req.headers.get("authorization"))) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
