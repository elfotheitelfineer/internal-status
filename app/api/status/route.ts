// app/api/status/route.ts
// Live aggregation with per-vendor adapters + graceful fallbacks.
// Runtime: Node (not edge) so we can parse RSS comfortably.

export const dynamic = "force-dynamic";

type Status = "ok" | "degraded" | "outage" | "unknown";
type Service = { name: string; status: Status; note?: string; link?: string };
type Payload = { banner?: string; lastUpdatedISO?: string; services: Service[] };

// ---- Vendor config ---------------------------------------------------------

// For incident.io, set INCIDENT_IO_WIDGET_URL to your status page's Widget API URL
// (from incident.io settings). Example looks like a normal HTTPS URL returning JSON.
// For AWS Connect, set AWS_CONNECT_RSS to a comma-separated list of RSS feeds for
// the regions you care about (see examples below).

const VENDORS:
  Array<
    | { kind: "statuspage"; name: string; base: string; link?: string }
    | { kind: "slack"; name: string; api: string; link: string }
    | { kind: "incident_io"; name: string; widgetUrl?: string; link: string }
    | { kind: "rss"; name: string; feeds: string[]; link: string }
    | { kind: "static"; name: string; status: Status; note?: string; link?: string }
  > = [
    // Statuspage-powered vendors (summary.json):
    { kind: "statuspage", name: "Atlassian (Jira / Confluence)", base: "https://status.atlassian.com", link: "https://status.atlassian.com" },
    { kind: "statuspage", name: "Zoom", base: "https://status.zoom.us", link: "https://status.zoom.us" },
    { kind: "statuspage", name: "Ashby", base: "https://status.ashbyhq.com", link: "https://status.ashbyhq.com" },

    // Slack Status API v2 (official):
    { kind: "slack", name: "Slack", api: "https://slack-status.com/api/v2.0.0/current", link: "https://status.slack.com" },

    // incident.io (Widget API must be enabled; supply URL via env):
    { kind: "incident_io", name: "incident.io", widgetUrl: process.env.INCIDENT_IO_WIDGET_URL, link: "https://status.incident.io" },

    // AWS Connect auth: use AWS public RSS feeds for your region(s).
    // Example feeds you might set in AWS_CONNECT_RSS env:
    //  - https://status.aws.amazon.com/rss/connect-us-west-2.rss
    //  - https://status.aws.amazon.com/rss/connect-ca-central-1.rss
    {
      kind: "rss",
      name: "Amazon Connect auth",
      feeds: (process.env.AWS_CONNECT_RSS || "").split(",").map(s => s.trim()).filter(Boolean),
      link: "https://status.aws.amazon.com/"
    },

    // Metaview: no official public status endpoint found. Leave as unknown unless you give me one.
    { kind: "static", name: "Metaview", status: "unknown", note: "No official public status endpoint detected", link: "https://support.metaview.ai" }
  ];

// ---- Helpers ---------------------------------------------------------------

function mapStatuspage(indicator: string | null | undefined): Status {
  const i = String(indicator || "").toLowerCase();
  if (i === "none" || i === "operational") return "ok";
  if (i === "minor" || i === "maintenance") return "degraded";
  if (i === "major" || i === "critical") return "outage";
  return "unknown";
}

async function fetchJSON(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Statuspage adapter: GET <base>/api/v2/summary.json
async function pullStatuspage(name: string, base: string, link?: string): Promise<Service> {
  const data = await fetchJSON(`${base.replace(/\/$/, "")}/api/v2/summary.json`);
  if (!data) return { name, status: "unknown", note: "Source unreachable", link: link || base };
  const indicator = data?.status?.indicator ?? "unknown";
  const status = mapStatuspage(indicator);
  const note = Array.isArray(data?.incidents) && data.incidents.length
    ? data.incidents[0]?.name || data.status?.description
    : data?.status?.description || undefined;
  return { name, status, note, link: link || base };
}

// Slack adapter: https://slack-status.com/api/v2.0.0/current
async function pullSlack(name: string, api: string, link: string): Promise<Service> {
  const data = await fetchJSON(api);
  if (!data) return { name, status: "unknown", note: "Source unreachable", link };
  if (data.status === "ok") return { name, status: "ok", link };
  // If active incidents exist, escalate to degraded/outage when type === "outage"
  const incidents: any[] = Array.isArray(data.active_incidents) ? data.active_incidents : [];
  const hasOutage = incidents.some(i => String(i?.type).toLowerCase() === "outage");
  const note = incidents[0]?.title || "Active incident";
  return { name, status: hasOutage ? "outage" : "degraded", note, link };
}

// incident.io Widget API: treat any ongoing incidents/maintenance as degraded; otherwise ok.
async function pullIncidentIO(name: string, widgetUrl: string | undefined, link: string): Promise<Service> {
  if (!widgetUrl) return { name, status: "unknown", note: "Widget API URL not configured", link };
  const data = await fetchJSON(widgetUrl);
  if (!data) return { name, status: "unknown", note: "Source unreachable", link };

  // Try a few likely shapes without hard coupling to their internal schema.
  const ongoing =
    (Array.isArray(data.ongoing_incidents) && data.ongoing_incidents.length) ||
    (Array.isArray(data.incidents) && data.incidents.some((i: any) => !/resolved/i.test(String(i?.status)))) ||
    (Array.isArray(data.events) && data.events.some((e: any) => /incident|maintenance/i.test(String(e?.type)) && !/resolved|completed|cancelled/i.test(String(e?.status))));

  const firstTitle =
    (data.ongoing_incidents?.[0]?.title) ||
    (data.incidents?.find((i: any) => !/resolved/i.test(String(i?.status)))?.title) ||
    (data.events?.find((e: any) => !/resolved|completed|cancelled/i.test(String(e?.status)))?.title);

  return { name, status: ongoing ? "degraded" : "ok", note: firstTitle || undefined, link };
}

// Minimal RSS classifier for AWS feeds.
// If any feed has a recent item containing strong-problem keywords, escalate.
function classifyAwsTitle(title: string): Status {
  const t = title.toLowerCase();
  if (/(major outage|service disruption|unable to|widespread|significant|outage)/.test(t)) return "outage";
  if (/(degrad|increased error|elevated error|intermittent|issues|impact)/.test(t)) return "degraded";
  return "ok";
}
function parseRssItems(xml: string): Array<{ title: string; pubDate?: string }> {
  const items: Array<{ title: string; pubDate?: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ||
                  block.match(/<title>(.*?)<\/title>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] || "").trim();
    items.push({ title, pubDate });
  }
  return items;
}

async function pullAwsRss(name: string, feeds: string[], link: string): Promise<Service> {
  if (!feeds.length) return { name, status: "unknown", note: "No AWS RSS feeds configured", link };
  const texts = await Promise.all(feeds.map(f => fetchText(f)));
  const now = Date.now();
  const recentStatuses: Status[] = [];

  texts.filter(Boolean).forEach(txt => {
    const items = parseRssItems(txt as string).slice(0, 5);
    items.forEach(i => {
      const ageOk = i.pubDate ? (now - Date.parse(i.pubDate)) < 1000 * 60 * 60 * 12 : true; // last 12h
      if (ageOk && i.title) recentStatuses.push(classifyAwsTitle(i.title));
    });
  });

  const status: Status = recentStatuses.includes("outage") ? "outage"
                      : recentStatuses.includes("degraded") ? "degraded"
                      : "ok";
  const note = status === "ok" ? undefined : "Recent AWS post indicates issues";
  return { name, status, note, link };
}

// ---- Handler ---------------------------------------------------------------

export async function GET(req: Request) {
  const results = await Promise.all(
    VENDORS.map(async v => {
      if (v.kind === "statuspage") return pullStatuspage(v.name, v.base, v.link);
      if (v.kind === "slack") return pullSlack(v.name, v.api, v.link);
      if (v.kind === "incident_io") return pullIncidentIO(v.name, v.widgetUrl, v.link);
      if (v.kind === "rss") return pullAwsRss(v.name, v.feeds, v.link);
      if (v.kind === "static") return { name: v.name, status: v.status, note: v.note, link: v.link };
      return { name: (v as any).name || "Unknown", status: "unknown" as Status, note: "Unsupported kind" };
    })
  );

  const anyOut = results.some(s => s.status === "outage");
  const anyDegr = results.some(s => s.status === "degraded");

  const payload: Payload = {
    banner: anyOut ? "Vendor outage detected."
          : anyDegr ? "Some vendors degraded."
          : "All monitored vendors operational.",
    lastUpdatedISO: new Date().toISOString(),
    services: results
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=300"
    }
  });
}
