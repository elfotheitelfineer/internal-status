export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const servicesUrl = new URL('/services.json', `${url.protocol}//${url.host}`);
  const r = await fetch(servicesUrl.toString(), { cache: 'no-store' });
  if (!r.ok) {
    return new Response(JSON.stringify({ error: 'Failed to load services.json' }), { status: 500 });
  }
  const body = await r.text();
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0'
    }
  });
}
