// Cloudflare Pages Function: GET /api/status
export const onRequestGet: PagesFunction = async ({ request }) => {
  const ttl = 60; // seconds
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };

  async function fromStatuspage(origin: string, name: string, link = origin) {
    const r = await fetch(`${origin.replace(/\/$/, "")}/api/v2/summary.json`);
    const j = await r.json();
    const hasIncident = (j.incidents?.length || 0) > 0;
    const anyDegraded = (j.components || []).some((c: any) => c.status !== "operational");
    const status = hasIncident || anyDegraded ? "degraded" : "ok";
    const note = hasIncident ? j.incidents[0]?.name || "Incident in progress" : "Operational";
    return { name, status, note, link };
  }

  async function fromSlack() {
    const r = await fetch("https://slack-status.com/api/v2.0.0/current");
    const j = await r.json();
    const hasIncident = (j.active_incidents?.length || 0) > 0;
    const status = j.status === "ok" && !hasIncident ? "ok" : "degraded";
    const note = hasIncident ? j.active_incidents[0]?.title || "Incident" : "Operational";
    return { name: "Slack", status, note, link: "https://slack-status.com/" };
  }

  async function fromRss(url: string, name: string, link: string) {
    const r = await fetch(url);
    const xml = await r.text();
    // extremely light parser: grab first <title>...</title>
    const title = (xml.match(/<item>[\s\S]*?<title>([^<]+)<\/title>/i)?.[1] || "").trim();
    const normal = /operating normally|service is operating normally/i.test(title);
    const status = normal || title === "" ? "ok" : /degrad|impair|issue|outage|incident/i.test(title) ? "degraded" : "unknown";
    const note = title || "No recent public events";
    return { name, status, note, link };
  }

  const sources = [
    fromStatuspage("https://status.atlassian.com", "Atlassian (Jira/Confluence)"),
    fromStatuspage("https://status.zoom.us", "Zoom"),
    fromStatuspage("https://status.ashbyhq.com", "Ashby"),
    fromSlack(),
    // incident.io runs its own status product. If it’s Statuspage, this works; if not, treat as link-only below.
    fromStatuspage("https://status.incident.io", "incident.io").catch(() =>
      ({ name: "incident.io", status: "unknown", note: "See vendor page", link: "https://status.incident.io/" })
    ),
    fromRss("https://status.aws.amazon.com/rss/connect-us-east-1.rss", "Amazon Connect (us-east-1)", "https://health.aws.amazon.com/health/status")
  ];

  const results = await Promise.allSettled(sources);
  const services = results.map(r =>
    r.status === "fulfilled" ? r.value : { name: "Unknown service", status: "unknown", note: "Fetch failed", link: "#" }
  );

  const body = JSON.stringify({
    banner: "Live vendor status (auto-refreshed).",
    lastUpdatedISO: new Date().toISOString(),
    services
  });

  return new Response(body, { headers: { ...headers, "cache-control": `max-age=${ttl}, s-maxage=${ttl}` } });
};
