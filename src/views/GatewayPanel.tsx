import { Copy, Eye, EyeOff, ExternalLink, Gauge, Globe2, KeyRound, LayoutDashboard, Monitor, RefreshCw, Server, Terminal, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../controllers/api.ts";
import { noVncUrl } from "../controllers/format.ts";
import { dashboardFallbackMessage, preferredGatewayUrl, surfaceStatusLabel } from "../controllers/gateway-diagnostics.ts";
import type { GatewayResponse, Instance } from "../models/fleet.ts";
import { Button } from "../components/ui/button.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Card, CardContent } from "../components/ui/card.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty.tsx";
import { TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { DashboardPanelHeader } from "../components/layout/FleetShell.tsx";
import { TerminalPane } from "./TerminalPane.tsx";

export function GatewayPanel({ selected, refresh }: { selected: Instance; refresh: () => void }) {
  const [tab, setTab] = useState("Dashboard");
  const [gateway, setGateway] = useState<GatewayResponse>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [frameLoading, setFrameLoading] = useState(false);
  const [showDashboardPassword, setShowDashboardPassword] = useState(false);
  const isTerminal = tab === "Terminal";
  const nodeLocal = (selected.nodeId || "local") === "local" && selected.nodeLocal !== false;
  const dashboardDiagnostic = gateway.diagnostics?.dashboard;
  const vncUrl = preferredGatewayUrl({
    nodeLocal,
    localUrl: gateway.vnc || selected.endpoints?.vnc || "",
    lanUrl: gateway.lanVnc || selected.endpoints?.lanVnc || "",
  });
  const webUrl = preferredGatewayUrl({
    nodeLocal,
    localUrl: gateway.web || selected.endpoints?.web || "",
    lanUrl: gateway.lanWeb || selected.endpoints?.lanWeb || "",
  });
  const dashboardUnavailable = Boolean(gateway.dashboardUnavailable || dashboardDiagnostic?.reachable === false);
  const localDashboardUrl = gateway.dashboard || selected.endpoints?.dashboard || "";
  const lanDashboardUrl = gateway.lanDashboard
    || selected.endpoints?.lanDashboard
    || rewriteLoopbackHost(localDashboardUrl, vncUrl || webUrl);
  const dashboardUrl = dashboardUnavailable ? "" : (
    preferredGatewayUrl({ nodeLocal, localUrl: localDashboardUrl, lanUrl: lanDashboardUrl })
  );
  const frameUrl = tab === "VNC"
    ? noVncUrl(vncUrl)
    : tab === "Web"
      ? webUrl
      : dashboardUrl;
  const Icon = isTerminal ? Terminal : tab === "VNC" ? Monitor : tab === "Web" ? Globe2 : LayoutDashboard;
  const fallbackMessage = dashboardFallbackMessage(gateway.diagnostics, Boolean(vncUrl));
  const dashboardAuth = gateway.dashboardAuth;
  const dashboardExternalOnly = tab === "Dashboard" && Boolean(dashboardUrl && dashboardAuth?.available);
  const embedUrl = dashboardExternalOnly ? "" : frameUrl;

  async function loadGateway() {
    setLoading(true);
    setError("");
    try {
      setGateway(await api<GatewayResponse>(`/api/fleet/${encodeURIComponent(selected.nodeId || "local")}/instances/${encodeURIComponent(selected.name)}/gateway`));
      refresh();
    } catch (err: any) {
      setError(err.message || "Gateway discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setShowDashboardPassword(false);
    loadGateway().catch(() => undefined);
  }, [selected.name, selected.nodeId]);
  useEffect(() => {
    if (tab === "Dashboard" && !dashboardUrl && vncUrl) setTab("VNC");
  }, [dashboardUrl, tab, vncUrl]);
  useEffect(() => { setFrameLoading(Boolean(embedUrl && !isTerminal)); }, [embedUrl, isTerminal, tab]);

  return (
    <div className="tab-content gateway-tab">
      <Card className="gateway-card">
        <DashboardPanelHeader
          title="Gateway"
          subtitle={`Dashboard, remote desktop, and shell access for ${selected.name}.`}
          actions={
            <span className={`fleet-status-cell ${isTerminal || frameUrl ? "good" : "warn"}`}>
              <span className={`fleet-status-dot ${isTerminal || frameUrl ? "good" : "warn"}`} aria-hidden="true" />
              {isTerminal ? "Shell ready" : frameUrl ? "Endpoint ready" : "Unavailable"}
            </span>
          }
        />
        <CardContent className="gateway-card-content">
          <div className="gateway-toolbar">
            <TabsList className="gateway-segmented">
              <TabsTrigger active={tab === "Dashboard"} onClick={() => setTab("Dashboard")}><LayoutDashboard />Dashboard</TabsTrigger>
              <TabsTrigger active={tab === "Web"} onClick={() => setTab("Web")}><Globe2 />Web</TabsTrigger>
              <TabsTrigger active={tab === "VNC"} onClick={() => setTab("VNC")}><Monitor />VNC</TabsTrigger>
              <TabsTrigger active={tab === "Terminal"} onClick={() => setTab("Terminal")}><Terminal />Terminal</TabsTrigger>
            </TabsList>
            <div className="gateway-actions">
              <Button disabled={loading} variant="outline" size="icon" aria-label="Refresh gateway" title="Refresh gateway" onClick={loadGateway}>{loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}</Button>
              {!isTerminal ? <Button asChild className={!frameUrl ? "disabled-link" : ""} variant="outline"><a href={frameUrl || "#"} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />Open externally</a></Button> : null}
            </div>
          </div>
          <div className="gateway-meta">
            <GatewayMeta icon={Server} label="Agent" value={selected.name} />
            <GatewayMeta icon={Gauge} label="Mode" value={tab} />
            <GatewayMeta icon={Icon} label="Status" value={isTerminal ? "Interactive shell" : surfaceStatusLabel(gateway.diagnostics, tab === "VNC" ? "vnc" : tab === "Web" ? "web" : "dashboard") || (frameUrl ? "Connected" : "Not reachable")} />
            {tab === "Web" ? <GatewayMeta icon={Globe2} label="LAN URL" value={webUrl || "Unavailable"} /> : null}
          </div>
          {error ? <Alert variant="warning"><WifiOff /><span>{error}</span></Alert> : null}
          {fallbackMessage ? <Alert variant="warning"><WifiOff /><span>{fallbackMessage}</span></Alert> : null}
          {tab === "Dashboard" ? (
            <div className="gateway-auth-strip">
              <KeyRound />
              <span>Dashboard login</span>
              <code>{dashboardAuth?.username || "fleet"}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => copyText(dashboardAuth?.username || "fleet")}>
                <Copy data-icon="inline-start" />
                User
              </Button>
              <code>{dashboardAuth?.password ? (showDashboardPassword ? dashboardAuth.password : maskPassword(dashboardAuth.password)) : dashboardAuthMessage(dashboardAuth?.reason, dashboardUnavailable)}</code>
              {dashboardAuth?.password ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => copyText(dashboardAuth.password || "")}>
                    <Copy data-icon="inline-start" />
                    Password
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowDashboardPassword((value) => !value)}>
                    {showDashboardPassword ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                    {showDashboardPassword ? "Hide" : "Show"}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {isTerminal ? (
            <TerminalPane selected={selected} />
          ) : dashboardExternalOnly ? (
            <Empty className="gateway-empty" size="large">
              <EmptyMedia variant="icon"><ExternalLink /></EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Open dashboard externally</EmptyTitle>
                <EmptyDescription>Dashboard sign-in uses browser cookies, so login opens in a separate tab.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild type="button">
                  <a href={dashboardUrl} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />Open dashboard</a>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="gateway-frame-shell">
              {embedUrl ? (
                <>
                  {frameLoading ? <div className="gateway-frame-loading"><Spinner /><span>Connecting to {tab.toLowerCase()}...</span></div> : null}
                  <iframe className="gateway-frame" title={`${selected.name} ${tab}`} src={embedUrl} onLoad={() => setFrameLoading(false)} sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts" />
                </>
              ) : (
                <Empty className="gateway-empty" size="large">
                  <EmptyMedia variant="icon"><WifiOff /></EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>{tab} is not reachable</EmptyTitle>
                    <EmptyDescription>Refresh after the agent starts, or use Terminal for local inspection.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" type="button" onClick={loadGateway}><RefreshCw data-icon="inline-start" />Try again</Button>
                  </EmptyContent>
                </Empty>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function maskPassword(value: string) {
  return value ? "•".repeat(Math.min(12, Math.max(8, value.length))) : "";
}

function dashboardAuthMessage(reason = "", dashboardUnavailable = false) {
  if (dashboardUnavailable) return "Dashboard not reachable";
  if (reason === "remote_console_needs_update") return "Update remote console to view password";
  return "Password unavailable";
}

function copyText(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value).catch(() => undefined);
}

function GatewayMeta({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  const href = externalHref(value);
  return (
    <span>
      <Icon />
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value}>
          <strong>{value}</strong>
          <ExternalLink aria-hidden="true" />
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </span>
  );
}

function rewriteLoopbackHost(url: string, hostHint: string) {
  if (!url || !hostHint) return "";
  try {
    const target = new URL(url);
    const hint = new URL(hostHint);
    if (!["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(target.hostname)) return url;
    target.hostname = hint.hostname;
    return target.toString();
  } catch {
    return "";
  }
}

function externalHref(value: string) {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}
