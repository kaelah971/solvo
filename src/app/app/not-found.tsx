import { DashboardNotFound } from "@/components/DashboardPanels";

/**
 * Generic not-found screen for unknown dashboard paths: the same no-leak copy
 * as a missing entity, so stray URLs never reveal anything.
 */
export default function DashboardAppNotFound() {
  return <DashboardNotFound />;
}
