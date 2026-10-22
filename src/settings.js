import { normalizePattern } from './sites.js';
import * as store from './store.js';

/**
 * Configuration page: choose which sites are guarded, optionally restrict
 * each one's reason to a fixed list, and toggle the unlock-time prompt.
 */

const $ = (id) => document.getElementById(id);
const sitesList = $('sites');
const addInput = $('addInput');
const addHint = $('addHint');
const defaultHint = addHint.textContent;

let settings;

async function save() {
  await store.saveSettings(settings);
}

function render() {
  sitesList.replaceChildren(...settings.sites.map(siteRow));
  if (settings.sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty muted';
    empty.textContent = 'No sites guarded yet. Add one above, or use "Guard this site" in the toolbar popup.';
    sitesList.append(empty);
  }
}

function siteRow(site) {
  const row = $('siteTemplate').content.firstElementChild.cloneNode(true);
  row.querySelector('.site-name').textContent = site.pattern;

  row.querySelector('.remove').addEventListener('click', async () => {
    settings.sites = settings.sites.filter((s) => s !== site);
    await save();
    render();
  });

  const toggle = row.querySelector('.excuses-toggle');
  const panel = row.querySelector('.excuses');
  toggle.checked = site.excusesEnabled;
  panel.hidden = !site.excusesEnabled;
  toggle.addEventListener('change', async () => {
    site.excusesEnabled = toggle.checked;
    panel.hidden = !toggle.checked;
    await save();
  });

  const list = panel.querySelector('ul');
  const renderExcuses = () => {
    list.replaceChildren(
      ...site.excuses.map((excuse, index) => {
        const item = document.createElement('li');
        const text = document.createElement('span');
        text.textContent = excuse;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove reason "${excuse}"`);
        remove.addEventListener('click', async () => {
          site.excuses.splice(index, 1);
          await save();
          renderExcuses();
        });
        item.append(text, remove);
        return item;
      }),
    );
    panel.querySelector('.no-excuses').hidden = site.excuses.length > 0;
  };
  renderExcuses();

  const excuseForm = panel.querySelector('form');
  const excuseInput = excuseForm.querySelector('input');
  excuseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const excuse = excuseInput.value.trim();
    if (!excuse || site.excuses.includes(excuse)) return;
    site.excuses.push(excuse);
    excuseInput.value = '';
    await save();
    renderExcuses();
  });

  return row;
}

$('addForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pattern = normalizePattern(addInput.value);
  addHint.classList.remove('error');
  if (!pattern) {
    addHint.textContent = `"${addInput.value.trim()}" doesn't look like a site. Try something like youtube.com.`;
    addHint.classList.add('error');
    return;
  }
  if (settings.sites.some((s) => s.pattern === pattern)) {
    addHint.textContent = `${pattern} is already guarded.`;
    return;
  }
  settings.sites.push(store.newSite(pattern));
  await save();
  addInput.value = '';
  addHint.textContent = defaultHint;
  render();
});

$('unlockPrompt').addEventListener('change', async (event) => {
  settings.unlockPrompt = event.target.checked;
  await save();
});

async function load() {
  settings = await store.getSettings();
  $('unlockPrompt').checked = settings.unlockPrompt;
  render();
}

// Pick up sites added from the toolbar popup while this page is open,
// rather than overwriting them on the next save here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings && JSON.stringify(changes.settings.newValue) !== JSON.stringify(settings)) {
    load();
  }
});

load();
