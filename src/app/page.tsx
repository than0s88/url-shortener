import { ShortenForm } from "./shorten-form";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">URL Shortener</h1>
      <p className="mb-10 text-center text-[var(--muted)]">
        Paste a long URL and get a short one. Click counts on the admin page.
      </p>
      <ShortenForm />
      <footer className="mt-16 text-xs text-[var(--muted)]">
        Next.js 16 · SQLite ·{" "}
        <a href="/admin" className="underline-offset-4 hover:underline">
          admin
        </a>
      </footer>
    </main>
  );
}
