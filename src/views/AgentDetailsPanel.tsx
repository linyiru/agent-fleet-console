import { Activity, Gauge, Globe2, Network, Server } from "lucide-react";
import type { Instance } from "../models/fleet.ts";
import { stateLabel, stateTone } from "../controllers/format.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { DetailRow } from "./AgentDetailRows.tsx";

export function DetailsPanel({ selected }: { selected: Instance }) {
  const running = selected.runningServices || 0;
  const serviceCount = selected.serviceCount || 0;
  const dashboardReachable = Boolean(selected.health?.dashboard);
  const lanAddress = selected.network?.lanAddress || "127.0.0.1";
  const healthPort = selected.ports?.health || "n/a";
  const statusTone = stateTone(selected);
  const dashboardUrl = selected.endpoints?.lanDashboard || selected.endpoints?.dashboard || "";

  return (
    <div className="tab-content details-panel">
      <div className="details-summary-grid">
        <Card className="details-summary-card">
          <CardHeader>
            <Gauge />
            <div>
              <CardDescription>State</CardDescription>
              <CardTitle><span className={`fleet-status-dot ${statusTone}`} aria-hidden="true" />{stateLabel(selected)}</CardTitle>
            </div>
          </CardHeader>
          <CardContent><span>{selected.nodeLabel || "Local Docker"}</span></CardContent>
        </Card>
        <Card className="details-summary-card">
          <CardHeader>
            <Activity />
            <div><CardDescription>Services</CardDescription><CardTitle>{running}/{serviceCount}</CardTitle></div>
          </CardHeader>
          <CardContent><span>{serviceCount ? `${running} running` : "No services reported"}</span></CardContent>
        </Card>
        <Card className="details-summary-card">
          <CardHeader>
            <Globe2 />
            <div>
              <CardDescription>Dashboard</CardDescription>
              <CardTitle><span className={`fleet-status-dot ${dashboardReachable ? "good" : "muted"}`} aria-hidden="true" />{dashboardReachable ? "Reachable" : "Unknown"}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {dashboardReachable && dashboardUrl ? (
              <a className="details-card-link" href={dashboardUrl} target="_blank" rel="noreferrer">{dashboardUrl.replace(/^https?:\/\//, "")}</a>
            ) : (
              <span>{dashboardReachable ? "Port not published" : "No signal"}</span>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="details-section-card">
        <CardHeader>
          <div><CardTitle>Runtime</CardTitle><CardDescription>Core network and capability details.</CardDescription></div>
        </CardHeader>
        <CardContent className="details-row-list">
          <DetailRow icon={Server} label="Display name" value={selected.displayName || selected.name} />
          <Separator />
          <DetailRow icon={Server} label="Agent id" value={selected.name} />
          <Separator />
          <DetailRow icon={Network} label="LAN address" value={`${lanAddress}:${healthPort}`} />
          <Separator />
          <DetailRow icon={Server} label="Runtime" value={selected.runtime === "nemoclaw" ? "NemoHermes" : "Docker Hermes"} />
          <Separator />
          <DetailRow icon={Globe2} label="Dashboard" value={dashboardReachable ? "Reachable" : "Unknown"} tone={dashboardReachable ? "success" : "muted"} />
          <Separator />
          <DetailRow icon={Activity} label="Browser" value={selected.dependencies?.camofox ? "Enabled" : "Not installed"} tone={selected.dependencies?.camofox ? "success" : "muted"} />
        </CardContent>
      </Card>
    </div>
  );
}
