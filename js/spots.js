/** Default SESH beaches plus catalog helpers. */

export const DEFAULT_FAVORITE_IDS = [239, 614, 213, 214, 215];

const FAVORITES_KEY = 'sesh-favorite-spots';

/** North → south along the California coast. */
export const COUNTY_NAMES = {
  40: 'Del Norte',
  2: 'Humboldt',
  3: 'Mendocino',
  4: 'Sonoma',
  5: 'Marin',
  6: 'San Francisco',
  7: 'San Mateo',
  1: 'Santa Cruz',
  8: 'Monterey',
  9: 'San Luis Obispo',
  10: 'Santa Barbara',
  11: 'Ventura',
  12: 'Los Angeles',
  13: 'Orange County',
  14: 'San Diego',
};

export const COUNTY_ORDER = [40, 2, 3, 4, 5, 6, 7, 1, 8, 9, 10, 11, 12, 13, 14];

/** Hand-tuned names, regions, and craft rules for the original five. */
export const SPOT_OVERRIDES = {
  239: {
    name: 'San Onofre',
    shortName: 'San Onofre',
    region: 'San Clemente, CA',
    allowedBoards: ['longboard', 'fish', 'midlength'],
    idealTide: 'Mid tide',
  },
  614: {
    name: 'Trails',
    shortName: 'Trails',
    region: 'San Onofre, CA',
    allowedBoards: ['longboard', 'fish', 'midlength'],
    idealTide: 'Mid to high',
  },
  213: {
    name: 'Doheny State Beach',
    shortName: 'Doheny',
    region: 'Dana Point, CA',
    allowedBoards: ['longboard', 'midlength', 'fish'],
    idealTide: 'Mid tide',
  },
  214: {
    name: 'Strands',
    shortName: 'Strands',
    region: 'Dana Point, CA',
    allowedBoards: ['shortboard', 'bodyboard', 'fish', 'midlength'],
    idealTide: 'Mid tide',
    note: 'Forecast via nearby Salt Creek (Dana Point)',
  },
  215: {
    name: 'West Street',
    shortName: 'West Street',
    region: 'Laguna Beach, CA',
    allowedBoards: ['bodyboard'],
    idealTide: 'Medium tide',
    note: 'Forecast via nearby Brooks Street (Laguna Beach)',
  },
};

export function countyName(countyId) {
  return COUNTY_NAMES[countyId] || `County ${countyId}`;
}

export function regionFromAddress(address) {
  if (!address) return 'California';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const caIdx = parts.findIndex((p) => /^CA\b/i.test(p) || p === 'USA');
  if (caIdx >= 1) return `${parts[caIdx - 1]}, CA`;
  if (parts.length >= 2) return parts[parts.length - 2];
  return address;
}

function hasCoords(spot) {
  return Number.isFinite(spot.lng) && Number.isFinite(spot.lat);
}

function geoDist(a, b) {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLng = (a.lng - b.lng) * Math.cos(midLat);
  return Math.hypot(dLng, a.lat - b.lat);
}

function circMean(degs) {
  let x = 0;
  let y = 0;
  for (const d of degs) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassFromDeg(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function idealWindLabel(offshoreFrom) {
  const a = compassFromDeg(offshoreFrom - 35);
  const b = compassFromDeg(offshoreFrom + 35);
  return a === b ? `${a} (offshore)` : `${a} – ${b} (offshore)`;
}

function findNeighbor(sorted, i, step, minDist = 0.02) {
  const here = sorted[i];
  for (let j = i + step; j >= 0 && j < sorted.length; j += step) {
    if (hasCoords(sorted[j]) && geoDist(here, sorted[j]) > minDist) return sorted[j];
  }
  return null;
}

function rawOffshoreFrom(sorted, i) {
  const s = sorted[i];
  const prev = findNeighbor(sorted, i, -1);
  const next = findNeighbor(sorted, i, 1);
  let tx;
  let ty;
  if (prev && next) {
    tx = next.lng - prev.lng;
    ty = next.lat - prev.lat;
  } else if (next) {
    tx = next.lng - s.lng;
    ty = next.lat - s.lat;
  } else if (prev) {
    tx = s.lng - prev.lng;
    ty = s.lat - prev.lat;
  } else {
    return 90;
  }
  const left = { e: -ty, n: tx };
  const right = { e: ty, n: -tx };
  const oceanScore = (v) => -v.e * 2 - v.n;
  const ocean = oceanScore(left) >= oceanScore(right) ? left : right;
  return ((Math.atan2(-ocean.e, -ocean.n) * 180) / Math.PI + 360) % 360;
}

/** Set each spot’s offshore wind from the California coastline, not a SoCal default. */
export function applyCoastOrientation(spots) {
  const sorted = spots
    .filter(hasCoords)
    .slice()
    .sort((a, b) => String(a.coastOrder).localeCompare(String(b.coastOrder)) || a.name.localeCompare(b.name));
  const raw = sorted.map((_, i) => rawOffshoreFrom(sorted, i));
  const smoothed = raw.map((_, i) => circMean(raw.slice(Math.max(0, i - 2), i + 3)));
  const byId = new Map(sorted.map((s, i) => [s.id, smoothed[i]]));

  return spots.map((spot) => {
    const offshoreFrom = byId.has(spot.id) ? byId.get(spot.id) : 90;
    return {
      ...spot,
      offshoreFrom,
      idealWind: spot.idealWindLocked ? spot.idealWind : idealWindLabel(offshoreFrom),
    };
  });
}

export function toAppSpot(raw) {
  const id = Number(raw._id ?? raw.id);
  const override = SPOT_OVERRIDES[id] || {};
  const coords = raw.coordinates || [];
  return {
    id,
    name: override.name || raw.spot_name,
    shortName: override.shortName || raw.spot_name,
    region: override.region || regionFromAddress(raw.street_address),
    countyId: Number(raw.county_id),
    countyName: countyName(raw.county_id),
    coastOrder: raw.coast_order || '',
    lng: Number(coords[0]),
    lat: Number(coords[1]),
    offshoreFrom: 90,
    idealWindLocked: Boolean(override.idealWind),
    idealWind: override.idealWind || 'E – NE (offshore)',
    idealTide: override.idealTide || 'Mid tide',
    allowedBoards: override.allowedBoards || null,
    note: override.note ?? null,
  };
}

export function loadFavoriteIds() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [...DEFAULT_FAVORITE_IDS];
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids) || !ids.length) return [...DEFAULT_FAVORITE_IDS];
    return ids.map(Number).filter((id) => Number.isFinite(id));
  } catch {
    return [...DEFAULT_FAVORITE_IDS];
  }
}

export function saveFavoriteIds(ids) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

export function groupSpotsByCounty(spots) {
  const groups = new Map();
  for (const spot of spots) {
    const key = spot.countyId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spot);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.coastOrder).localeCompare(String(b.coastOrder)) || a.name.localeCompare(b.name));
  }
  const ordered = COUNTY_ORDER.filter((id) => groups.has(id)).map((id) => ({
    countyId: id,
    countyName: countyName(id),
    spots: groups.get(id),
  }));
  for (const [id, list] of groups) {
    if (!COUNTY_ORDER.includes(id)) {
      ordered.push({ countyId: id, countyName: countyName(id), spots: list });
    }
  }
  return ordered;
}
