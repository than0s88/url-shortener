"use client";

import { useState, useTransition } from "react";
import { shortenAction, type ShortenResult } from "./actions";

export function ShortenForm() {
  const [result, setResult] = useState<ShortenResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function onSubmit(formData: FormData) {
    setCopied(false);
    startTransition(async () => {
      const res = await shortenAction(formData);
      setResult(res);
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable
    }
  }

  return (
    <div className="w-full max-w-xl">
      <form action={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          name="url"
          placeholder="https://your-very-long-url.com/..."
          required
          autoFocus
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-base outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--accent)] px-5 py-3 font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {pending ? "Shortening…" : "Shorten"}
        </button>
      </form>

      {result && !result.ok && (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {result.error}
        </p>
      )}

      {result && result.ok && (
        <div className="mt-6 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">Your short URL</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a
              href={result.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-[var(--accent)] underline-offset-4 hover:underline"
            >
              {result.shortUrl}
            </a>
            <button
              type="button"
              onClick={() => copy(result.shortUrl)}
              className="ml-auto rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-3 break-all text-sm text-[var(--muted)]">→ {result.originalUrl}</p>
        </div>
      )}
    </div>
  );
}
