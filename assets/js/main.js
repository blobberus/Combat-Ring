// Boot: config -> password gate (Stone-Wardens' vault) -> data repo -> live table room -> the ring.
import { loadConfig, config, fetchSiteVault, unlockSite, saveAuth, loadAuth, clearAuth } from './core/auth.js';
import { repo, backendFor } from './core/repo.js';
import { roomKeys } from './core/crypto.js';
import { applyTheme } from './core/settings.js';
import { h, $, clear } from './core/dom.js';
import { toast } from './core/ui.js';
import { world } from './ring/world.js';
import { startPartyWatch } from './ring/characters.js';
import { restoreTableIfEmpty, restoreDmBackup, startPersistence, stopPersistence, saveNow } from './ring/persist.js';
import { startProjector, stopProjector } from './ring/projector.js';
import { restoreDm, setDmHooks } from './ring/dm.js';
import { mountRing } from './ring/app.js';
import { seedSandbox } from './ring/sandbox-seed.js';

const isLocalhost = ['localhost', '127.0.0.1', ''].includes(location.hostname);

applyTheme();
boot().catch((e) => { console.error(e); showGate(e.message || String(e)); });

async function boot() {
  await loadConfig();
  applyTheme();
  const params = new URLSearchParams(location.search);
  if (params.has('sandbox')) return enter(null, true);
  const saved = loadAuth();
  if (saved?.token) {
    try { return await enter(saved, false); } catch (e) {
      console.error(e);
      if (e.status === 401) clearAuth();
      return showGate(e.message);
    }
  }
  return showGate();
}

async function showGate(error) {
  const gate = $('#gate');
  const form = $('#gate-form');
  const pass = $('#gate-pass');
  const err = $('.gate-error', gate);
  const note = $('.gate-note', gate);
  const btn = $('.gate-enter', gate);
  gate.hidden = false;
  $('#app').hidden = true;
  const showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
  showError(error || '');
  const found = await fetchSiteVault();
  if (!found) {
    pass.disabled = true;
    btn.disabled = true;
    clear(note).append(
      'The Stone Wardens site has not been set up yet (no vault.json), so the ring has no key either.',
      isLocalhost ? h('span', null, ' Try the ', h('a', { href: '?sandbox' }, 'local sandbox'), '.') : null,
    );
    return;
  }
  clear(note).append('The same password as the Stone Wardens site.');
  pass.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!pass.value) return;
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    showError('');
    try {
      const auth = await unlockSite(found.vault, pass.value);
      saveAuth(auth, $('#gate-remember').checked);
      pass.value = '';
      await enter(auth, false);
    } catch (ex) {
      if (ex.message !== 'bad-password') console.error(ex);
      if (ex.status === 401) clearAuth();
      showError(ex.message === 'bad-password' ? 'That is not the password. The wardens keep their counsel.' : ex.message);
      pass.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enter';
    }
  };
}

async function enter(auth, sandbox) {
  repo.use(backendFor(auth, sandbox));
  const app = $('#app');
  $('#gate').hidden = true;
  app.hidden = false;
  clear(app).append(h('div', { class: 'rg-loading' }, h('span', { class: 'spinner' }), h('p', null, 'Setting the table…')));
  try {
    await repo.tree(true);
    if (sandbox) await seedSandbox();
  } catch (e) {
    app.hidden = true;
    $('#gate').hidden = false;
    throw e;
  }
  world.init({ brokers: config.brokers, local: sandbox });
  const keys = await roomKeys(sandbox ? 'combat-ring-sandbox' : auth.token, 'table');
  await world.bus.addRoom('table', keys);
  await restoreTableIfEmpty();
  startPartyWatch();
  setDmHooks({
    start: async () => { await restoreDmBackup(); startProjector(); startPersistence(); },
    stop: async () => { stopProjector(); stopPersistence(); await saveNow().catch(() => {}); },
  });
  clear(app);
  mountRing(app, { sandbox });
  await restoreDm();
  if (sandbox) toast('Sandbox: everything stays in this browser. Open a second tab to play both sides.', { timeout: 7000 });
}
