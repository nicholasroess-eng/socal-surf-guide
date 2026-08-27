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

/** SoCal south-facing breaks: offshore wind blows from land (E / NE). */
export function windLabel(degrees, speedMph) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((degrees % 360) / 45)) % 8;
  const compass = dirs[idx];
  const offshore = degrees >= 45 && degrees <= 135;
  let quality = 'Cross-shore';
  if (offshore && speedMph <= 10) quality = 'Offshore';
  else if (offshore && speedMph > 10) quality = 'Offshore, strong';
  else if ((degrees >= 225 && degrees <= 315) || speedMph > 15) quality = 'Onshore';

  return { compass, quality, offshore, speedMph: Math.round(speedMph) };
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
 * Score a session hour for longboard-friendly "perfect" conditions.
 * Returns 0–100 and a human-readable breakdown.
 */
export function scoreSession({ waveFt, shape, windDir, windSpeed, tideNorm }) {
  const factors = [];
  let score = 0;

  if (waveFt >= 2 && waveFt <= 4) {
    score += 35;
    factors.push({ label: 'Wave height', detail: `${waveFt.toFixed(1)} ft — sweet spot`, good: true });
  } else if (waveFt >= 1 && waveFt <= 5) {
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

  const wind = windLabel(windDir, windSpeed);
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
