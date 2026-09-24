/** Profile login. Beaches and boards persist only for a signed-in user. */

const TOKEN_KEY = 'sesh-session';

const els = {
  btn: document.getElementById('account-btn'),
  avatar: document.getElementById('account-avatar'),
  fallback: document.getElementById('account-fallback'),
  label: document.getElementById('account-label'),
  menu: document.getElementById('account-menu'),
  menuName: document.getElementById('account-menu-name'),
  menuEmail: document.getElementById('account-menu-email'),
  editBtn: document.getElementById('account-edit-btn'),
  signOutBtn: document.getElementById('account-signout-btn'),
  authModal: document.getElementById('auth-modal'),
  authForm: document.getElementById('auth-form'),
  authTitle: document.getElementById('auth-modal-title'),
  authCopy: document.getElementById('auth-modal-copy'),
  authNameLabel: document.getElementById('auth-name-label'),
  authName: document.getElementById('auth-name'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authStatus: document.getElementById('auth-status'),
  authSwitch: document.getElementById('auth-switch-btn'),
  authSubmit: document.getElementById('auth-submit-btn'),
  profileModal: document.getElementById('profile-modal'),
  profileForm: document.getElementById('profile-form'),
  profilePhotoBtn: document.getElementById('profile-photo-btn'),
  profilePhoto: document.getElementById('profile-photo'),
  profilePhotoFallback: document.getElementById('profile-photo-fallback'),
  profilePhotoInput: document.getElementById('profile-photo-input'),
  profilePhotoClear: document.getElementById('profile-photo-clear'),
  profileName: document.getElementById('profile-name'),
  profileEmail: document.getElementById('profile-email'),
  profileStatus: document.getElementById('profile-status'),
  profileSave: document.getElementById('profile-save-btn'),
};

let token = null;
let user = null;
let mode = 'login';
let prefsSource = () => ({ favoriteIds: [], quiverIds: [] });
let pendingAvatar = undefined;
const listeners = [];

function escapeText(value) {
  return String(value || '');
}

export function isSignedIn() {
  return Boolean(user && token);
}

export function getUser() {
  return user;
}

export function setPrefsSource(fn) {
  prefsSource = fn;
}

export function onAccount(fn) {
  listeners.push(fn);
}

export function accountModalOpen() {
  return (els.authModal && !els.authModal.hidden) || (els.profileModal && !els.profileModal.hidden);
}

function notify() {
  listeners.forEach((fn) => fn(user));
}

function setAuthStatus(msg, type = 'info') {
  if (!els.authStatus) return;
  els.authStatus.textContent = msg;
  els.authStatus.dataset.type = type;
}

function setProfileStatus(msg, type = 'info') {
  if (!els.profileStatus) return;
  els.profileStatus.textContent = msg;
  els.profileStatus.dataset.type = type;
}

async function api(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not reach your profile');
  return data;
}

function initial(name) {
  const letter = String(name || '').trim().charAt(0).toUpperCase();
  return letter || '?';
}

function paintFace(img, fallback, name, avatar) {
  const safe = typeof avatar === 'string' && avatar.startsWith('data:image/') ? avatar : '';
  if (safe) {
    img.src = safe;
    img.hidden = false;
    fallback.hidden = true;
    fallback.textContent = '';
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = initial(name);
  }
}

function paintAccount() {
  if (!els.btn) return;
  const signedIn = isSignedIn();
  els.btn.classList.toggle('is-guest', !signedIn);
  els.btn.classList.toggle('is-user', signedIn);
  els.label.hidden = signedIn;
  if (!signedIn) {
    els.avatar.hidden = true;
    els.fallback.hidden = true;
    els.label.textContent = 'Sign in';
    els.btn.setAttribute('aria-label', 'Sign in');
    els.btn.setAttribute('aria-haspopup', 'dialog');
    els.menu.hidden = true;
    return;
  }
  paintFace(els.avatar, els.fallback, user.name, user.avatar);
  els.btn.setAttribute('aria-label', `Profile, ${user.name}`);
  els.btn.setAttribute('aria-haspopup', 'menu');
  els.menuName.textContent = escapeText(user.name);
  els.menuEmail.textContent = escapeText(user.email);
}

function lockModal(modal) {
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function unlockModal(modal) {
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  if (!accountModalOpen()) {
    const others = document.querySelectorAll('.quiver-modal');
    const anyOpen = [...others].some((el) => !el.hidden);
    if (!anyOpen) document.body.classList.remove('modal-open');
  }
}

function setAuthMode(next) {
  mode = next;
  const creating = mode === 'signup';
  els.authTitle.textContent = creating ? 'Create a profile' : 'Sign in';
  els.authCopy.textContent = creating
    ? 'A profile keeps your beaches, boards, and photo. SESH asks again each visit until you have one.'
    : 'Your beaches and boards stay on this profile.';
  els.authNameLabel.hidden = !creating;
  els.authName.required = creating;
  els.authPassword.setAttribute('autocomplete', creating ? 'new-password' : 'current-password');
  els.authSwitch.textContent = creating ? 'I have a profile' : 'Create a profile';
  els.authSubmit.textContent = creating ? 'Create profile' : 'Sign in';
  setAuthStatus('');
}

export function openAuthModal() {
  if (!els.authModal) return;
  els.menu.hidden = true;
  setAuthMode('login');
  els.authPassword.value = '';
  lockModal(els.authModal);
  els.authEmail.focus();
}

function closeAuthModal() {
  if (!els.authModal) return;
  unlockModal(els.authModal);
}

function paintProfilePhoto() {
  const avatar = pendingAvatar === undefined ? user?.avatar : pendingAvatar;
  const name = els.profileName.value || user?.name || '';
  paintFace(els.profilePhoto, els.profilePhotoFallback, name, avatar);
  els.profilePhotoClear.hidden = !avatar;
}

export function openProfileModal() {
  if (!els.profileModal || !user) return;
  els.menu.hidden = true;
  pendingAvatar = undefined;
  els.profileName.value = user.name || '';
  els.profileEmail.textContent = user.email || '';
  els.profilePhotoInput.value = '';
  setProfileStatus('');
  paintProfilePhoto();
  lockModal(els.profileModal);
  els.profileName.focus();
}

function closeProfileModal() {
  if (!els.profileModal) return;
  unlockModal(els.profileModal);
}

export function closeAccountModals() {
  closeAuthModal();
  closeProfileModal();
  if (els.menu) els.menu.hidden = true;
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Choose a photo.'));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const scale = Math.min(max / img.width, max / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let quality = 0.86;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > 140000 && quality > 0.5) {
        quality -= 0.12;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (data.length > 180000) reject(new Error('That photo is too large. Try a smaller one.'));
      else resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

async function finishAuth(data) {
  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  user = data.user;
  const session = prefsSource() || { favoriteIds: [], quiverIds: [] };
  const accountEmpty = !(user.favoriteIds || []).length && !(user.quiverIds || []).length;
  const sessionHasPrefs = (session.favoriteIds || []).length || (session.quiverIds || []).length;
  if (accountEmpty && sessionHasPrefs) {
    const saved = await api('PUT', '/api/auth/profile', {
      favoriteIds: session.favoriteIds || [],
      quiverIds: session.quiverIds || [],
    });
    user = saved.user;
  }
  paintAccount();
  closeAuthModal();
  notify();
}

async function submitAuth(event) {
  event.preventDefault();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const name = els.authName.value.trim();
  if (mode === 'signup' && !name) {
    setAuthStatus('Add your name.', 'error');
    return;
  }
  els.authSubmit.disabled = true;
  setAuthStatus(mode === 'signup' ? 'Creating your profile…' : 'Signing in…');
  try {
    const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const body = mode === 'signup' ? { name, email, password } : { email, password };
    const data = await api(path === '/api/auth/signup' ? 'POST' : 'POST', path, body);
    await finishAuth(data);
  } catch (err) {
    setAuthStatus(err.message || 'Could not sign in.', 'error');
  } finally {
    els.authSubmit.disabled = false;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!isSignedIn()) return;
  const name = els.profileName.value.trim();
  if (!name) {
    setProfileStatus('Add your name.', 'error');
    return;
  }
  els.profileSave.disabled = true;
  setProfileStatus('Saving…');
  try {
    const body = { name };
    if (pendingAvatar !== undefined) body.avatar = pendingAvatar;
    const data = await api('PUT', '/api/auth/profile', body);
    user = data.user;
    pendingAvatar = undefined;
    paintAccount();
    setProfileStatus('Saved.', 'ok');
  } catch (err) {
    setProfileStatus(err.message || 'Could not save your profile.', 'error');
  } finally {
    els.profileSave.disabled = false;
  }
}

async function signOut() {
  const current = token;
  token = null;
  user = null;
  localStorage.removeItem(TOKEN_KEY);
  paintAccount();
  closeAccountModals();
  if (current) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${current}` },
      });
    } catch {
      /* local sign-out still stands */
    }
  }
  notify();
}

export async function persistPrefs(favoriteIds, quiverIds) {
  if (!isSignedIn()) return null;
  const data = await api('PUT', '/api/auth/profile', { favoriteIds, quiverIds });
  user = data.user;
  paintAccount();
  return user;
}

export async function bootAccount() {
  paintAccount();
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return null;
    token = saved;
    const data = await api('GET', '/api/auth/me');
    user = data.user;
    paintAccount();
    return user;
  } catch {
    token = null;
    user = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    paintAccount();
    return null;
  }
}

function toggleMenu() {
  els.menu.hidden = !els.menu.hidden;
}

export function setupAccount() {
  if (!els.btn) return;
  els.btn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isSignedIn()) openAuthModal();
    else toggleMenu();
  });
  els.editBtn.addEventListener('click', openProfileModal);
  els.signOutBtn.addEventListener('click', () => {
    signOut().catch(() => {});
  });
  els.authForm.addEventListener('submit', (event) => {
    submitAuth(event).catch(() => {});
  });
  els.authSwitch.addEventListener('click', () => {
    setAuthMode(mode === 'login' ? 'signup' : 'login');
  });
  els.authModal.querySelectorAll('[data-close-auth]').forEach((el) => {
    el.addEventListener('click', closeAuthModal);
  });
  els.profileForm.addEventListener('submit', (event) => {
    saveProfile(event).catch(() => {});
  });
  els.profilePhotoBtn.addEventListener('click', () => els.profilePhotoInput.click());
  els.profilePhotoInput.addEventListener('change', () => {
    const file = els.profilePhotoInput.files && els.profilePhotoInput.files[0];
    if (!file) return;
    readPhoto(file)
      .then((data) => {
        pendingAvatar = data;
        paintProfilePhoto();
        setProfileStatus('');
      })
      .catch((err) => setProfileStatus(err.message || 'Could not use that photo.', 'error'));
  });
  els.profilePhotoClear.addEventListener('click', () => {
    pendingAvatar = null;
    els.profilePhotoInput.value = '';
    paintProfilePhoto();
  });
  els.profileName.addEventListener('input', paintProfilePhoto);
  els.profileModal.querySelectorAll('[data-close-profile]').forEach((el) => {
    el.addEventListener('click', closeProfileModal);
  });
  document.addEventListener('click', () => {
    if (els.menu) els.menu.hidden = true;
  });
  els.menu.addEventListener('click', (event) => event.stopPropagation());
}
