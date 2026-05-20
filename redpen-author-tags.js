/* redpen — author mode: tags
 *
 * The tag chip multi-select inside the comment editor and the standalone tag
 * manager modal (full CRUD). Tag lookup helpers live in
 * redpen-author-core.js; see it for the shared namespace contract.
 */

(function () {
  'use strict';

  const R = window.Redpen;
  const state = R.state;
  const el = R.el;

  /** Render the multi-select chip list inside the comment modal. */
  function renderTagChips() {
    el.tagChips.innerHTML = '';
    for (const t of state.submission.tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.dataset.tagId = t.id;
      chip.style.setProperty('--tag-color', t.color);
      const selected = state.editingTagIds.indexOf(t.id) !== -1;
      if (selected) chip.classList.add('selected');
      chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const dot = document.createElement('span');
      dot.className = 'tag-chip-dot';
      dot.style.background = t.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(t.label));
      chip.addEventListener('click', function () {
        toggleEditingTag(t.id);
      });
      el.tagChips.appendChild(chip);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tag-chip tag-chip-add';
    addBtn.textContent = '+ Tag';
    addBtn.addEventListener('click', showNewTagForm);
    el.tagChips.appendChild(addBtn);
  }

  function toggleEditingTag(id) {
    const idx = state.editingTagIds.indexOf(id);
    if (idx === -1) state.editingTagIds.push(id);
    else state.editingTagIds.splice(idx, 1);
    renderTagChips();
  }

  function showNewTagForm() {
    el.newTagForm.classList.remove('hidden');
    el.newTagLabel.value = '';
    el.newTagColor.value = pickNextDefaultColor();
    el.newTagLabel.focus();
  }

  function hideNewTagForm() {
    el.newTagForm.classList.add('hidden');
  }

  /** Cycle through a palette so new tags don't all come out as the same blue. */
  function pickNextDefaultColor() {
    const palette = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    const used = new Set(state.submission.tags.map(function (t) { return t.color.toLowerCase(); }));
    for (const c of palette) if (!used.has(c.toLowerCase())) return c;
    return palette[state.submission.tags.length % palette.length];
  }

  function createTagFromForm() {
    const label = el.newTagLabel.value.trim();
    if (!label) { el.newTagLabel.focus(); return; }
    const color = el.newTagColor.value || '#3498db';
    const tag = { id: R.uuid(), label: label, color: color };
    state.submission.tags.push(tag);
    state.submission.updatedAt = Date.now();
    // Auto-select the newly-created tag on the annotation being edited.
    if (!el.modalBackdrop.classList.contains('hidden')) {
      state.editingTagIds.push(tag.id);
    }
    hideNewTagForm();
    renderTagChips();
    if (!el.tagModalBackdrop.classList.contains('hidden')) renderTagRows();
  }

  // ------------------------------------------------------------------
  // Tag manager modal
  // ------------------------------------------------------------------

  function openTagManager() {
    renderTagRows();
    el.tagModalBackdrop.classList.remove('hidden');
    // Focus the first label input so keyboard editing is immediate.
    setTimeout(function () {
      const first = el.tagRows.querySelector('.tag-label-input');
      if (first) first.focus();
    }, 0);
  }

  function closeTagManager() {
    el.tagModalBackdrop.classList.add('hidden');
    // Re-render anything that depends on tags since we may have renamed /
    // recoloured / deleted tags.
    R.renderCodeView();
    R.renderAnnotationList();
    if (!el.modalBackdrop.classList.contains('hidden')) {
      // Drop any editingTagIds that no longer exist.
      state.editingTagIds = state.editingTagIds.filter(function (id) { return !!R.getTagById(id); });
      renderTagChips();
    }
  }

  function renderTagRows() {
    el.tagRows.innerHTML = '';
    for (const t of state.submission.tags) el.tagRows.appendChild(buildTagRow(t));
  }

  function buildTagRow(tag) {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.dataset.tagId = tag.id;

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'tag-swatch';
    swatch.value = tag.color;
    swatch.setAttribute('aria-label', 'Color for ' + tag.label);
    swatch.addEventListener('input', function () {
      tag.color = swatch.value;
      state.submission.updatedAt = Date.now();
    });
    row.appendChild(swatch);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'tag-label-input';
    labelInput.value = tag.label;
    labelInput.maxLength = 40;
    labelInput.setAttribute('aria-label', 'Tag name');
    labelInput.addEventListener('input', function () {
      tag.label = labelInput.value;
      state.submission.updatedAt = Date.now();
    });
    row.appendChild(labelInput);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tag-delete';
    del.title = 'Delete tag';
    del.setAttribute('aria-label', 'Delete tag ' + tag.label);
    del.textContent = '×';
    del.addEventListener('click', function () { deleteTag(tag.id); });
    row.appendChild(del);
    return row;
  }

  function deleteTag(id) {
    const usage = state.submission.annotations.reduce(function (acc, a) {
      return acc + ((a.tagIds || []).indexOf(id) !== -1 ? 1 : 0);
    }, 0);
    if (usage > 0) {
      const msg = 'This tag is applied to ' + usage +
        (usage === 1 ? ' annotation' : ' annotations') +
        '. Remove it from all of them and delete the tag?';
      if (!window.confirm(msg)) return;
    }
    state.submission.tags = state.submission.tags.filter(function (t) { return t.id !== id; });
    for (const a of state.submission.annotations) {
      if (!a.tagIds) continue;
      a.tagIds = a.tagIds.filter(function (tid) { return tid !== id; });
    }
    state.submission.updatedAt = Date.now();
    renderTagRows();
  }

  function addNewTagRow() {
    const tag = { id: R.uuid(), label: 'New tag', color: pickNextDefaultColor() };
    state.submission.tags.push(tag);
    state.submission.updatedAt = Date.now();
    renderTagRows();
    // Focus and select the label of the newly-added row so it's immediately
    // rename-ready.
    const row = el.tagRows.querySelector('[data-tag-id="' + R.cssEscape(tag.id) + '"] .tag-label-input');
    if (row) { row.focus(); row.select(); }
  }

  R.renderTagChips = renderTagChips;
  R.hideNewTagForm = hideNewTagForm;
  R.createTagFromForm = createTagFromForm;
  R.openTagManager = openTagManager;
  R.closeTagManager = closeTagManager;
  R.addNewTagRow = addNewTagRow;
})();
