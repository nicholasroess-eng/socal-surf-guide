import { COUNTY_ID } from './spots.js';

const BASE = '/api/spitcast/api';

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Forecast unavailable (${res.status})`);
  return res.json();
}

export async function getSpotForecast(spotId, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/spot_forecast/${spotId}/${y}/${m}/${d}`);
}

export async function getTideForecast(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/buoy_tide/${COUNTY_ID}/${y}/${m}/${d}`);
}

export async function getWindForecast(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return fetchJson(`/buoy_ndfd/${COUNTY_ID}/${y}/${m}/${d}`);
}

export function indexByTimestamp(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.timestamp, row);
  return map;
}
