import { SPOTS } from './spots.js';
import { getSpotForecast, getTideForecast, getWindForecast, indexByTimestamp } from './api.js';
import {
  recommendActivity,
  shapeLabel,
  windLabel,
  tideLabel,
  scoreSession,
  scoreBand,
  formatHour,
  formatDate,
} from './recommendations.js';
import {
  BOARDS,
  loadQuiver,
  saveQuiver,
  getBoard,
  boardSvg,
  matchingBoards,
} from './quiver.js';

const els = {
  dateInput: document.getElementById('date-input'),
  refreshBtn: document.getElementById('refresh-btn'),
  notifyBtn: document.getElementById('notify-btn'),
  quiverBtn: document.getElementById('quiver-btn'),
  quiverBar: document.getElementById('quiver-bar'),
  quiverModal: document.getElementById('quiver-modal'),
  quiverPicker: document.getElementById('quiver-picker'),
  quiverSaveBtn: document.getElementById('quiver-save-btn'),
  status: document.getElementById('status'),
  bestBanner: document.getElementById('best-banner'),
  spotGrid: document.getElementById('spot-grid'),
  detailPanel: document.getElementById('detail-panel'),
  detailClose: document.getElementById('detail-close'),
};

let selectedSpotId = null;
let lastPerfectKeys = new Set();
let quiver = loadQuiver();
let pickerSelection = new Set(quiver);

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

function getRecommendation(waveFt, spot) {
  return recommendActivity(waveFt, quiver, spot.allowedBoards);
}

function buildHourly(spot, spotForecast, tideMap, windMap, tideRange) {
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
      recommendation: getRecommendation(waveFt, spot),
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
  const recommendation = getRecommendation(bestHour?.waveFt ?? avgWave, spot);

  return { avgWave, bestHour, recommendation, hours: sample };
}

function formatFt(n) {
  return `${n.toFixed(1)}FT`;
}

function conditionCopy(recommendation, perfect) {
  if (recommendation.tone === 'flat') {
    return { label: 'Flat — sit this one out', cls: 'flat', cardTone: 'flat' };
  }
  if (perfect) {
    return { label: 'Firing right now', cls: 'firing', cardTone: 'firing' };
  }
  if (recommendation.tone === 'big') {
    return { label: 'Heavy — paddle with care', cls: 'big', cardTone: 'big' };
  }
  return { label: 'Go — worth the paddle', cls: 'good', cardTone: 'good' };
}

function renderSpotCard(spot, summary) {
  const { recommendation, avgWave, bestHour } = summary;
  const perfect = bestHour?.session.isPerfect;
  const status = conditionCopy(recommendation, perfect);
  const wind = bestHour?.wind;
  const tide = bestHour?.tide;

  return `
    <article class="spot-card ${status.cardTone}" data-spot-id="${spot.id}" tabindex="0">
      <h2>${spot.shortName}</h2>
      <p class="spot-region">${spot.region}</p>
      <div class="spot-metrics">
        <div>
          <p class="metric-value">${formatFt(avgWave)}</p>
          <p class="metric-label">Wave face</p>
        </div>
        <div>
          <p class="metric-value">${wind ? `${wind.speedMph}MPH` : '—'}</p>
          <p class="metric-label">${wind ? `Wind ${wind.compass}` : 'Wind'}</p>
        </div>
        <div>
          <p class="metric-value">${tide ? tide.phase : '—'}</p>
          <p class="metric-label">${tide ? `${tide.heightFt} ft tide` : 'Tide'}</p>
        </div>
      </div>
      <p class="spot-status ${status.cls}">${status.label}</p>
      <p class="spot-rec-label">Recommended</p>
      <p class="spot-rec">${recommendation.board}</p>
      ${bestHour ? `<p class="spot-note">Peak window ${bestHour.hour}</p>` : ''}
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
        <p class="banner-label">${perfect.length ? 'Firing right now' : 'Best session today'}</p>
        <h2>${top.spot.name}</h2>
        <p class="banner-metrics">${formatFt(h.waveFt)} · ${h.wind.speedMph}MPH ${h.wind.compass} · ${h.tide.phase} TIDE · ${h.hour}</p>
        <p class="banner-ideal">${top.spot.idealWind} · ${top.spot.idealTide}</p>
      </div>
      <div class="banner-rec">Recommended<strong>${h.recommendation.board}</strong></div>
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
  new Notification('SESH is firing', {
    body: `${topEntry.spot.name} at ${h.hour}: ${h.waveFt.toFixed(1)} ft, ${h.wind.quality}, ${h.tide.phase} tide`,
  });
}

function renderDetail(spot, summary) {
  const { hours, recommendation, avgWave } = summary;
  const rows = hours
    .map(
      (h) => `
      <tr class="${h.session.isPerfect ? 'perfect-row' : ''}">
        <td>${h.hour}</td>
        <td>${h.waveFt.toFixed(1)}FT</td>
        <td>${h.shapeLabel}</td>
        <td>${h.wind.compass} ${h.wind.speedMph} mph<br><small>${h.wind.quality}</small></td>
        <td>${h.tide.phase}<br><small>${h.tide.heightFt} ft</small></td>
        <td>${h.recommendation.board}</td>
        <td><span class="score ${scoreBand(h.session.score)}">${h.session.score}</span></td>
      </tr>
    `
    )
    .join('');

  const best = hours.reduce((a, b) => (b.session.score > a.session.score ? b : a), hours[0]);
  const allowedNames = (spot.allowedBoards || [])
    .map((id) => getBoard(id)?.name)
    .filter(Boolean)
    .join(', ');
  const quiverNote =
    quiver.length && avgWave >= 1
      ? (() => {
          const matches = matchingBoards(avgWave, quiver, spot.allowedBoards);
          if (!matches.length) return '<li><strong>Your quiver:</strong> No boards match this break and wave size</li>';
          return `<li><strong>Your quiver fits:</strong> ${matches.map((b) => b.name).join(', ')}</li>`;
        })()
      : '';

  els.detailPanel.hidden = false;
  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${spot.name}</h2>
        <p class="spot-region">${spot.region}</p>
        <p class="detail-summary">${recommendation.summary}</p>
        ${spot.note ? `<p class="spot-note">${spot.note}</p>` : ''}
      </div>
      <button id="detail-close" class="icon-btn" aria-label="Close">✕</button>
    </div>

    <section class="ideal-box">
      <h3>${quiver.length ? 'Recommendation for your quiver' : 'What makes a great session here'}</h3>
      <ul>
        <li><strong>This break:</strong> ${allowedNames}${spot.shortName === 'West Street' ? ', swimming' : '; swimming when flat'}</li>
        <li><strong>Wind:</strong> ${spot.idealWind} — glassy, clean faces</li>
        <li><strong>Tide:</strong> ${spot.idealTide}</li>
        ${quiverNote}
      </ul>
      ${
        best
          ? `<p class="peak-callout ${
              best.session.isPerfect ? 'perfect' : ''
            }">Peak window: <strong>${best.hour}</strong> — ${best.waveFt.toFixed(1)} ft,
            grab your <strong>${best.recommendation.board}</strong> · ${best.wind.compass} ${best.wind.speedMph} mph,
            ${best.tide.phase} tide (score ${best.session.score})</p>`
          : ''
      }
    </section>

    <p class="score-key">
      <span class="score-key-label">Score</span>
      <span><i class="swatch sit"></i> 0–39 sit</span>
      <span><i class="swatch go"></i> 40–71 go</span>
      <span><i class="swatch firing"></i> 72–100 firing</span>
    </p>
    <p class="score-key-hint">Combines wave size, shape, wind, and tide. Higher means a better window to paddle out.</p>

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

function renderQuiverBar() {
  if (!quiver.length) {
    els.quiverBar.hidden = true;
    els.quiverBtn.textContent = 'Create my quiver';
    return;
  }

  els.quiverBar.hidden = false;
  els.quiverBtn.textContent = 'Edit my quiver';

  const chips = quiver
    .map((id) => {
      const board = getBoard(id);
      if (!board) return '';
      return `
        <div class="quiver-chip" title="${board.name}">
          <div class="quiver-chip-icon">${boardSvg(id)}</div>
          <span>${board.name}</span>
        </div>
      `;
    })
    .join('');

  els.quiverBar.innerHTML = `
    <div class="quiver-bar-inner">
      <div>
        <p class="quiver-bar-label">Your quiver</p>
        <div class="quiver-chips">${chips}</div>
      </div>
      <p class="quiver-bar-hint">Forecasts filtered to your boards</p>
    </div>
  `;
}

function renderQuiverPicker() {
  els.quiverPicker.innerHTML = BOARDS.map(
    (board) => `
    <button
      type="button"
      class="quiver-option ${pickerSelection.has(board.id) ? 'selected' : ''}"
      data-board-id="${board.id}"
      aria-pressed="${pickerSelection.has(board.id)}"
    >
      <div class="quiver-option-icon">${boardSvg(board.id)}</div>
      <span class="quiver-option-name">${board.name}</span>
      <span class="quiver-option-label">${board.label}</span>
      <span class="quiver-option-range">${board.idealMin}–${board.idealMax}FT ideal</span>
    </button>
  `
  ).join('');

  els.quiverPicker.querySelectorAll('.quiver-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.boardId;
      if (pickerSelection.has(id)) pickerSelection.delete(id);
      else pickerSelection.add(id);
      btn.classList.toggle('selected', pickerSelection.has(id));
      btn.setAttribute('aria-pressed', String(pickerSelection.has(id)));
      els.quiverSaveBtn.disabled = pickerSelection.size === 0;
    });
  });

  els.quiverSaveBtn.disabled = pickerSelection.size === 0;
}

function openQuiverModal() {
  pickerSelection = new Set(quiver);
  document.getElementById('quiver-modal-title').textContent = quiver.length
    ? 'Edit your quiver'
    : 'Build your quiver';
  renderQuiverPicker();
  els.quiverModal.hidden = false;
  els.quiverModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeQuiverModal() {
  els.quiverModal.hidden = true;
  els.quiverModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function saveQuiverSelection() {
  quiver = [...pickerSelection];
  saveQuiver(quiver);
  closeQuiverModal();
  renderQuiverBar();
  loadDay().catch(handleError);
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
      const hours = buildHourly(spot, forecast, tideMap, windMap, tideRange);
      const summary = summarizeSpot(spot, hours);
      return { spot, summary };
    })
  );

  els.spotGrid.innerHTML = entries.map((e) => renderSpotCard(e.spot, e.summary)).join('');
  renderBestBanner(entries);
  setStatus(`Updated ${formatDate(date)}${quiver.length ? ' · filtered to your quiver' : ''}`, 'ok');

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

function setupQuiver() {
  els.quiverBtn.addEventListener('click', openQuiverModal);
  els.quiverSaveBtn.addEventListener('click', saveQuiverSelection);
  els.quiverModal.querySelectorAll('[data-close-quiver]').forEach((el) => {
    el.addEventListener('click', closeQuiverModal);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !els.quiverModal.hidden) closeQuiverModal();
  });
  renderQuiverBar();
}

function init() {
  els.dateInput.value = todayString();
  els.dateInput.max = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  els.refreshBtn.addEventListener('click', () => loadDay().catch(handleError));
  els.dateInput.addEventListener('change', () => loadDay().catch(handleError));
  els.detailClose?.addEventListener('click', closeDetail);

  setupQuiver();
  setupNotifications();
  loadDay().catch(handleError);
}

function handleError(err) {
  console.error(err);
  setStatus(err.message || 'Something went wrong loading forecasts.', 'error');
  els.spotGrid.innerHTML = `<p class="error-msg">Could not load data. Make sure the local server is running:<br><code>ruby server.rb</code></p>`;
}

init();
