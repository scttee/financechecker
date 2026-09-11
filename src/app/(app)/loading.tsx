export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <p className="text-sm text-muted">Loading your financial picture…</p>
      <div aria-hidden="true" className="grid gap-5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-card border border-line bg-card" />)}
      </div>
    </div>
  );
}
