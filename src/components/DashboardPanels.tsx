import { StatePanel } from "@/components/StatePanel";

/**
 * Shared dashboard state panels.
 *
 * DashboardUnavailable: the one no-leak screen for no session, inactive or
 * non-member identity, unknown workspace, or missing database — it accepts no
 * data, so nothing can leak into it.
 *
 * DashboardNotFound: the one no-leak screen for a specific entity (payout,
 * batch, claim) that does not exist or belongs to another workspace — the
 * same copy for every id, so existence never leaks.
 */

export function DashboardUnavailable() {
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

export function DashboardNotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="overflow-hidden rounded-2xl border border-border bg-[#191919]">
        <StatePanel
          badge="REQUEST NOT FOUND"
          tone="error"
          headline="This request could not be found."
          body="The request does not exist or is outside your workspace. Nothing is shown for it."
        />
      </div>
    </div>
  );
}
