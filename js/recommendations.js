import { recommendFromQuiver } from './quiver.js';

/** Activity recommendation from wave height, quiver, and break. */
export function recommendActivity(waveFt, quiverIds = null, allowedIds = null) {
  return recommendFromQuiver(waveFt, quiverIds, allowedIds);
}

export function shapeLabel(shape) {
  if (shape >= 1.5) return 'Good';
  if (shape >= 1.0) return 'Fair';
  if (shape >= 0.5) return 'Poor–Fair';
  return 'Poor';
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Wind quality relative to this break’s offshore direction (degrees FROM). */
export function windLabel(degrees, speedMph, offshoreFrom = 90) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((degrees % 360) / 45)) % 8;
  const compass = dirs[idx];
  const diff = angleDiff(degrees, offshoreFrom);
  const offshore = diff <= 60;
  const onshore = diff >= 120;
  let quality = 'Cross-shore';
  if (offshore && speedMph <= 10) quality = 'Offshore';
  else if (offshore && speedMph > 10) quality = 'Offshore, strong';
  else if (onshore || speedMph > 15) quality = 'Onshore';

  return { compass, quality, offshore, onshore, speedMph: Math.round(speedMph) };
}

/** What to wear from water temp in °F. */
export function wearFromWaterTemp(tempF) {
  if (tempF == null || !Number.isFinite(tempF)) return null;
  const t = Math.round(tempF);
  if (t >= 80) return { label: 'Trunks', range: '80°F+' };
  if (t >= 71) return { label: '1mm top', range: '71–79°F' };
  if (t >= 65) return { label: '2mm spring suit', range: '65–70°F' };
  if (t >= 55) return { label: '3/2 mm full suit', range: '55–64°F' };
  if (t >= 48) return { label: '4/3 mm full suit', range: '48–54°F' };
  return { label: '5/4 mm full suit', range: 'Below 48°F' };
}

export function tideLabel(prMeters, minPr, maxPr) {
  const range = maxPr - minPr || 1;
  const norm = (prMeters - minPr) / range;
  let phase = 'Mid';
  if (norm < 0.25) phase = 'Low';
  else if (norm > 0.75) phase = 'High';
  const ft = (prMeters * 3.28084).toFixed(1);
  return { phase, heightFt: ft, norm };
}

/**
 * Score a session hour for this break’s wind window and the board that fits.
 * Returns 0–100 and a human-readable breakdown.
 */
export function scoreSession({
  waveFt,
  shape,
  windDir,
  windSpeed,
  tideNorm,
  offshoreFrom = 90,
  idealMin = 2,
  idealMax = 4,
  surfableMin = 1,
  surfableMax = 5,
}) {
  const factors = [];
  let score = 0;

  if (waveFt >= idealMin && waveFt <= idealMax) {
    score += 35;
    factors.push({ label: 'Wave height', detail: `${waveFt.toFixed(1)} ft — sweet spot`, good: true });
  } else if (waveFt >= surfableMin && waveFt <= surfableMax) {
    score += 18;
    factors.push({ label: 'Wave height', detail: `${waveFt.toFixed(1)} ft — surfable`, good: true });
  } else {
    factors.push({ label: 'Wave height', detail: `${waveFt.toFixed(1)} ft — outside ideal range`, good: false });
  }

  if (shape >= 1.5) {
    score += 28;
    factors.push({ label: 'Wave shape', detail: 'Good', good: true });
  } else if (shape >= 1.0) {
    score += 18;
    factors.push({ label: 'Wave shape', detail: 'Fair', good: true });
  } else if (shape >= 0.5) {
    score += 6;
    factors.push({ label: 'Wave shape', detail: 'Poor–Fair', good: false });
  } else {
    factors.push({ label: 'Wave shape', detail: 'Poor', good: false });
  }

  const wind = windLabel(windDir, windSpeed, offshoreFrom);
  if (wind.offshore && windSpeed <= 8) {
    score += 25;
    factors.push({ label: 'Wind', detail: `${wind.compass} ${wind.speedMph} mph — ${wind.quality}`, good: true });
  } else if (wind.offshore) {
    score += 12;
    factors.push({ label: 'Wind', detail: `${wind.compass} ${wind.speedMph} mph — strong offshore`, good: false });
  } else if (windSpeed <= 5) {
    score += 10;
    factors.push({ label: 'Wind', detail: `${wind.compass} ${wind.speedMph} mph — light`, good: true });
  } else {
    score -= 5;
    factors.push({ label: 'Wind', detail: `${wind.compass} ${wind.speedMph} mph — ${wind.quality}`, good: false });
  }

  if (tideNorm >= 0.35 && tideNorm <= 0.65) {
    score += 12;
    factors.push({ label: 'Tide', detail: 'Mid tide — ideal', good: true });
  } else if (tideNorm >= 0.2 && tideNorm <= 0.8) {
    score += 6;
    factors.push({ label: 'Tide', detail: 'Workable tide', good: true });
  } else {
    factors.push({ label: 'Tide', detail: 'Extreme tide', good: false });
  }

  return { score: Math.max(0, Math.min(100, score)), factors, isPerfect: score >= 72 };
}

export function scoreBand(score) {
  if (score >= 72) return 'firing';
  if (score >= 40) return 'go';
  return 'sit';
}

export function formatHour(timestamp) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
