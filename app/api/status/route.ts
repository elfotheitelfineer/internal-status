// Live vendor aggregation for Statuspage-powered vendors + fallback to /services.json
// Works on Vercel. Caches at the CDN for 5 minutes to avoid hammering vendors.

export const dynamic = "force-dynamic";

type Service = { name: string; status: "ok"|"degraded"|"outage"|"unknown"; note?: string; link?: string };
type Payload = { banner?: string; lastUpdatedISO?: string; services: Service[] };

const STATUSPAGE_SITES: Array<{name:string; summary:string; link:string}> = [
  // Add more as needed:
  { name: "Zoom",                        summary: "https://status.zoom.us/api/v2/summary.json",        link: "https://status.zoom.us" },
  { name: "Atlassian (Jira / Confluence)", summary: "https://atlassian.statuspage.io/api/v2/summary.json", link: "https://status.atlassian.com" }
  // Many vendors use Statuspage; their summary is usually at: https://<subdomain>.statuspage.io/api/v2/summary.json
];

function mapIndicator(indicator: string): Service["status"] {
  const i = String(indicator || "").toLowerCase();
  if (i === "none") return "ok";
  if (i === "minor") return "degraded";
  if (i === "major" || i === "critical") return "outage";
  return "unknown";
}

async function fetchStatuspage(site: {name:string; summary:string; link:string}): Promise<Service> {
  try {
    const r = await fetch(site.summary, { cache: "no-store" });
    if (!r.ok) throw new Error("statuspage not ok");
    const j = await r.json();
    // Shape: { status: { indicator: "none|min|major|critical", description: "..." }, incidents: [...] }
    const indicator = j?.status?.indicator ?? "unknown";
    const status = mapIndicator(indicator);
    const incidentTitle =
      Array.isArray(j?.incidents) && j.incidents.length ? (j.incidents[0]?.name ?? j.status?.description) : j?.status?.description;
    return { name: site.name, status, note: incidentTitle || undefined, link: site.link };
  } catch {
    return { name: site.name, status: "unknown", note: "Source unreachable", link: site.link };
  }
}

// Load your static JSON so we can fall back for vendors we don’t fetch live
async function loadStatic(base: URL): Promise<Payload | null> {
  try {
    const r = await fetch(new URL("/services.json", base).toString(), { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Payload;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // 1) Fetch live vendors in parallel
  const live = await Promise.all(STATUSPAGE_SITES.map(fetchStatuspage));

  // 2) Pull in static file (if present) to include non-Statuspage vendors
  const staticPayload = await loadStatic(url);
  const staticServices = (staticPayload?.services ?? []) as Service[];

  // De-dup: prefer live entries by name, then add anything not covered
  const liveNames = new Set(live.map(s => s.name));
  const merged: Service[] = [
    ...live,
    ...staticServices.filter(s => !liveNames.has(s.name))
  ];

  // 3) Banner: if any outage/degraded, say so; otherwise use static banner or “All green”
  const anyOut = merged.some(s => s.status === "outage");
  const anyDegr = merged.some(s => s.status === "degraded");
  const banner =
    anyOut ? "Vendor outage detected." :
    anyDegr ? "Some vendors degraded." :
    staticPayload?.banner || "All monitored vendors operational.";

  const payload: Payload = {
    banner,
    lastUpdatedISO: new Date().toISOString(),
    services: merged
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Cache 5 min at the edge; browsers can revalidate quickly
      "cache-control": "public, s-maxage=300, stale-while-revalidate=300"
    }
  });
}
