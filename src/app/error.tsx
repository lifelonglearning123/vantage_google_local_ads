"use client";

import { useEffect } from "react";
import { Brand } from "@/components/brand";

/**
 * Shown instead of a crash when a page fails — most often a page left open
 * while the app was updated, whose buttons no longer match the server.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="solo">
      <section className="auth-card" aria-labelledby="error-title">
        <Brand />
        <div className="auth-card-head">
          <h2 id="error-title">This page didn&apos;t load</h2>
          <p>Reloading usually fixes it. If you were saving, check your settings once the page is back.</p>
        </div>
        <div className="inline-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
