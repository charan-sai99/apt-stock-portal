"use client";

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h2 className="display text-2xl">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="btn btn-dark mt-6">Try again</button>
    </div>
  );
}
