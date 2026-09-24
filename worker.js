/**
 * Same job as server.rb: proxy read-only Spitcast paths (no CORS in the browser).
 * Also stores SESH profiles (acct:, user:, sess:) in the ALERTS KV binding.
 * Keep ALLOWED in sync with the Ruby allowlist.
 * Stream the upstream body — buffering ~250KB forecasts exceeds Workers CPU limits.
 */

const SPITCAST = 'https://api.spitcast.com';
const ALLOWED =
  /^\/api\/(spot|spot_forecast\/\d+\/\d+\/\d+\/\d+|buoy_tide\/\d+\/\d+\/\d+\/\d+|buoy_ndfd\/\d+\/\d+\/\d+\/\d+|buoy_ww3\/\d+\/\d+\/\d+\/\d+|buoy_ndbc\/\d+\/\d+\/\d+\/\d+)$/;
const MAX_FAVORITE_BEACHES = 10;

function withCors(headers) {
  const next = new Headers(headers);
  next.set('Access-Control-Allow-Origin', '*');
  next.set('Cache-Control', next.get('Cache-Control') || 'public, max-age=300');
  return next;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: withCors(new Headers()) });
}

function corsPreflight(methods) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function normalizeSpotIds(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = [];
  const seen = new Set();
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_FAVORITE_BEACHES) break;
  }
  return ids;
}

function normalizeQuiverIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((id) => /^(longboard|midlength|shortboard|fish|bodyboard)$/.test(id));
}

const SESSION_TTL = 60 * 60 * 24 * 30;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const DUMMY_SALT = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);

function authJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function authError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw authError('Enter a valid email', 400);
  }
  return email;
}

function normalizeName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001F]/g, '').trim();
  if (name.length < 1 || name.length > 40) throw authError('Name needs 1–40 characters', 400);
  return name;
}

function checkPassword(raw) {
  const password = String(raw || '');
  if (password.length < 6 || password.length > 100) {
    throw authError('Password needs at least 6 characters', 400);
  }
  return password;
}

function normalizeAvatar(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 180000 || !AVATAR_RE.test(value)) {
    throw authError('Profile photo must be a small image', 400);
  }
  return value;
}

function publicUser(record) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    avatar: record.avatar || null,
    favoriteIds: record.favoriteIds || [],
    quiverIds: record.quiverIds || [],
  };
}

async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function hashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readAuthBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function createSession(env, userId) {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const exp = Date.now() + SESSION_TTL * 1000;
  await env.ALERTS.put(`sess:${token}`, JSON.stringify({ userId, exp }), { expirationTtl: SESSION_TTL });
  return token;
}

async function userFromRequest(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = await env.ALERTS.get(`sess:${token}`, { type: 'json' });
  if (!session?.userId || !session.exp || session.exp < Date.now()) {
    if (session) await env.ALERTS.delete(`sess:${token}`);
    return null;
  }
  const record = await env.ALERTS.get(`user:${session.userId}`, { type: 'json' });
  if (!record) return null;
  return { record, token };
}

async function handleAuth(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (!env.ALERTS) return authJson({ error: 'Profiles are not configured' }, 503);

  const path = new URL(request.url).pathname.replace(/\/$/, '');
  try {
    if (path === '/api/auth/signup' && request.method === 'POST') {
      const body = await readAuthBody(request);
      const email = normalizeEmail(body.email);
      const name = normalizeName(body.name);
      const password = checkPassword(body.password);
      if (await env.ALERTS.get(`acct:${email}`)) {
        return authJson({ error: 'That email already has a profile' }, 409);
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const record = {
        id: crypto.randomUUID(),
        email,
        name,
        salt: bytesToHex(salt),
        passwordHash: await hashPassword(password, salt),
        avatar: null,
        favoriteIds: [],
        quiverIds: [],
        createdAt: new Date().toISOString(),
      };
      await env.ALERTS.put(`user:${record.id}`, JSON.stringify(record));
      await env.ALERTS.put(`acct:${email}`, record.id);
      const token = await createSession(env, record.id);
      return authJson({ token, user: publicUser(record) }, 201);
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await readAuthBody(request);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (!password || password.length > 100) {
        return authJson({ error: "Email or password doesn't match" }, 401);
      }
      const userId = await env.ALERTS.get(`acct:${email}`);
      const record = userId ? await env.ALERTS.get(`user:${userId}`, { type: 'json' }) : null;
      const salt = record?.salt ? hexToBytes(record.salt) : DUMMY_SALT;
      const hash = await hashPassword(password, salt);
      if (!record || !hashesMatch(hash, record.passwordHash || '')) {
        return authJson({ error: "Email or password doesn't match" }, 401);
      }
      const token = await createSession(env, record.id);
      return authJson({ token, user: publicUser(record) });
    }

    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = bearerToken(request);
      if (token) await env.ALERTS.delete(`sess:${token}`);
      return authJson({ ok: true });
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      const found = await userFromRequest(request, env);
      if (!found) return authJson({ error: 'Sign in again' }, 401);
      return authJson({ user: publicUser(found.record) });
    }

    if (path === '/api/auth/profile' && request.method === 'PUT') {
      const found = await userFromRequest(request, env);
      if (!found) return authJson({ error: 'Sign in again' }, 401);
      const body = await readAuthBody(request);
      const record = found.record;
      if ('name' in body) record.name = normalizeName(body.name);
      if ('avatar' in body) record.avatar = normalizeAvatar(body.avatar);
      if ('favoriteIds' in body) record.favoriteIds = normalizeSpotIds(body.favoriteIds);
      if ('quiverIds' in body) record.quiverIds = normalizeQuiverIds(body.quiverIds);
      record.updatedAt = new Date().toISOString();
      await env.ALERTS.put(`user:${record.id}`, JSON.stringify(record));
      return authJson({ user: publicUser(record) });
    }

    return authJson({ error: 'Not found' }, 404);
  } catch (err) {
    const status = err.status || 500;
    const message = err.status ? err.message : 'Could not update your profile';
    return authJson({ error: message }, status);
  }
}

async function proxySpitcast(request) {
  if (request.method === 'OPTIONS') return corsPreflight('GET, HEAD, OPTIONS');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/spitcast/, '') || '/';
  if (!ALLOWED.test(path)) return json({ error: 'Forbidden' }, 403);

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
    return json({ error: err.message || 'Bad gateway' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth')) {
      return handleAuth(request, env);
    }
    if (url.pathname.startsWith('/api/spitcast')) {
      return proxySpitcast(request);
    }
    return env.ASSETS.fetch(request);
  },
};
