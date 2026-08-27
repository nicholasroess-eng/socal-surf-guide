/** Board types and wave-height matching for quiver filtering. */

export const BOARDS = [
  {
    id: 'longboard',
    name: 'Longboard',
    label: '9\'+',
    minWave: 1,
    maxWave: 5,
    idealMin: 1,
    idealMax: 4,
    emoji: '🏄‍♂️',
    tone: 'good',
  },
  {
    id: 'midlength',
    name: 'Mid-Length',
    label: '7\'–8\'',
    minWave: 2,
    maxWave: 6,
    idealMin: 2,
    idealMax: 5,
    emoji: '🏄',
    tone: 'good',
  },
  {
    id: 'shortboard',
    name: 'Shortboard',
    label: '6\' and under',
    minWave: 3,
    maxWave: 8,
    idealMin: 3,
    idealMax: 6,
    emoji: '🤙',
    tone: 'big',
  },
  {
    id: 'fish',
    name: 'Fish',
    label: 'Twin fin',
    minWave: 1.5,
    maxWave: 5,
    idealMin: 2,
    idealMax: 4,
    emoji: '🐟',
    tone: 'good',
  },
  {
    id: 'bodyboard',
    name: 'Bodyboard',
    label: 'Boogie',
    minWave: 2,
    maxWave: 12,
    idealMin: 3,
    idealMax: 8,
    emoji: '🏄',
    tone: 'big',
  },
];

const STORAGE_KEY = 'socal-surf-quiver';

export function getBoard(id) {
  return BOARDS.find((b) => b.id === id);
}

export function loadQuiver() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const ids = JSON.parse(raw);
    return ids.filter((id) => BOARDS.some((b) => b.id === id));
  } catch {
    return [];
  }
}

export function saveQuiver(boardIds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(boardIds));
}

function gradientFill(uid) {
  return `
    <linearGradient id="${uid}" x1="24" y1="156" x2="24" y2="8" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFC736"/>
      <stop offset="0.5" stop-color="#FF8A1E"/>
      <stop offset="1" stop-color="#E5342A"/>
    </linearGradient>
  `;
}

function boardMark(outline, stringer, extra = '') {
  const uid = `g-${Math.random().toString(36).slice(2, 8)}`;
  return `
    <svg viewBox="0 0 48 160" aria-hidden="true" class="board-svg">
      <defs>${gradientFill(uid)}</defs>
      <path fill="url(#${uid})" d="${outline}"/>
      <path fill="none" stroke="#1E1815" stroke-opacity=".28" stroke-width="0.7" d="${stringer}"/>
      ${extra}
    </svg>
  `;
}

export function boardSvg(id) {
  if (id === 'longboard') {
    return boardMark(
      'M24 6C35 6 39 22 39.4 52c.5 34-1.5 74-9 100.5C28.8 158 26 160 24 160s-4.8-2-6.4-7.5C10.1 126 8.1 86 8.6 52 9 22 13 6 24 6Z',
      'M24 16v128'
    );
  }
  if (id === 'midlength') {
    return boardMark(
      'M24 28C37 28 41 46 41 68C41 98 38 124 34 136C31 142 27 144 24 144C21 144 17 142 14 136C10 124 7 98 7 68C7 46 11 28 24 28Z',
      'M24 38v98'
    );
  }
  if (id === 'shortboard') {
    return boardMark(
      'M24 12C32 16 43 32 44 58C44 90 43 122 41 136C40 144 33 148 24 148C15 148 8 144 7 136C5 122 4 90 4 58C5 32 16 16 24 12Z',
      'M24 22v118'
    );
  }
  if (id === 'fish') {
    return boardMark(
      'M24 6C30 10 44 28 45 58C45 88 43 118 42 136L42 152L24 128L6 152L6 136C5 118 3 88 3 58C4 28 18 10 24 6Z',
      'M24 20v106'
    );
  }
  return boardMark(
    'M6 28C6 16 14 12 24 12C34 12 42 16 42 28L42 76C42 82 34 86 24 86C14 86 6 82 6 76Z',
    'M24 22v56',
    '<circle cx="32" cy="22" r="1.6" fill="#1E1815" fill-opacity=".45"/>'
  );
}

/** Score how well a board fits the current wave height (higher = better). */
function boardFitScore(board, waveFt) {
  if (waveFt < board.minWave || waveFt > board.maxWave) return -1;
  const mid = (board.idealMin + board.idealMax) / 2;
  const half = (board.idealMax - board.idealMin) / 2 || 1;
  const dist = Math.abs(waveFt - mid) / half;
  return Math.max(0, 100 - dist * 40);
}

/** Pick the best board for wave height, quiver, and what this break allows. */
export function recommendFromQuiver(waveFt, quiverIds, allowedIds = null) {
  if (waveFt < 1) {
    return {
      activity: 'Swimming',
      board: 'Swimming',
      boardId: null,
      emoji: '🏊',
      tone: 'flat',
      summary: 'Flat conditions — better for a swim or rest day.',
      fromQuiver: false,
    };
  }

  const allowed = allowedIds?.length ? allowedIds : BOARDS.map((b) => b.id);
  const pool = quiverIds?.length
    ? quiverIds.filter((id) => allowed.includes(id))
    : allowed;

  if (quiverIds?.length && !pool.length) {
    return {
      activity: 'Wrong break for your quiver',
      board: 'This spot does not match your boards',
      boardId: null,
      emoji: '',
      tone: 'flat',
      summary: 'None of the boards in your quiver belong at this break.',
      fromQuiver: true,
    };
  }

  const candidates = pool
    .map((id) => getBoard(id))
    .filter(Boolean)
    .map((board) => ({ board, score: boardFitScore(board, waveFt) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return {
      activity: 'No match',
      board: 'Not a fit for these waves',
      boardId: null,
      emoji: '',
      tone: 'flat',
      summary: `${waveFt.toFixed(1)} ft does not suit the craft this break allows.`,
      fromQuiver: true,
    };
  }

  const best = candidates[0].board;
  return {
    activity: best.name,
    board: best.name,
    boardId: best.id,
    emoji: best.emoji,
    tone: best.tone,
    summary: `${waveFt.toFixed(1)} ft — ${best.name} is the call here.`,
    fromQuiver: Boolean(quiverIds?.length),
  };
}

/** Boards that fit this wave height, quiver, and break. */
export function matchingBoards(waveFt, quiverIds, allowedIds = null) {
  const allowed = allowedIds?.length ? allowedIds : BOARDS.map((b) => b.id);
  const pool = quiverIds?.length
    ? quiverIds.filter((id) => allowed.includes(id))
    : allowed;

  return pool
    .map((id) => getBoard(id))
    .filter(Boolean)
    .filter((b) => waveFt >= b.minWave && waveFt <= b.maxWave);
}
