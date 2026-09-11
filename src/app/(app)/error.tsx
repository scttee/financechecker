'use client';

import { Button, Card } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <h1 className="text-2xl font-semibold tracking-tight">We couldn’t load this page</h1>
      <p role="alert" className="mt-2 max-w-lg text-sm text-muted">There may be a temporary connection problem. Try loading the page again.</p>
      <Button onClick={reset} className="mt-5">Try again</Button>
    </Card>
  );
}
