const BASE = '/api/spitcast/api';

let catalogCache = null;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Forecast unavailable (${res.status})`);
  return res.json();
}

export async function getAllSpots() {
  if (catalogCache) return catalogCache;
  catalogCache = await fetchJson('/spot');
  return catalogCache;
}

export async function getSpotForecast(spotId, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/spot_forecast/${spotId}/${y}/${m}/${d}`);
}

export async function getTideForecast(countyId, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/buoy_tide/${countyId}/${y}/${m}/${d}`);
}

export async function getWindForecast(countyId, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/buoy_ndfd/${countyId}/${y}/${m}/${d}`);
}

/** Current water temp in °F from NDBC, or null if missing. */
export async function getWaterTempF(countyId, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const raw = await fetchJson(`/buoy_ndbc/${countyId}/${y}/${m}/${d}`);
  const row = Array.isArray(raw) ? raw[0] : raw;
  const celsius = Number(row?.wtmp);
  if (!Number.isFinite(celsius)) return null;
  return (celsius * 9) / 5 + 32;
}

export function indexByTimestamp(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.timestamp, row);
  return map;
}
