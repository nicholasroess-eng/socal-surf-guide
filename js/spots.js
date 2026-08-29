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

export function toAppSpot(raw) {
  const id = Number(raw._id ?? raw.id);
  const override = SPOT_OVERRIDES[id] || {};
  return {
    id,
    name: override.name || raw.spot_name,
    shortName: override.shortName || raw.spot_name,
    region: override.region || regionFromAddress(raw.street_address),
    countyId: Number(raw.county_id),
    countyName: countyName(raw.county_id),
    coastOrder: raw.coast_order || '',
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
