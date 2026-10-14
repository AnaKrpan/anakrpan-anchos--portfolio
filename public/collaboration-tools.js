(function (root) {
  const section = document.querySelector('#collaborations');
  const list = section.querySelector('#collaboration-list');
  let options, active = false;
  function text(el) { return el.innerText ?? el.textContent; }
  function cards() { return Array.from(list.querySelectorAll('.review-card')); }
  function refresh() {
    let populated = 0;
    for (const card of cards()) {
      const brand = text(card.querySelector('[data-role="brand"]')).trim();
      const comment = text(card.querySelector('[data-role="comment"]')).trim();
      card.classList.toggle('empty', !brand && !comment);
      card.classList.toggle('no-comment', !comment);
      card.querySelector('[data-remove-review]').setAttribute('aria-label', brand ? 'Ukloni suradnju: ' + brand : 'Ukloni praznu suradnju');
      if (brand || comment) populated++;
    }
    section.querySelector('.collaboration-empty').hidden = populated > 0;
  }
  function syncEditing(value) {
    active = value;
    section.querySelectorAll('[data-collab-edit]').forEach(el => {
      if (value) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck','true'); }
      else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); }
    });
    refresh();
  }
  function addCard(value = {}) {
    const card = document.createElement('article'); card.className = 'review-card';
    const heading = document.createElement('h3'); heading.dataset.collabEdit = ''; heading.dataset.role = 'brand'; heading.dataset.placeholder = 'Naziv brenda'; heading.setAttribute('aria-label','Naziv brenda'); heading.textContent = value.brand || '';
    const quote = document.createElement('blockquote');
    const comment = document.createElement('p'); comment.dataset.collabEdit = ''; comment.dataset.role = 'comment'; comment.dataset.placeholder = 'Ovdje upiši komentar brenda na tvoje videe'; comment.setAttribute('aria-label','Komentar brenda'); comment.textContent = value.comment || '';
    quote.appendChild(comment);
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.removeReview = ''; remove.className = 'review-remove'; remove.textContent = 'Ukloni suradnju';
    card.append(heading,quote,remove); list.appendChild(card); syncEditing(active); return card;
  }
  function capture() {
    const labels = {};
    section.querySelectorAll('[data-collab-label]').forEach(el => labels[el.dataset.collabLabel] = text(el));
    return { labels, items: cards().map(card => ({ brand:text(card.querySelector('[data-role="brand"]')), comment:text(card.querySelector('[data-role="comment"]')) })) };
  }
  function restore(value) {
    if (!value || !Array.isArray(value.items)) return;
    section.querySelectorAll('[data-collab-label]').forEach(el => { if (typeof value.labels?.[el.dataset.collabLabel] === 'string') el.textContent = value.labels[el.dataset.collabLabel]; });
    list.replaceChildren();
    value.items.slice(0,100).forEach(item => { if (item && typeof item.brand === 'string' && typeof item.comment === 'string') addCard(item); });
    syncEditing(active);
  }
  function changed() { refresh(); options?.onChange(); }
  function init(config) {
    options = config;
    section.querySelector('#add-collaboration').addEventListener('click', () => {
      if (!active) return;
      if (cards().length >= 100) { options.message('Možeš dodati do 100 suradnji.'); return; }
      const card = addCard(); changed(); card.querySelector('h3').focus();
    });
    section.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-review]'); if (!active || !remove) return;
      const card = remove.closest('.review-card');
      const hasContent = text(card.querySelector('h3')).trim() || text(card.querySelector('[data-role="comment"]')).trim();
      if (hasContent && !confirm('Ukloniti ovaj brend i njegov komentar?')) return;
      card.remove(); changed(); section.querySelector('#add-collaboration').focus();
    });
    section.addEventListener('input', event => { if (active && event.target.closest('[data-collab-edit]')) changed(); });
    section.addEventListener('paste', event => {
      const editable = event.target.closest('[data-collab-edit]'); if (!active || !editable) return;
      event.preventDefault(); const selection = getSelection(); if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0); if (!editable.contains(range.commonAncestorContainer)) return;
      range.deleteContents(); const node = document.createTextNode(event.clipboardData.getData('text/plain')); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
    });
    if (!cards().length) for (let i=0;i<3;i++) addCard();
    refresh();
  }
  root.PortfolioCollaborations = { capture, restore, syncEditing, init };
})(globalThis);
