/**
 * Same job as server.rb: proxy read-only Spitcast paths (no CORS in the browser).
 * Keep ALLOWED in sync with the Ruby allowlist.
 * Stream the upstream body — buffering ~250KB forecasts exceeds Workers CPU limits.
 */
const SPITCAST = 'https://api.spitcast.com';
const ALLOWED =
  /^\/api\/(spot|spot_forecast\/\d+\/\d+\/\d+\/\d+|buoy_tide\/\d+\/\d+\/\d+\/\d+|buoy_ndfd\/\d+\/\d+\/\d+\/\d+|buoy_ww3\/\d+\/\d+\/\d+\/\d+|buoy_ndbc\/\d+\/\d+\/\d+\/\d+)$/;

function withCors(headers) {
  const next = new Headers(headers);
  next.set('Access-Control-Allow-Origin', '*');
  next.set('Cache-Control', next.get('Cache-Control') || 'public, max-age=300');
  return next;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/spitcast')) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: withCors(new Headers()) });
    }

    const path = url.pathname.replace(/^\/api\/spitcast/, '') || '/';
    if (!ALLOWED.test(path)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: withCors(new Headers()) });
    }

    try {
      const upstream = await fetch(`${SPITCAST}${path}`, {
        method: 'GET',
        headers: { 'User-Agent': 'SESH-surf-guide/1.0' },
      });
      const headers = new Headers();
      headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
      headers.set('Cache-Control', 'public, max-age=300');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      return Response.json(
        { error: err.message || 'Bad gateway' },
        { status: 502, headers: withCors(new Headers()) }
      );
    }
  },
};
