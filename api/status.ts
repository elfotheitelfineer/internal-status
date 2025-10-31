// /api/status.ts — Vercel Serverless Function (Node 18+)
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const ttl = 60;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', `public, max-age=0, s-maxage=${ttl}`);

  async function fromStatuspage(origin: string, name: string, link = origin) {
    const r = await fetch(`${origin.replace(/\/$/, '')}/api/v2/summary.json`);
    const j = await r.json();
    const hasIncident = (j.incidents?.length ?? 0) > 0;
    const anyDegraded = Array.isArray(j.components) && j.components.some((c: any) => c.status !== 'operational');
    const status = hasIncident || anyDegraded ? 'degraded' : 'ok';
    const note = hasIncident ? j.incidents[0]?.name || 'Incident in progress' : 'Operational';
    return { name, status, note, link };
  }
  async function fromSlack() {
    const r = await fetch('https://slack-status.com/api/v2.0.0/current');
    const j = await r.json();
    const hasIncident = (j.active_incidents?.length ?? 0) > 0;
    const status = j.status === 'ok' && !hasIncident ? 'ok' : 'degraded';
    const note = hasIncident ? j.active_incidents[0]?.title || 'Incident' : 'Operational';
    return { name: 'Slack', status, note, link: 'https://slack-status.com/' };
  }
  async function fromRss(url: string, name: string, link: string) {
    const r = await fetch(url);
    const xml = await r.text();
    const title = (xml.match(/<item>[\s\S]*?<title>([^<]+)<\/title>/i)?.[1] || '').trim();
    const normal = /operating normally|service is operating normally/i.test(title);
    const status = normal || title === '' ? 'ok' : /degrad|impair|issue|outage|incident/i.test(title) ? 'degraded' : 'unknown';
    const note = title || 'No recent public events';
    return { name, status, note, link };
  }

  const tasks: Array<[string, Promise<any>, string]> = [
    ['Atlassian (Jira/Confluence)', fromStatuspage('https://status.atlassian.com', 'Atlassian (Jira/Confluence)'), 'https://status.atlassian.com/'],
    ['Zoom', fromStatuspage('https://status.zoom.us', 'Zoom'), 'https://status.zoom.us/'],
    ['Ashby', fromStatuspage('https://status.ashbyhq.com', 'Ashby'), 'https://status.ashbyhq.com/'],
    ['Bob (HiBob)', fromStatuspage('https://status.hibob.io', 'Bob (HiBob)'), 'https://status.hibob.io/'],
    ['Slack', fromSlack(), 'https://slack-status.com/'],
    ['incident.io', fromStatuspage('https://status.incident.io', 'incident.io').catch(() => ({ name: 'incident.io', status: 'unknown', note: 'See vendor page', link: 'https://status.incident.io/' })), 'https://status.incident.io/'],
    ['Amazon Connect (us-east-1)', fromRss('https://status.aws.amazon.com/rss/connect-us-east-1.rss', 'Amazon Connect (us-east-1)', 'https://health.aws.amazon.com/health/status'), 'https://health.aws.amazon.com/health/status']
  ];

  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const services = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { name: tasks[i][0], status: 'unknown', note: 'Fetch failed', link: tasks[i][2] }
  );

  res.status(200).send(JSON.stringify({
    banner: 'Live vendor status (auto-refreshed).',
    lastUpdatedISO: new Date().toISOString(),
    services
  }));
}
