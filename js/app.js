import { SPOTS } from './spots.js';
import { getSpotForecast, getTideForecast, getWindForecast, indexByTimestamp } from './api.js';
import {
  recommendActivity,
  shapeLabel,
  windLabel,
  tideLabel,
  scoreSession,
  formatHour,
  formatDate,
} from './recommendations.js';

const els = {
  dateInput: document.getElementById('date-input'),
  refreshBtn: document.getElementById('refresh-btn'),
  notifyBtn: document.getElementById('notify-btn'),
  status: document.getElementById('status'),
  bestBanner: document.getElementById('best-banner'),
  spotGrid: document.getElementById('spot-grid'),
  detailPanel: document.getElementById('detail-panel'),
  detailClose: document.getElementById('detail-close'),
};

let selectedSpotId = null;
let lastPerfectKeys = new Set();

function setStatus(msg, type = 'info') {
  els.status.textContent = msg;
  els.status.dataset.type = type;
}

function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function parseDateInput() {
  return new Date(`${els.dateInput.value}T12:00:00`);
}

function buildHourly(spotForecast, tideMap, windMap, tideRange) {
  return spotForecast.map((row) => {
    const waveFt = row.size_ft ?? row.size * 3.28084;
    const tide = tideMap.get(row.timestamp);
    const wind = windMap.get(row.timestamp);
    const pr = tide?.pr ?? 0;
    const tideInfo = tideLabel(pr, tideRange.min, tideRange.max);
    const windDir = wind?.wdir ?? 0;
    const windSpeed = wind?.wspd ?? 0;
    const session = scoreSession({
      waveFt,
      shape: row.shape,
      windDir,
      windSpeed,
      tideNorm: tideInfo.norm,
    });

    return {
      timestamp: row.timestamp,
      hour: formatHour(row.timestamp),
      waveFt,
      shape: row.shape,
      shapeLabel: shapeLabel(row.shape),
      recommendation: recommendActivity(waveFt),
      wind: windLabel(windDir, windSpeed),
      tide: tideInfo,
      session,
    };
  });
}

function summarizeSpot(spot, hours) {
  const daylight = hours.filter((h) => {
    const hr = new Date(h.timestamp * 1000).getHours();
    return hr >= 6 && hr <= 18;
  });
  const sample = daylight.length ? daylight : hours;
  const avgWave = sample.reduce((s, h) => s + h.waveFt, 0) / sample.length;
  const bestHour = [...sample].sort((a, b) => b.session.score - a.session.score)[0];
  const recommendation = recommendActivity(avgWave);

  return { avgWave, bestHour, recommendation, hours: sample };
}

function renderSpotCard(spot, summary) {
  const { recommendation, avgWave, bestHour } = summary;
  const perfect = bestHour?.session.isPerfect;

  return `
    <article class="spot-card ${recommendation.tone}" data-spot-id="${spot.id}" tabindex="0">
      ${perfect ? '<span class="badge perfect">Perfect window</span>' : ''}
      <h2>${spot.shortName}</h2>
      <p class="wave-size">${avgWave.toFixed(1)} ft avg</p>
      <p class="activity">${recommendation.emoji} ${recommendation.activity}</p>
      <p class="board">${recommendation.board}</p>
      ${bestHour ? `<p class="best-time">Best: ${bestHour.hour} (${bestHour.session.score}/100)</p>` : ''}
      ${spot.note ? `<p class="spot-note">${spot.note}</p>` : ''}
    </article>
  `;
}

function renderBestBanner(entries) {
  const ranked = entries
    .filter((e) => e.summary.bestHour)
    .sort((a, b) => b.summary.bestHour.session.score - a.summary.bestHour.session.score);

  if (!ranked.length) {
    els.bestBanner.hidden = true;
    return;
  }

  const top = ranked[0];
  const h = top.summary.bestHour;
  const perfect = ranked.filter((e) => e.summary.bestHour.session.isPerfect);

  els.bestBanner.hidden = false;
  els.bestBanner.innerHTML = `
    <div class="banner-inner">
      <div>
        <p class="banner-label">${perfect.length ? '🔥 Perfect conditions today' : '⭐ Best session today'}</p>
        <h2>${top.spot.name} · ${h.hour}</h2>
        <p class="banner-detail">
          ${h.waveFt.toFixed(1)} ft waves · ${h.wind.compass} wind ${h.wind.speedMph} mph (${h.wind.quality}) ·
          ${h.tide.phase} tide · Score ${h.session.score}/100
        </p>
        <p class="banner-ideal">Ideal setup: ${top.spot.idealWind}, ${top.spot.idealTide}</p>
      </div>
      <div class="banner-rec">${h.recommendation.emoji} ${h.recommendation.activity}</div>
    </div>
    ${
      perfect.length > 1
        ? `<p class="banner-more">Also firing: ${perfect
            .slice(1, 4)
            .map((e) => `${e.spot.shortName} (${e.summary.bestHour.hour})`)
            .join(', ')}</p>`
        : ''
    }
  `;

  maybeNotify(perfect, top);
}

function maybeNotify(perfectEntries, topEntry) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!perfectEntries.length) return;

  const key = `${els.dateInput.value}-${perfectEntries.map((e) => e.spot.id).join(',')}`;
  if (lastPerfectKeys.has(key)) return;
  lastPerfectKeys.add(key);

  const h = topEntry.summary.bestHour;
  new Notification('Perfect surf conditions!', {
    body: `${topEntry.spot.name} at ${h.hour}: ${h.waveFt.toFixed(1)} ft, ${h.wind.quality}, ${h.tide.phase} tide`,
    icon: '🏄',
  });
}

function renderDetail(spot, summary) {
  const { hours, recommendation } = summary;
  const rows = hours
    .map(
      (h) => `
      <tr class="${h.session.isPerfect ? 'perfect-row' : ''}">
        <td>${h.hour}</td>
        <td>${h.waveFt.toFixed(1)} ft</td>
        <td>${h.shapeLabel}</td>
        <td>${h.wind.compass} ${h.wind.speedMph} mph<br><small>${h.wind.quality}</small></td>
        <td>${h.tide.phase}<br><small>${h.tide.heightFt} ft</small></td>
        <td>${h.recommendation.board}</td>
        <td><span class="score ${h.session.isPerfect ? 'perfect' : ''}">${h.session.score}</span></td>
      </tr>
    `
    )
    .join('');

  const best = hours.reduce((a, b) => (b.session.score > a.session.score ? b : a), hours[0]);

  els.detailPanel.hidden = false;
  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${spot.name}</h2>
        <p class="detail-summary">${recommendation.summary}</p>
        ${spot.note ? `<p class="spot-note">${spot.note}</p>` : ''}
      </div>
      <button id="detail-close" class="icon-btn" aria-label="Close">✕</button>
    </div>

    <section class="ideal-box">
      <h3>What makes a great session here</h3>
      <ul>
        <li><strong>Waves:</strong> 1–4 ft for longboarding; over 5 ft → body surf</li>
        <li><strong>Wind:</strong> ${spot.idealWind} — glassy, clean faces</li>
        <li><strong>Tide:</strong> ${spot.idealTide}</li>
      </ul>
      ${
        best
          ? `<p class="peak-callout ${
              best.session.isPerfect ? 'perfect' : ''
            }">Peak window: <strong>${best.hour}</strong> — ${best.waveFt.toFixed(1)} ft,
            ${best.wind.compass} ${best.wind.speedMph} mph, ${best.tide.phase} tide (score ${best.session.score})</p>`
          : ''
      }
    </section>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Waves</th>
            <th>Shape</th>
            <th>Wind</th>
            <th>Tide</th>
            <th>Board</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  document.getElementById('detail-close').addEventListener('click', closeDetail);
}

function closeDetail() {
  els.detailPanel.hidden = true;
  selectedSpotId = null;
  document.querySelectorAll('.spot-card').forEach((c) => c.classList.remove('selected'));
}

async function loadDay() {
  setStatus('Loading forecasts…');
  els.spotGrid.innerHTML = '<p class="loading">Fetching surf data…</p>';
  els.bestBanner.hidden = true;

  const date = parseDateInput();
  const tideRows = await getTideForecast(date);
  const windRows = await getWindForecast(date);
  const tideMap = indexByTimestamp(tideRows);
  const windMap = indexByTimestamp(windRows);
  const tideRange = {
    min: Math.min(...tideRows.map((r) => r.pr)),
    max: Math.max(...tideRows.map((r) => r.pr)),
  };

  const entries = await Promise.all(
    SPOTS.map(async (spot) => {
      const forecast = await getSpotForecast(spot.id, date);
      const hours = buildHourly(forecast, tideMap, windMap, tideRange);
      const summary = summarizeSpot(spot, hours);
      return { spot, summary };
    })
  );

  els.spotGrid.innerHTML = entries.map((e) => renderSpotCard(e.spot, e.summary)).join('');
  renderBestBanner(entries);
  setStatus(`Updated ${formatDate(date)}`, 'ok');

  els.spotGrid.querySelectorAll('.spot-card').forEach((card) => {
    const open = () => {
      const id = Number(card.dataset.spotId);
      selectedSpotId = id;
      document.querySelectorAll('.spot-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      const entry = entries.find((e) => e.spot.id === id);
      renderDetail(entry.spot, entry.summary);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  });

  if (selectedSpotId) {
    const entry = entries.find((e) => e.spot.id === selectedSpotId);
    if (entry) renderDetail(entry.spot, entry.summary);
  }
}

async function setupNotifications() {
  if (!('Notification' in window)) {
    els.notifyBtn.hidden = true;
    return;
  }
  if (Notification.permission === 'granted') {
    els.notifyBtn.textContent = 'Alerts on';
    els.notifyBtn.classList.add('active');
    return;
  }
  els.notifyBtn.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      els.notifyBtn.textContent = 'Alerts on';
      els.notifyBtn.classList.add('active');
    }
  });
}

function init() {
  els.dateInput.value = todayString();
  els.dateInput.max = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  els.refreshBtn.addEventListener('click', () => loadDay().catch(handleError));
  els.dateInput.addEventListener('change', () => loadDay().catch(handleError));
  els.detailClose?.addEventListener('click', closeDetail);

  setupNotifications();
  loadDay().catch(handleError);
}

function handleError(err) {
  console.error(err);
  setStatus(err.message || 'Something went wrong loading forecasts.', 'error');
  els.spotGrid.innerHTML = `<p class="error-msg">Could not load data. Make sure the local server is running:<br><code>ruby server.rb</code></p>`;
}

init();
