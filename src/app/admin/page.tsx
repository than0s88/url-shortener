import { listUrls } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "";
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export default function AdminPage() {
  const urls = listUrls();
  const base = getBaseUrl();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <a href="/" className="text-sm text-[var(--muted)] underline-offset-4 hover:underline">
          ← back home
        </a>
      </header>

      <p className="mb-6 text-sm text-[var(--muted)]">
        {urls.length} short URL{urls.length === 1 ? "" : "s"} ·{" "}
        {urls.reduce((sum, u) => sum + u.clicks, 0)} total clicks
      </p>

      {urls.length === 0 ? (
        <p className="rounded-md border border-[var(--border)] bg-[var(--card)] p-6 text-[var(--muted)]">
          No URLs yet. Create one on the <a href="/" className="underline">home page</a>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--card)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Original URL</th>
                <th className="px-4 py-3 text-right">Clicks</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {urls.map((u) => {
                const shortHref = base ? `${base}/${u.code}` : `/${u.code}`;
                return (
                  <tr key={u.code} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 font-mono">
                      <a
                        href={shortHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] underline-offset-4 hover:underline"
                      >
                        {u.code}
                      </a>
                    </td>
                    <td className="max-w-md px-4 py-3">
                      <a
                        href={u.original_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate hover:underline"
                        title={u.original_url}
                      >
                        {u.original_url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{u.clicks}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{formatDate(u.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
