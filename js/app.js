import {
  MAX_FAVORITE_BEACHES,
  loadFavoriteIds,
  saveFavoriteIds,
  toAppSpot,
  applyCoastOrientation,
  groupSpotsByCounty,
} from './spots.js';
import {
  getAllSpots,
  getSpotForecast,
  getTideForecast,
  getWindForecast,
  getWaterTempF,
  indexByTimestamp,
} from './api.js';
import {
  recommendActivity,
  shapeLabel,
  windLabel,
  tideLabel,
  wearFromWaterTemp,
  scoreSession,
  scoreBand,
  formatHour,
  formatDate,
  formatClock,
  findPeakWindow,
  formatPeakWindow,
  pacificDateString,
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
  beachesBtn: document.getElementById('beaches-btn'),
  beachesModal: document.getElementById('beaches-modal'),
  beachesPicker: document.getElementById('beaches-picker'),
  beachesSearch: document.getElementById('beaches-search'),
  beachesCount: document.getElementById('beaches-count'),
  beachesSaveBtn: document.getElementById('beaches-save-btn'),
  status: document.getElementById('status'),
  bestBanner: document.getElementById('best-banner'),
  spotGrid: document.getElementById('spot-grid'),
  detailModal: document.getElementById('detail-modal'),
  detailPanel: document.getElementById('detail-panel'),
  welcomeModal: document.getElementById('welcome-modal'),
  welcomeDismissBtn: document.getElementById('welcome-dismiss-btn'),
};

let selectedSpotId = null;
let lastPerfectKeys = new Set();
let quiver = loadQuiver();
let pickerSelection = new Set(quiver);
let catalog = [];
let catalogById = new Map();
let favoriteIds = loadFavoriteIds();
let beachSelection = new Set(favoriteIds);

function setStatus(msg, type = 'info') {
  els.status.textContent = msg;
  els.status.dataset.type = type;
}

function todayString() {
  return pacificDateString();
}

function isHappeningNow(summary) {
  if (!summary?.bestHour) return false;
  const now = Date.now() / 1000;
  const window = summary.peakWindow;
  if (window) return now >= window.start.timestamp && now < window.end.timestamp + 3600;
  const ts = summary.bestHour.timestamp;
  return now >= ts && now < ts + 3600;
}

function parseDateInput() {
  return new Date(`${els.dateInput.value}T12:00:00`);
}

function favoriteSpots() {
  return favoriteIds.map((id) => catalogById.get(id)).filter(Boolean);
}

function hasFavorites() {
  return favoriteIds.length > 0;
}

function releaseModalLock() {
  if (
    els.welcomeModal.hidden &&
    els.beachesModal.hidden &&
    els.quiverModal.hidden &&
    els.detailModal.hidden
  ) {
    document.body.classList.remove('modal-open');
  }
}

function getRecommendation(waveFt, spot) {
  return recommendActivity(waveFt, quiver, spot.allowedBoards);
}

function surfLocal(row) {
  const loc = row.date_local;
  if (loc && Number.isFinite(Number(loc.yy)) && Number.isFinite(Number(loc.dd))) {
    return {
      year: Number(loc.yy),
      month: Number(loc.mm),
      day: Number(loc.dd),
      hour: Number(loc.hh),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(row.timestamp * 1000));
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: n('year'), month: n('month'), day: n('day'), hour: n('hour') };
}

function buildHourly(spot, spotForecast, tideMap, windMap, tideRange, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return spotForecast.flatMap((row) => {
    const loc = surfLocal(row);
    if (loc.year !== y || loc.month !== m || loc.day !== d) return [];
    const waveFt = row.size_ft ?? row.size * 3.28084;
    const tide = tideMap.get(row.timestamp);
    const wind = windMap.get(row.timestamp);
    const tideKnown = Number.isFinite(tide?.pr);
    const windKnown = Number.isFinite(wind?.wdir) && Number.isFinite(wind?.wspd);
    const pr = tideKnown ? tide.pr : 0;
    const tideInfo = tideKnown
      ? tideLabel(pr, tideRange.min, tideRange.max)
      : { phase: '—', heightFt: '—', norm: 0.5 };
    const windDir = windKnown ? wind.wdir : 0;
    const windSpeed = windKnown ? wind.wspd : 0;
    const recommendation = getRecommendation(waveFt, spot);
    const board = recommendation.boardId ? getBoard(recommendation.boardId) : null;
    const session = scoreSession({
      waveFt,
      shape: row.shape,
      windDir,
      windSpeed,
      tideNorm: tideInfo.norm,
      offshoreFrom: spot.offshoreFrom,
      idealMin: board?.idealMin ?? 2,
      idealMax: board?.idealMax ?? 4,
      surfableMin: board?.minWave ?? 1,
      surfableMax: board?.maxWave ?? 5,
      windKnown,
      tideKnown,
    });

    return [
      {
        timestamp: row.timestamp,
        hour: formatHour(row.timestamp),
        localHour: loc.hour,
        waveFt,
        shape: row.shape,
        shapeLabel: shapeLabel(row.shape),
        recommendation,
        wind: windKnown
          ? { ...windLabel(windDir, windSpeed, spot.offshoreFrom), hasData: true }
          : { compass: '—', quality: 'no reading', speedMph: 0, offshore: false, onshore: false, hasData: false },
        tide: { ...tideInfo, hasData: tideKnown },
        session,
      },
    ];
  });
}

function summarizeSpot(spot, hours, waterTempF = null, date = null) {
  const wear = wearFromWaterTemp(waterTempF);
  const dayLabel = date ? formatDate(date) : '';
  const daylight = hours.filter((h) => {
    const hr = Number.isFinite(h.localHour) ? h.localHour : new Date(h.timestamp * 1000).getHours();
    return hr >= 6 && hr <= 18;
  });
  const sample = daylight.length ? daylight : hours;
  if (!sample.length) {
    return {
      avgWave: 0,
      bestHour: null,
      peakWindow: null,
      peakWindowLabel: '',
      recommendation: getRecommendation(0, spot),
      hours: [],
      waterTempF,
      wear,
      dayLabel,
    };
  }
  const avgWave = sample.reduce((s, h) => s + h.waveFt, 0) / sample.length;
  const bestHour = [...sample].sort((a, b) => b.session.score - a.session.score)[0];
  const recommendation = getRecommendation(bestHour?.waveFt ?? avgWave, spot);
  const peakWindow = findPeakWindow(sample, bestHour);

  return {
    avgWave,
    bestHour,
    peakWindow,
    peakWindowLabel: formatPeakWindow(peakWindow),
    recommendation,
    hours: sample,
    waterTempF,
    wear,
    dayLabel,
  };
}

function formatFt(n) {
  return `${n.toFixed(1)}FT`;
}

function explainCall(spot, summary) {
  const { bestHour: h, recommendation, wear, waterTempF, peakWindowLabel } = summary;
  const window = peakWindowLabel ? ` Peak window ${peakWindowLabel}.` : '';

  let grade;
  if (!h || recommendation.tone === 'flat' || h.waveFt < 1) {
    grade = 'Sit — it’s under a foot, so this is a swim or rest day, not a surf.';
  } else {
    const band = h.session.isPerfect ? 'Firing' : h.session.score >= 40 ? 'Go' : 'Sit';
    const windBit = `${h.wind.quality.toLowerCase()} ${h.wind.compass} at ${h.wind.speedMph} mph`;
    const shapeBit = `${h.shapeLabel.toLowerCase()} shape`;
    if (band === 'Firing') {
      grade = `Firing (score ${h.session.score}) — ${h.waveFt.toFixed(1)} ft, ${shapeBit}, ${windBit}, ${h.tide.phase.toLowerCase()} tide.${window}`;
    } else if (band === 'Go') {
      const drag = (h.session.factors || []).find((f) => !f.good);
      const hold = drag ? ` Held back by ${drag.detail.split('—')[0].trim().toLowerCase()}.` : '';
      grade = `Go (score ${h.session.score}) — surfable at ${h.waveFt.toFixed(1)} ft with ${windBit}.${hold}${window}`;
    } else {
      grade = `Sit (score ${h.session.score}) — ${h.waveFt.toFixed(1)} ft and ${windBit} don’t add up to a session.${window}`;
    }
  }

  let board;
  const craft = recommendation.boardId ? getBoard(recommendation.boardId) : null;
  if (!h || recommendation.tone === 'flat' || recommendation.board === 'Swimming') {
    board = 'No board — not enough wave to ride.';
  } else if (!craft) {
    board = `${recommendation.board}.`;
  } else {
    const quiverBit = recommendation.fromQuiver ? ' It’s in your quiver.' : '';
    const breakBit = spot.allowedBoards ? ' This break suits that craft.' : '';
    board = `${craft.name} — ${h.waveFt.toFixed(1)} ft sits in its ${craft.idealMin}–${craft.idealMax} ft range.${breakBit}${quiverBit}`;
  }

  let suit;
  if (wear && Number.isFinite(waterTempF)) {
    suit = `${wear.label} — water is ${Math.round(waterTempF)}°F (${wear.range}).`;
  } else {
    suit = 'No water-temp reading for this county yet.';
  }

  return { grade, board, suit };
}

function conditionCopy(recommendation, { perfect = false, live = false } = {}) {
  if (recommendation.tone === 'flat') {
    return { label: 'Flat — sit this one out', cls: 'flat', cardTone: 'flat' };
  }
  if (perfect) {
    return { label: live ? 'Firing right now' : 'Firing', cls: 'firing', cardTone: 'firing' };
  }
  if (recommendation.tone === 'big') {
    return { label: 'Heavy — paddle with care', cls: 'big', cardTone: 'big' };
  }
  return { label: 'Go — worth the paddle', cls: 'good', cardTone: 'good' };
}

function renderSpotCard(spot, summary) {
  const { recommendation, avgWave, bestHour, peakWindowLabel, waterTempF, wear } = summary;
  const perfect = bestHour?.session.isPerfect;
  const status = conditionCopy(recommendation, { perfect, live: Boolean(perfect && isHappeningNow(summary)) });
  const wind = bestHour?.wind;
  const tide = bestHour?.tide;
  const tempLabel = Number.isFinite(waterTempF) ? `${Math.round(waterTempF)}°F` : '—';

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
          <p class="metric-value">${wind?.hasData ? `${wind.speedMph}MPH` : '—'}</p>
          <p class="metric-label">${wind?.hasData ? `Wind ${wind.compass}` : 'Wind'}</p>
        </div>
        <div>
          <p class="metric-value">${tide?.hasData ? tide.phase : '—'}</p>
          <p class="metric-label">${tide?.hasData ? `${tide.heightFt} ft tide` : 'Tide'}</p>
        </div>
        <div>
          <p class="metric-value">${tempLabel}</p>
          <p class="metric-label">Water</p>
        </div>
      </div>
      <p class="spot-status ${status.cls}">${status.label}</p>
      <div class="spot-recs">
        <div>
          <p class="spot-rec-label">Recommended</p>
          <p class="spot-rec">${recommendation.board}</p>
        </div>
        <div>
          <p class="spot-rec-label">Wear</p>
          <p class="spot-rec">${wear ? wear.label : '—'}</p>
        </div>
      </div>
      ${peakWindowLabel ? `<p class="spot-note">Peak window ${peakWindowLabel}</p>` : ''}
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
  const live = Boolean(perfect.length && isHappeningNow(top.summary));
  const selectedToday = els.dateInput.value === todayString();
  const bannerLabel = live ? 'Firing right now' : perfect.length ? 'Firing' : selectedToday ? 'Best session today' : 'Best session';

  els.bestBanner.hidden = false;
  els.bestBanner.innerHTML = `
    <div class="banner-inner">
      <div>
        <p class="banner-label">${bannerLabel}</p>
        <h2>${top.spot.name}</h2>
        <p class="banner-metrics">${formatFt(h.waveFt)} · ${h.wind.speedMph}MPH ${h.wind.compass} · ${h.tide.phase} TIDE · ${top.summary.peakWindowLabel || h.hour}</p>
        <p class="banner-ideal">${top.spot.idealWind} · ${top.spot.idealTide}</p>
      </div>
      <div class="banner-rec">Recommended<strong>${h.recommendation.board}</strong></div>
    </div>
    ${
      perfect.length > 1
        ? `<p class="banner-more">Also firing: ${perfect
            .slice(1, 4)
            .map((e) => `${e.spot.shortName} (${e.summary.peakWindowLabel || e.summary.bestHour.hour})`)
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
    body: `${topEntry.spot.name} ${topEntry.summary.peakWindowLabel || h.hour}: ${h.waveFt.toFixed(1)} ft, ${h.wind.quality}, ${h.tide.phase} tide`,
  });
}

function renderDetail(spot, summary) {
  const { hours, recommendation, avgWave, dayLabel } = summary;
  const rows = hours
    .map(
      (h) => `
      <tr class="${h.session.isPerfect ? 'perfect-row' : ''}">
        <td>${h.hour}</td>
        <td>${h.waveFt.toFixed(1)}FT</td>
        <td>${h.shapeLabel}</td>
        <td>${h.wind.hasData ? `${h.wind.compass} ${h.wind.speedMph} mph<br><small>${h.wind.quality}</small>` : '—'}</td>
        <td>${h.tide.hasData ? `${h.tide.phase}<br><small>${h.tide.heightFt} ft</small>` : '—'}</td>
        <td>${h.recommendation.board}</td>
        <td><span class="score ${scoreBand(h.session.score)}">${h.session.score}</span></td>
      </tr>
    `
    )
    .join('');

  const best = hours.length
    ? hours.reduce((a, b) => (b.session.score > a.session.score ? b : a), hours[0])
    : null;
  const allowedNames = (spot.allowedBoards || [])
    .map((id) => getBoard(id)?.name)
    .filter(Boolean)
    .join(', ');
  const breakLine = allowedNames
    ? `${allowedNames}${spot.shortName === 'West Street' ? ', swimming' : '; swimming when flat'}`
    : 'Any board by wave size; swimming when flat';
  const quiverNote =
    quiver.length && avgWave >= 1
      ? (() => {
          const matches = matchingBoards(avgWave, quiver, spot.allowedBoards);
          if (!matches.length) return '<li><strong>Your quiver:</strong> No boards match this break and wave size</li>';
          return `<li><strong>Your quiver fits:</strong> ${matches.map((b) => b.name).join(', ')}</li>`;
        })()
      : '';
  const why = explainCall(spot, summary);

  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <h2 id="detail-spot-title">${spot.name}</h2>
        <p class="spot-region">${spot.region}</p>
        ${dayLabel ? `<p class="detail-day">${dayLabel}</p>` : ''}
        <p class="detail-summary">${recommendation.summary}</p>
        ${spot.note ? `<p class="spot-note">${spot.note}</p>` : ''}
      </div>
      <button id="detail-close" class="icon-btn" aria-label="Close">✕</button>
    </div>

    <section class="why-call">
      <h3>Why this call</h3>
      <p><strong>Grade.</strong> ${why.grade}</p>
      <p><strong>Board.</strong> ${why.board}</p>
      <p><strong>Wear.</strong> ${why.suit}</p>
    </section>

    <section class="ideal-box">
      <h3>${quiver.length ? 'Recommendation for your quiver' : 'What makes a great session here'}</h3>
      <ul>
        <li><strong>This break:</strong> ${breakLine}</li>
        <li><strong>Wind:</strong> ${spot.idealWind} — glassy, clean faces</li>
        <li><strong>Tide:</strong> ${spot.idealTide}</li>
        ${
          Number.isFinite(summary.waterTempF)
            ? `<li><strong>Water:</strong> ${Math.round(summary.waterTempF)}°F — wear a ${summary.wear.label}</li>`
            : ''
        }
        ${quiverNote}
      </ul>
      ${
        best
          ? `<p class="peak-callout ${
              best.session.isPerfect ? 'perfect' : ''
            }">Peak window${dayLabel ? ` ${dayLabel}` : ''}: <strong>${summary.peakWindowLabel || best.hour}</strong> — ${best.waveFt.toFixed(1)} ft,
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

    <section class="hourly">
      <div class="hourly-heading">
        <h3>Hourly waves</h3>
        ${dayLabel ? `<p class="hourly-day">${dayLabel}</p>` : ''}
        <p class="hourly-hint">Pacific time · daylight hours only</p>
      </div>
      ${
        rows
          ? `<div class="table-wrap">
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
    </div>`
          : `<p class="hourly-empty">No hourly forecast for ${dayLabel || 'this day'}.</p>`
      }
    </section>
  `;

  els.detailModal.hidden = false;
  els.detailModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-close').focus();
}

function closeDetail() {
  els.detailModal.hidden = true;
  els.detailModal.setAttribute('aria-hidden', 'true');
  els.detailPanel.innerHTML = '';
  selectedSpotId = null;
  document.querySelectorAll('.spot-card').forEach((c) => c.classList.remove('selected'));
  releaseModalLock();
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
  releaseModalLock();
}

function saveQuiverSelection() {
  quiver = [...pickerSelection];
  saveQuiver(quiver);
  closeQuiverModal();
  renderQuiverBar();
  loadDay().catch(handleError);
}

function updateBeachesCount() {
  const n = beachSelection.size;
  els.beachesCount.textContent =
    n >= MAX_FAVORITE_BEACHES
      ? `${n} / ${MAX_FAVORITE_BEACHES} selected · limit reached`
      : `${n} / ${MAX_FAVORITE_BEACHES} selected · ${catalog.length} in catalog`;
  els.beachesCount.classList.toggle('at-limit', n >= MAX_FAVORITE_BEACHES);
  els.beachesSaveBtn.disabled = n === 0;
}

function syncBeachLimit() {
  const atLimit = beachSelection.size >= MAX_FAVORITE_BEACHES;
  els.beachesPicker.querySelectorAll('.beach-option').forEach((btn) => {
    const selected = beachSelection.has(Number(btn.dataset.spotId));
    btn.disabled = atLimit && !selected;
    btn.classList.toggle('at-limit', atLimit && !selected);
  });
}

function renderBeachesPicker() {
  const q = (els.beachesSearch.value || '').trim().toLowerCase();
  const filtered = q
    ? catalog.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.shortName.toLowerCase().includes(q) ||
          s.region.toLowerCase().includes(q) ||
          s.countyName.toLowerCase().includes(q)
      )
    : catalog;

  const groups = groupSpotsByCounty(filtered);
  if (!groups.length) {
    els.beachesPicker.innerHTML = '<p class="beaches-empty">No beaches match that search.</p>';
    updateBeachesCount();
    return;
  }

  els.beachesPicker.innerHTML = groups
    .map(
      (group) => `
      <section class="beaches-county">
        <h3>${group.countyName}</h3>
        <div class="beaches-list">
          ${group.spots
            .map(
              (spot) => `
            <button
              type="button"
              class="beach-option ${beachSelection.has(spot.id) ? 'selected' : ''}"
              data-spot-id="${spot.id}"
              aria-pressed="${beachSelection.has(spot.id)}"
            >
              <span class="beach-option-name">${spot.shortName}</span>
              <span class="beach-option-region">${spot.region}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </section>
    `
    )
    .join('');

  els.beachesPicker.querySelectorAll('.beach-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.spotId);
      if (beachSelection.has(id)) beachSelection.delete(id);
      else if (beachSelection.size < MAX_FAVORITE_BEACHES) beachSelection.add(id);
      else return;
      btn.classList.toggle('selected', beachSelection.has(id));
      btn.setAttribute('aria-pressed', String(beachSelection.has(id)));
      updateBeachesCount();
      syncBeachLimit();
    });
  });

  updateBeachesCount();
  syncBeachLimit();
}

function syncBeachesDismiss() {
  const canDismiss = hasFavorites();
  els.beachesModal.querySelectorAll('.quiver-close[data-close-beaches]').forEach((el) => {
    el.hidden = !canDismiss;
  });
}

function openBeachesModal() {
  beachSelection = new Set(favoriteIds);
  els.beachesSearch.value = '';
  renderBeachesPicker();
  syncBeachesDismiss();
  els.beachesModal.hidden = false;
  els.beachesModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  els.beachesSearch.focus();
}

function closeBeachesModal() {
  if (!hasFavorites()) return;
  els.beachesModal.hidden = true;
  els.beachesModal.setAttribute('aria-hidden', 'true');
  releaseModalLock();
}

function saveBeachSelection() {
  if (!beachSelection.size) return;
  favoriteIds = [...beachSelection].slice(0, MAX_FAVORITE_BEACHES);
  saveFavoriteIds(favoriteIds);
  syncBeachesDismiss();
  closeBeachesModal();
  loadDay().catch(handleError);
}

function promptBeachesIfNeeded() {
  if (hasFavorites()) return;
  loadCatalog()
    .then(openBeachesModal)
    .catch(handleError);
}

async function countyConditions(countyIds, date) {
  const unique = [...new Set(countyIds.filter(Boolean))];
  const byCounty = {};
  await Promise.all(
    unique.map(async (countyId) => {
      try {
        const [tideRows, windRows, waterTempF] = await Promise.all([
          getTideForecast(countyId, date),
          getWindForecast(countyId, date),
          getWaterTempF(countyId, date).catch(() => null),
        ]);
        const tides = Array.isArray(tideRows) ? tideRows : [];
        const winds = Array.isArray(windRows) ? windRows : [];
        byCounty[countyId] = {
          tideMap: indexByTimestamp(tides),
          windMap: indexByTimestamp(winds),
          waterTempF,
          tideRange: {
            min: tides.length ? Math.min(...tides.map((r) => r.pr)) : 0,
            max: tides.length ? Math.max(...tides.map((r) => r.pr)) : 1,
          },
        };
      } catch (err) {
        console.warn(`County ${countyId} conditions failed`, err);
        byCounty[countyId] = {
          tideMap: new Map(),
          windMap: new Map(),
          waterTempF: null,
          tideRange: { min: 0, max: 1 },
        };
      }
    })
  );
  return byCounty;
}

async function loadCatalog() {
  const raw = await getAllSpots();
  catalog = applyCoastOrientation(raw.map(toAppSpot));
  catalogById = new Map(catalog.map((s) => [s.id, s]));
  favoriteIds = loadFavoriteIds().filter((id) => catalogById.has(id));
}

async function loadDay() {
  setStatus('Loading forecasts…');
  els.spotGrid.innerHTML = '<p class="loading">Fetching surf data…</p>';
  els.bestBanner.hidden = true;

  if (!catalog.length) await loadCatalog();

  const spots = favoriteSpots();
  if (!spots.length) {
    els.spotGrid.innerHTML = `
      <div class="beaches-empty-state">
        <p>Pick up to ${MAX_FAVORITE_BEACHES} beaches you actually surf.</p>
        <button type="button" class="btn" id="empty-beaches-btn">Choose my beaches</button>
      </div>
    `;
    els.spotGrid.querySelector('#empty-beaches-btn')?.addEventListener('click', promptBeachesIfNeeded);
    setStatus('Choose your beaches to load forecasts');
    closeDetail();
    return;
  }

  const date = parseDateInput();
  const conditions = await countyConditions(
    spots.map((s) => s.countyId),
    date
  );

  const settled = await Promise.all(
    spots.map(async (spot) => {
      try {
        const forecast = await getSpotForecast(spot.id, date);
        const cond = conditions[spot.countyId] || {
          tideMap: new Map(),
          windMap: new Map(),
          tideRange: { min: 0, max: 1 },
          waterTempF: null,
        };
        const hours = buildHourly(
          spot,
          Array.isArray(forecast) ? forecast : [],
          cond.tideMap,
          cond.windMap,
          cond.tideRange,
          date
        );
        const summary = summarizeSpot(spot, hours, cond.waterTempF, date);
        return { spot, summary };
      } catch (err) {
        console.warn(`Forecast failed for ${spot.name}`, err);
        return null;
      }
    })
  );
  const entries = settled.filter(Boolean);
  if (!entries.length) throw new Error('Could not load forecasts for your beaches. Refresh and try again.');

  els.spotGrid.innerHTML = entries.map((e) => renderSpotCard(e.spot, e.summary)).join('');
  renderBestBanner(entries);
  const n = spots.length;
  setStatus(
    `Updated ${formatClock(new Date())} · ${formatDate(date)} · ${n} beach${n === 1 ? '' : 'es'}${quiver.length ? ' · filtered to your quiver' : ''}`,
    'ok'
  );

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
    else closeDetail();
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
  renderQuiverBar();
}

const WELCOME_KEY = 'sesh-welcome-seen';

function openWelcomeModal() {
  els.welcomeModal.hidden = false;
  els.welcomeModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function dismissWelcome() {
  localStorage.setItem(WELCOME_KEY, '1');
  els.welcomeModal.hidden = true;
  els.welcomeModal.setAttribute('aria-hidden', 'true');
  releaseModalLock();
  promptBeachesIfNeeded();
}

function setupWelcome() {
  els.welcomeDismissBtn.addEventListener('click', dismissWelcome);
  els.welcomeModal.querySelectorAll('[data-close-welcome]').forEach((el) => {
    el.addEventListener('click', dismissWelcome);
  });
  try {
    if (!localStorage.getItem(WELCOME_KEY)) openWelcomeModal();
    else promptBeachesIfNeeded();
  } catch {
    openWelcomeModal();
  }
}

function setupBeaches() {
  els.beachesBtn.addEventListener('click', () => {
    loadCatalog()
      .then(openBeachesModal)
      .catch(handleError);
  });
  els.beachesSaveBtn.addEventListener('click', saveBeachSelection);
  els.beachesSearch.addEventListener('input', renderBeachesPicker);
  els.beachesModal.querySelectorAll('[data-close-beaches]').forEach((el) => {
    el.addEventListener('click', closeBeachesModal);
  });
}

function init() {
  els.dateInput.value = todayString();
  els.dateInput.max = pacificDateString(new Date(Date.now() + 6 * 86400000));

  els.refreshBtn.addEventListener('click', () => loadDay().catch(handleError));
  els.dateInput.addEventListener('change', () => loadDay().catch(handleError));
  els.detailModal.querySelectorAll('[data-close-detail]').forEach((el) => {
    el.addEventListener('click', closeDetail);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!els.welcomeModal.hidden) dismissWelcome();
    else if (!els.beachesModal.hidden && hasFavorites()) closeBeachesModal();
    else if (!els.quiverModal.hidden) closeQuiverModal();
    else if (!els.detailModal.hidden) closeDetail();
  });

  setupWelcome();
  setupQuiver();
  setupBeaches();
  setupNotifications();
  loadDay().catch(handleError);
}

function handleError(err) {
  console.error(err);
  setStatus(err.message || 'Something went wrong loading forecasts.', 'error');
  els.spotGrid.innerHTML = `<p class="error-msg">Could not load surf data. Refresh, or try again in a moment.</p>`;
}

init();
