"use client";

import { StatePanel } from "@/components/StatePanel";

/**
 * Uniform error boundary for every dashboard section.
 *
 * An uncaught error in any section (data layer included) renders the SAME
 * no-leak unavailable copy as an auth denial — never a raw Next.js error
 * screen, and never any error internals. A transient data failure can
 * therefore never present as broken authentication state, and a section can
 * never invalidate the shared session (this boundary reads nothing and
 * writes nothing).
 */
export default function DashboardError() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="overflow-hidden rounded-2xl border border-border bg-[#191919]">
        <StatePanel
          badge="WORKSPACE DASHBOARD UNAVAILABLE"
          tone="error"
          headline="Workspace dashboard unavailable."
          body="Open Telegram and type /dashboard to access your workspace dashboard."
        >
          <p className="mt-4 max-w-xl text-[12px] leading-[1.5] tracking-[0.06em] text-muted">
            The dashboard shows no operational data until a verified workspace member opens it.
          </p>
        </StatePanel>
      </div>
    </div>
  );
}
