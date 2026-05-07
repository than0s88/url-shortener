"use server";

import { revalidatePath } from "next/cache";
import { createShortUrl, isValidUrl } from "@/lib/urls";

export type ShortenResult =
  | { ok: true; code: string; shortUrl: string; originalUrl: string }
  | { ok: false; error: string };

function getBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export async function shortenAction(formData: FormData): Promise<ShortenResult> {
  const raw = formData.get("url");
  const url = typeof raw === "string" ? raw.trim() : "";

  if (!url) return { ok: false, error: "Please enter a URL." };
  if (!isValidUrl(url)) {
    return { ok: false, error: "Enter a valid http(s) URL — e.g. https://example.com" };
  }

  const row = createShortUrl(url);
  revalidatePath("/admin");

  return {
    ok: true,
    code: row.code,
    shortUrl: `${getBaseUrl()}/${row.code}`,
    originalUrl: row.original_url,
  };
}
