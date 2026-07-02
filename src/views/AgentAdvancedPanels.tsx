import { ExternalLink, ServerCog } from "lucide-react";
import type { Instance } from "../models/fleet.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.tsx";

function serviceState(service: any) {
  return String(service.State || service.state || "unknown").toLowerCase();
}

function serviceStatus(service: any) {
  return String(service.Status || service.status || "No status reported");
}

function serviceTone(state: string) {
  if (["running", "healthy"].includes(state)) return "good";
  if (["starting", "restarting", "created"].includes(state)) return "info";
  if (["failed", "dead", "exited", "unhealthy"].includes(state)) return "warn";
  return "muted";
}

function serviceUrl(service: any, lanAddress: string | undefined) {
  if (!lanAddress) return "";
  const publishers = Array.isArray(service.Publishers) ? service.Publishers : [];
  const match = publishers.find((p: any) => p.PublishedPort);
  if (!match) return "";
  return `http://${lanAddress}:${match.PublishedPort}`;
}

export function ServicesPanel({ selected }: { selected: Instance }) {
  const services = selected.services || [];
  const lanAddress = selected.network?.lanAddress;
  const total = selected.serviceCount || services.length || 0;
  const running = services.filter((service: any) => ["running", "healthy"].includes(serviceState(service))).length;
  const attention = services.filter((service: any) => ["failed", "dead", "exited", "unhealthy"].includes(serviceState(service))).length;
  return (
    <div >
  
      <Card className="service-inventory-card">
        <CardHeader>
          <div><CardTitle>Services</CardTitle><CardDescription>{services.length}/{total} discovered · {running} running</CardDescription></div>
          {attention ? <Badge variant="warning">{attention} need attention</Badge> : null}
        </CardHeader>
        <CardContent>
          {services.length ? (
            <Table className="services-table">
              <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>State</TableHead><TableHead>Status</TableHead><TableHead>URL</TableHead></TableRow></TableHeader>
              <TableBody>
                {services.map((service: any) => {
                  const state = serviceState(service);
                  const url = serviceUrl(service, lanAddress);
                  return (
                    <TableRow key={service.Name || service.name}>
                      <TableCell><div className="service-name-cell"><strong>{service.Service || service.name || "service"}</strong><small>{service.Name || service.name || "Docker service"}</small></div></TableCell>
                      <TableCell>
                        <span className={`fleet-status-cell ${serviceTone(state)}`}>
                          <span className={`fleet-status-dot ${serviceTone(state)}`} aria-hidden="true" />
                          {state}
                        </span>
                      </TableCell>
                      <TableCell><span className="service-status-copy">{serviceStatus(service)}</span></TableCell>
                      <TableCell>{url ? <a href={url} target="_blank" rel="noreferrer" className="service-url-link"><span>{url}</span><ExternalLink data-icon="inline-start" style={{ width: 12, height: 12, opacity: 0.5 }} /> </a> : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Empty className="service-empty" size="large">
              <EmptyMedia variant="icon"><ServerCog /></EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No services reporting</EmptyTitle>
                <EmptyDescription>Docker service discovery has not returned any services for this agent.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
