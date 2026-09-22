// Settings-only presentation. Ledger persistence and transaction input stay unchanged.
const settingsEditors = new Map();
const settingsReordering = new Set();
const settingsLists = { paymentMethods: 'paymentMethodsList', assets: 'assetsSettingsList', categories: 'categoriesList' };

function renderManagedSettings(type) {
  if (type === 'paymentMethods') normalizePaymentMethodUsers();
  const container = document.getElementById(settingsLists[type]);
  const sorted = [...state[type]].sort((a, b) =>
    type === 'categories' && a.type !== b.type
      ? (a.type === 'income' ? -1 : 1)
      : (a.displayOrder || 0) - (b.displayOrder || 0));
  container.replaceChildren();
  const button = (label, action, className = 'icon-btn') => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = className; el.textContent = label;
    el.addEventListener('click', action); return el;
  };
  const toolbar = document.createElement('div');
  toolbar.className = 'settings-list-toolbar';
  const reorder = button(settingsReordering.has(type) ? '순서 변경 완료' : '순서 변경', () => {
    settingsReordering.has(type) ? settingsReordering.delete(type) : settingsReordering.add(type);
    renderManagedSettings(type);
  });
  reorder.setAttribute('aria-pressed', String(settingsReordering.has(type)));
  toolbar.append(reorder); container.append(toolbar);
  for (const item of sorted) {
    const card = document.createElement('div');
    card.className = 'settings-item-card managed-setting';
    const heading = document.createElement('div'); heading.className = 'managed-setting-heading';
    const name = document.createElement('div'); name.className = 'item-content item-name';
    name.textContent = (type === 'categories' ? (item.icon || getCategoryIcon(item.name)) + ' ' : '') + item.name;
    const star = button(item.isFavorite ? '★' : '☆', () => toggleFavorite(type, item.id), 'icon-btn' + (item.isFavorite ? ' favorite' : ''));
    star.setAttribute('aria-label', item.name + ' 즐겨찾기'); star.setAttribute('aria-pressed', String(!!item.isFavorite));
    const edit = button(settingsEditors.has(type + ':' + item.id) ? '닫기' : '수정', () => editItem(type, item.id), 'icon-btn edit');
    edit.setAttribute('aria-expanded', String(settingsEditors.has(type + ':' + item.id)));
    edit.setAttribute('aria-label', item.name + ' 수정');
    heading.append(name, star, edit); card.append(heading);
    if (type === 'categories') {
      const meta = document.createElement('div'); meta.className = 'item-meta';
      meta.textContent = item.type === 'income' ? '수입' : '지출'; card.append(meta);
    }
    if (type === 'paymentMethods') {
      const users = document.createElement('div'); users.className = 'payment-user-settings';
      const label = document.createElement('span'); label.className = 'item-meta'; label.textContent = '사용하는 사람'; users.append(label);
      for (const user of state.users) {
        const active = item.userIds.includes(String(user.id));
        const chip = button((active ? '✓ ' : '') + user.name, () => togglePaymentMethodUser(item.id, user.id), 'payment-user-chip' + (active ? ' active' : ''));
        chip.setAttribute('aria-pressed', String(active)); users.append(chip);
      }
      card.append(users);
    }
    if (settingsReordering.has(type)) {
      const actions = document.createElement('div'); actions.className = 'item-actions managed-order';
      const peers = sorted.filter(other => type !== 'categories' || other.type === item.type);
      const index = peers.indexOf(item);
      for (const [label, offset] of [['↑ 위로', -1], ['↓ 아래로', 1]]) {
        const move = button(label, () => {
          const next = index + offset;
          if (next < 0 || next >= peers.length) return;
          [peers[index], peers[next]] = [peers[next], peers[index]];
          peers.forEach((peer, order) => { peer.displayOrder = order + 1; });
          saveData(); renderManagedSettings(type);
        });
        move.disabled = index + offset < 0 || index + offset >= peers.length;
        move.setAttribute('aria-label', item.name + ' ' + label.slice(2)); actions.append(move);
      }
      card.append(actions);
    }
    const key = type + ':' + item.id;
    if (settingsEditors.has(key)) {
      const form = document.createElement('form'); form.className = 'managed-editor';
      const label = document.createElement('label'); label.textContent = '이름';
      const input = document.createElement('input'); input.type = 'text'; input.required = true;
      input.value = settingsEditors.get(key); input.setAttribute('aria-label', '이름');
      input.addEventListener('input', () => settingsEditors.set(key, input.value)); label.append(input);
      const actions = document.createElement('div'); actions.className = 'managed-editor-actions';
      const remove = button('삭제', () => { deleteItem(type, item.id); if (!state[type].some(x => x.id === item.id)) settingsEditors.delete(key); }, 'icon-btn delete');
      const cancel = button('취소', () => { settingsEditors.delete(key); renderManagedSettings(type); });
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-primary'; save.textContent = '이름 저장';
      actions.append(remove, cancel, save); form.append(label, actions);
      form.addEventListener('submit', event => {
        event.preventDefault();
        const newName = input.value.trim(); if (!newName) { input.focus(); return; }
        const current = state[type].find(x => x.id === item.id); if (!current) return;
        current.name = newName; // Renaming must not unexpectedly replace a category's icon.
        settingsEditors.delete(key); saveData(); renderAll();
      });
      card.append(form);
    }
    container.append(card);
  }
}

function editItem(type, id) {
  const item = state[type].find(x => x.id === id); if (!item) return;
  const key = type + ':' + id;
  settingsEditors.has(key) ? settingsEditors.delete(key) : settingsEditors.set(key, item.name);
  renderManagedSettings(type);
}

function renderPaymentMethodsSettings() { renderManagedSettings('paymentMethods'); }
function renderAssetsSettings() { renderManagedSettings('assets'); }
function renderCategoriesSettings() { renderManagedSettings('categories'); }
