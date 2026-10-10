import { setupAudio } from '/scripts/essay.js';
import { initializeConnection, authorizationHeaders, oauthConsent } from '/connection.js';
import { installReview } from '/proposals.js';

const $ = id => document.getElementById(id);
const fields = ['title', 'subtitle', 'author', 'date', 'description', 'action', 'status', 'summary', 'body'];
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const words = text => text.trim().split(/\s+/).filter(Boolean).length;
const normalize = text => text.replace(/\s+/g, ' ').trim();
let current, dirty = false, editVersion = 0, renderVersion = 0;
let renderTimer, noticeTimer, pendingImport, selected, revisionSource, audioHash = '', activeField = 'body', panel;
let imagePosition = 0, audioPoll, renderedCharacters = 0, busySaving = false, uploading = false;
let connection = { hosted: false }, review;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...await authorizationHeaders(), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function notice(message, error = false) {
  clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 18000 : 7000);
}
const handle = callback => async event => { try { await callback(event); } catch (error) { notice(error.message, true); } };
function collect() {
  const metadata = { ...current.metadata };
  for (const field of fields) if (field !== 'body') metadata[field] = $(field).value;
  metadata.draft = true;
  return { metadata, body: $('body').value };
}
function recoveryKey(slug) { return `unreal-studio:${slug}`; }
function remember() {
  try { localStorage.setItem(recoveryKey(current.slug), JSON.stringify({ ...current, ...collect() })); } catch { /* Disk save remains the durable copy. */ }
}
function forget() { try { localStorage.removeItem(recoveryKey(current.slug)); } catch { /* Storage can be disabled. */ } }
function change() {
  if (!current) return;
  dirty = true; editVersion++; $('save-state').textContent = 'Unsaved changes'; $('save').disabled = false;
  remember(); updateCounts(); clearTimeout(renderTimer); renderTimer = setTimeout(() => render().catch(error => notice(error.message, true)), 350);
}
function updateCounts() {
  const count = words($('summary').value);
  $('word-count').textContent = `${words($('body').value).toLocaleString()} words`;
  $('summary-count').textContent = `${count} / 180 words`;
  $('summary-count').classList.toggle('over-limit', count > 180);
  $('comment-count').textContent = current.comments.filter(comment => !comment.resolved).length;
  $('draft-label').textContent = $('status').value || 'Draft';
}
async function render() {
  if (!current) return;
  const version = ++renderVersion, edits = editVersion, slug = current.slug;
  const result = await api('/api/render', { method: 'POST', body: JSON.stringify(collect()) });
  if (version !== renderVersion || slug !== current.slug || edits !== editVersion) return;
  audioHash = result.narrationHash; renderedCharacters = result.narrationCharacters;
  // Do not interrupt an attached recording while typing unless its player changed.
  const oldPlayer = $('preview').querySelector('[data-audio-player]');
  const oldAudio = oldPlayer?.querySelector('audio');
  const oldState = oldAudio ? { time: oldAudio.currentTime, paused: oldAudio.paused, src: oldAudio.getAttribute('src'), rate: oldAudio.playbackRate } : null;
  const scroll = document.querySelector('.preview-pane').scrollTop;
  $('preview').innerHTML = result.html;
  if (document.querySelector('.writing-area').dataset.mode !== 'read') $('preview').querySelectorAll('.essay-outline details').forEach(item => { item.open = false; });
  setupAudio($('preview'));
  const newAudio = $('preview').querySelector('audio');
  if (oldState && newAudio && newAudio.getAttribute('src') === oldState.src) {
    newAudio.currentTime = oldState.time; newAudio.playbackRate = oldState.rate;
    if (!oldState.paused) newAudio.play().catch(() => {});
  }
  document.querySelector('.preview-pane').scrollTop = scroll;
  $('audio-characters').textContent = renderedCharacters.toLocaleString();
  renderComments(); renderAudio();
}
async function library() {
  const essays = await api('/api/essays');
  $('essay-count').textContent = String(essays.length).padStart(2, '0');
  $('essay-list').innerHTML = essays.map(essay => `<button class="library-item" data-slug="${essay.slug}" aria-current="${essay.slug === current?.slug}"><strong>${escape(essay.title)}</strong><span>${escape(essay.error ? 'Needs attention' : essay.status)}${essay.published ? ' · Release prepared' : ''}</span></button>`).join('');
  return essays;
}
function fill(document) {
  current = document;
  for (const field of fields) $(field).value = field === 'body' ? document.body : document.metadata[field] || '';
  if (!$('status').value) $('status').value = 'Draft';
  $('filename').textContent = `${document.slug}.md`;
  $('save-state').textContent = connection.hosted ? 'Saved to your private workspace' : 'Saved on this computer'; $('save').disabled = true;
  $('document').hidden = false; $('empty-state').hidden = true; dirty = false; editVersion++;
  updateCounts();
}
async function openEssay(slug) {
  if (busySaving || uploading) throw new Error('Wait for the current save or upload to finish before switching essays.');
  if (dirty && !confirm('You have unsaved edits. Switch essays and leave those edits in browser recovery?')) return;
  const document = await api(`/api/essays/${slug}`);
  clearTimeout(renderTimer); clearTimeout(audioPoll); selected = null; $('comment-form').hidden = true;
  fill(document);
  try {
    const recovery = JSON.parse(localStorage.getItem(recoveryKey(slug)) || 'null');
    if (recovery && (recovery.revision === document.revision || confirm('An unsaved browser copy exists, but the file has changed. Recover that copy for review? Export it before reloading to resolve a save conflict.'))) {
      fill(recovery); dirty = true; $('save-state').textContent = 'Recovered unsaved edits'; $('save').disabled = false; notice('Recovered your unsaved browser copy. Save to write it to Markdown.');
    }
  } catch { /* Recovery is optional. */ }
  history.replaceState({}, '', `/${location.search}#${slug}`);
  await render(); await library();
  if (panel === 'history') await loadHistory();
  const job = await api(`/api/essays/${slug}/narration`);
  if (job.state === 'running' || job.state === 'complete') await pollNarration(slug);
  const sample = await api(`/api/essays/${slug}/narration-preview`);
  $('voice-preview').innerHTML = sample ? `<p class="small-note">Voice preview · ${escape(sample.narrator)}</p><audio controls src="${escape(sample.playbackUrl || sample.tracks[0].src)}"></audio>` : '';
  if (sample?.voice_id) { $('voice-id').value = sample.voice_id; $('narrator').value = sample.narrator; }
}
async function save() {
  if (!current) return;
  if (busySaving) throw new Error('A save is already in progress. Please try again when it finishes.');
  busySaving = true; const edits = editVersion;
  $('save').disabled = true; $('save-state').textContent = 'Saving…';
  try {
    const saved = await api(`/api/essays/${current.slug}`, { method: 'PUT', body: JSON.stringify({ ...current, ...collect() }) });
    current.revision = saved.revision; current.commentsRevision = saved.commentsRevision;
    if (edits === editVersion) { current = saved; dirty = false; forget(); $('save-state').textContent = connection.hosted ? 'Saved to your private workspace' : 'Saved on this computer'; }
    else { remember(); $('save-state').textContent = 'Unsaved changes'; }
    await library();
  } catch (error) { $('save-state').textContent = 'Not saved · retry or export'; throw error; }
  finally { busySaving = false; $('save').disabled = !dirty; }
}
async function saveCurrent() { if (dirty) await save(); if (dirty) throw new Error('Finish editing and save before continuing.'); }
async function exportMarkdown() {
  const snapshot = await api('/api/render', { method: 'POST', body: JSON.stringify(collect()) });
  const blob = new Blob([snapshot.source], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${current.slug}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function showPanel(name) {
  panel = name;
  $('review-panel').hidden = !name;
  ['comments', 'audio', 'history'].forEach(value => { $(`${value}-panel`).hidden = value !== name; });
  document.querySelectorAll('[data-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.panel === name)));
  if (name) $('panel-title').textContent = { comments: 'Notes in the margins', audio: 'A voice for the idea', history: 'The revisions' }[name];
}

function textIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; let text = '', node;
  while ((node = walker.nextNode())) { nodes.push({ node, offset: text.length }); text += node.textContent; }
  return { text, nodes };
}
function anchor(text, comment) {
  const raw = []; let normalized = '', wasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text[i]);
    if (!space || !wasSpace) { normalized += space ? ' ' : text[i]; raw.push(i); }
    wasSpace = space;
  }
  const quote = normalize(comment.quote); if (!quote) return null;
  const matches = []; let at = 0;
  while ((at = normalized.indexOf(quote, at)) !== -1) { matches.push(at); at += quote.length; }
  let found = matches.length === 1 ? matches[0] : undefined;
  if (matches.length > 1) {
    const matching = matches.filter(index => (!comment.before || normalized.slice(Math.max(0, index - normalize(comment.before).length), index).trim() === normalize(comment.before)) && (!comment.after || normalized.slice(index + quote.length, index + quote.length + normalize(comment.after).length + 1).trim() === normalize(comment.after)));
    if (matching.length === 1) found = matching[0];
  }
  return found === undefined ? null : { start: raw[found], end: raw[found + quote.length - 1] + 1 };
}
function captureSelection() {
  const focused = document.activeElement;
  if (['body', 'summary'].includes(focused?.id) && focused.selectionEnd > focused.selectionStart) {
    const start = focused.selectionStart, end = focused.selectionEnd;
    selected = { field: focused.id, origin: 'source', quote: focused.value.slice(start, end), before: focused.value.slice(Math.max(0, start - 40), start), after: focused.value.slice(end, end + 40) };
    return true;
  }
  const selection = getSelection();
  if (selection?.rangeCount && !selection.isCollapsed && $('preview').contains(selection.anchorNode) && $('preview').contains(selection.focusNode)) {
    const range = selection.getRangeAt(0), container = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement).closest('[data-comment-field]');
    if (!container || !container.contains(range.startContainer) || !container.contains(range.endContainer)) return false;
    const before = range.cloneRange(); before.selectNodeContents(container); before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange(); after.selectNodeContents(container); after.setStart(range.endContainer, range.endOffset);
    selected = { field: container.dataset.commentField, origin: 'preview', quote: selection.toString(), before: before.toString().slice(-40), after: after.toString().slice(0, 40) };
    return true;
  }
  return false;
}
function startComment() {
  captureSelection();
  if (!selected?.quote.trim()) throw new Error('Highlight a passage in the summary, manuscript or reader preview first.');
  showPanel('comments'); $('comment-form').hidden = false; $('selected-quote').textContent = selected.quote; $('comment-text').focus();
}
function commentLocation(comment) {
  const root = $('preview').querySelector(`[data-comment-field="${comment.field}"]`);
  const index = root ? textIndex(root) : null;
  const target = index && anchor(index.text, comment);
  const sourceTarget = anchor($(comment.field).value, comment);
  return { root, index, target, sourceTarget, attached: Boolean(target || sourceTarget) };
}
function renderComments() {
  if (!current) return;
  const highlights = [];
  $('comments-list').innerHTML = current.comments.length ? current.comments.map(comment => {
    const location = commentLocation(comment);
    if (!comment.resolved && location.target) {
      const range = makeRange(location.index, location.target); if (range) highlights.push(range);
    }
    return `<article class="comment-card${comment.resolved ? ' resolved' : ''}"><blockquote>${escape(comment.quote)}</blockquote><p>${escape(comment.text)}</p><p class="anchor-status">${comment.resolved ? 'Resolved' : location.attached ? `${comment.field === 'summary' ? 'Summary' : 'Full essay'} · Passage found` : 'Passage changed or ambiguous · reselect to reattach'}</p>${location.attached ? `<button data-jump-comment="${comment.id}">Go to passage</button>` : `<button data-reattach="${comment.id}">Reattach to selection</button>`}<button data-resolve="${comment.id}">${comment.resolved ? 'Reopen' : 'Resolve'}</button></article>`;
  }).join('') : '<p class="panel-description">No notes yet. Highlight a passage, then choose “Comment on selection”.</p>';
  if (globalThis.Highlight && CSS.highlights) CSS.highlights.set('comments', new Highlight(...highlights));
}
function makeRange(index, target) {
  const start = index.nodes.findLast(item => item.offset <= target.start), end = index.nodes.findLast(item => item.offset < target.end);
  if (!start || !end) return null;
  const range = document.createRange(); range.setStart(start.node, target.start - start.offset); range.setEnd(end.node, target.end - end.offset); return range;
}
function renderAudio() {
  const audio = current?.metadata.audio;
  $('remove-audio').hidden = !audio;
  $('audio-current').innerHTML = !audio ? '<p class="small-note">No recording attached yet.</p>' : `<p class="small-note">Attached: ${escape(audio.narrator)} · ${audio.tracks.length} part${audio.tracks.length === 1 ? '' : 's'}</p>${audio.source_hash !== audioHash ? '<p class="audio-stale">The text has changed since this recording. Regenerate or attach an updated recording before release.</p>' : '<p class="small-note">Recording matches the current text.</p>'}`;
}
async function upload(file) {
  if (!file) throw new Error('Choose a file first.');
  if (file.size > 60_000_000) throw new Error('Files must be under 60 MB.');
  uploading = true;
  try {
    if (connection.hosted) {
      const checksum = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))));
      const ticket = await api(`/api/essays/${current.slug}/uploads`, { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, checksum }) });
      const form = new FormData(); for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value); form.append('file', file);
      const response = await fetch(ticket.url, { method: 'POST', body: form });
      if (!response.ok) throw new Error('The media upload failed. Please try again.');
      return api(`/api/media/${ticket.id}/complete`, { method: 'POST', body: '{}' });
    }
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read that file.')); reader.readAsDataURL(file); });
    return await api(`/api/essays/${current.slug}/media`, { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
  } finally { uploading = false; }
}
async function loadHistory() {
  const revisions = await api(`/api/essays/${current.slug}/history`);
  $('history-list').innerHTML = revisions.length ? revisions.map(name => `<button data-revision="${name}">${name === 'original.md' ? 'Original import' : escape(new Date(Number(name.split('-')[0])).toLocaleString())}<br><span>${escape(name)}</span></button>`).join('') : '<p class="panel-description">Your first save will start the history.</p>';
}
async function pollNarration(slug) {
  if (current?.slug !== slug) return;
  const job = await api(`/api/essays/${slug}/narration`);
  $('voice-sample').disabled = $('generate-audio').disabled = job.state === 'running';
  if (job.state === 'running') {
    $('audio-progress').textContent = `Recording ${job.sample ? 'preview' : 'essay'} · ${job.completed} / ${job.total || '…'} parts complete`;
    audioPoll = setTimeout(() => pollNarration(slug).catch(error => { notice(error.message, true); $('voice-sample').disabled = $('generate-audio').disabled = false; }), 1500);
  } else if (job.state === 'complete') {
    $('audio-progress').textContent = job.sample ? 'Preview ready. Listen before generating the essay.' : 'Narration attached. Save the draft to keep it.';
    if (job.sample) $('voice-preview').innerHTML = `<audio controls src="${escape(job.audio.playbackUrl || job.audio.tracks[0].src)}"></audio>`;
    else { current.metadata.audio = job.audio; change(); await render(); }
    await api(`/api/essays/${slug}/narration/ack`, { method: 'POST', body: '{}' });
  } else if (job.state === 'error') {
    $('audio-progress').textContent = job.error;
    if (connection.hosted && job.id) {
      const retry = document.createElement('button'); retry.textContent = job.uncertain ? 'Retry part (may use more credits)' : 'Retry narration';
      retry.addEventListener('click', handle(async () => { retry.disabled = true; await api(`/api/jobs/${job.id}/retry`, { method: 'POST', body: '{}' }); await pollNarration(slug); }));
      $('audio-progress').append(document.createElement('br'), retry);
    }
  }
}
async function generate(sample) {
  await saveCurrent();
  const slug = current.slug;
  const result = await api(`/api/essays/${slug}/narration`, { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), revision: current.revision, commentsRevision: current.commentsRevision, voiceId: $('voice-id').value, narrator: $('narrator').value, sample }) });
  if (result.state === 'running') await pollNarration(slug);
}

fields.forEach(field => {
  $(field).addEventListener('input', change);
  if (['body', 'summary'].includes(field)) {
    $(field).addEventListener('focus', () => { activeField = field; });
    $(field).addEventListener('select', captureSelection);
  }
});
$('preview').addEventListener('mouseup', captureSelection);
$('preview').addEventListener('keyup', captureSelection);
$('preview').addEventListener('touchend', captureSelection);
$('save').addEventListener('click', handle(save));
$('export').addEventListener('click', handle(exportMarkdown));
document.addEventListener('keydown', handle(async event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (current && dirty) await save(); }
  if (event.key === 'Escape') showPanel(null);
}));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
$('essay-list').addEventListener('click', handle(async event => { const button = event.target.closest('[data-slug]'); if (button) await openEssay(button.dataset.slug); }));
document.querySelectorAll('button[data-mode]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.mode; document.querySelector('.writing-area').dataset.mode = mode;
  document.querySelectorAll('button[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  $('preview').querySelectorAll('.essay-outline details').forEach(item => { item.open = mode === 'read'; });
}));
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', handle(async () => {
  showPanel(panel === button.dataset.panel ? null : button.dataset.panel); if (panel === 'history') await loadHistory();
})));
$('close-panel').addEventListener('click', () => showPanel(null));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('new-essay').addEventListener('click', () => { pendingImport = null; $('new-form').reset(); $('import-name').textContent = ''; $('new-dialog').showModal(); });
$('new-title').addEventListener('input', () => { $('new-slug').value = $('new-title').value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 95); });
$('import-essay').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', handle(async () => {
  const file = $('import-file').files[0]; if (!file) return;
  if (file.size > 500_000) throw new Error('Markdown imports must be under 500 KB.');
  pendingImport = await file.text(); $('new-form').reset(); $('new-title').value = file.name.replace(/\.m(?:ark)?d(?:own)?$/, '').replaceAll('-', ' '); $('new-title').dispatchEvent(new Event('input'));
  $('import-name').textContent = `Importing ${file.name}`; $('new-dialog').showModal(); $('import-file').value = '';
}));
$('new-form').addEventListener('submit', handle(async event => {
  event.preventDefault(); if (dirty) await saveCurrent();
  const doc = await api('/api/essays', { method: 'POST', body: JSON.stringify({ title: $('new-title').value, slug: $('new-slug').value, source: pendingImport }) });
  $('new-dialog').close(); await openEssay(doc.slug); notice('Draft created. Start with the idea in brief.');
}));
$('add-comment').addEventListener('mousedown', () => captureSelection());
$('add-comment').addEventListener('click', handle(startComment));
$('cancel-comment').addEventListener('click', () => { $('comment-form').hidden = true; selected = null; });
$('comment-form').addEventListener('submit', handle(async event => {
  event.preventDefault(); if (!selected || !$('comment-text').value.trim()) return;
  current.comments.push({ ...selected, id: crypto.randomUUID(), text: $('comment-text').value.trim(), resolved: false, created: new Date().toISOString() });
  selected = null; $('comment-form').reset(); $('comment-form').hidden = true; change(); renderComments();
}));
$('comments-list').addEventListener('click', handle(async event => {
  const resolve = event.target.closest('[data-resolve]'), jump = event.target.closest('[data-jump-comment]'), reattach = event.target.closest('[data-reattach]');
  if (resolve) { const comment = current.comments.find(item => item.id === resolve.dataset.resolve); comment.resolved = !comment.resolved; change(); renderComments(); }
  if (reattach) { if (!selected) throw new Error('Select the new passage first.'); const comment = current.comments.find(item => item.id === reattach.dataset.reattach); Object.assign(comment, selected); selected = null; change(); renderComments(); }
  if (jump) {
    const comment = current.comments.find(item => item.id === jump.dataset.jumpComment), location = commentLocation(comment);
    if (location.sourceTarget && document.querySelector('.writing-area').dataset.mode !== 'read') {
      const field = $(comment.field); field.focus(); field.setSelectionRange(location.sourceTarget.start, location.sourceTarget.end); field.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else if (location.target) { const range = makeRange(location.index, location.target); getSelection().removeAllRanges(); getSelection().addRange(range); range.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' }); }
  }
}));
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
  const field = $(activeField), start = field.selectionStart, end = field.selectionEnd, text = field.value.slice(start, end);
  const insertion = { bold: `**${text || 'strong idea'}**`, italic: `*${text || 'emphasis'}*`, heading: `\n\n## ${text || 'A new section'}\n\n`, quote: `\n\n> ${text || 'A thought worth pausing on'}\n\n`, link: `[${text || 'link text'}](https://example.com)` }[button.dataset.format];
  field.setRangeText(insertion, start, end, 'select'); field.focus(); change();
}));
$('add-image').addEventListener('click', () => { imagePosition = $('body').selectionStart; $('image-form').reset(); $('image-dialog').showModal(); });
$('image-form').addEventListener('submit', handle(async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const result = await upload($('image-file').files[0]);
    if (result.kind !== 'image') throw new Error('Choose an image file.');
    const alt = $('image-alt').value.replace(/[\[\]\\\n]/g, ' '), caption = $('image-caption').value.replace(/[\n*_]/g, ' ');
    const insertion = `\n\n![${alt}](${result.src})${caption ? `\n\n*${caption}*` : ''}\n\n`;
    $('body').setRangeText(insertion, imagePosition, imagePosition, 'end'); $('image-dialog').close(); change(); notice('Image inserted at the manuscript cursor.');
  } finally { button.disabled = false; }
}));
$('history-list').addEventListener('click', handle(async event => {
  const button = event.target.closest('[data-revision]'); if (!button) return;
  const result = await api(`/api/essays/${current.slug}/history/${button.dataset.revision}`); revisionSource = result.source;
  $('revision-title').textContent = button.dataset.revision === 'original.md' ? 'The original draft' : 'Saved revision'; $('revision-source').textContent = revisionSource; $('revision-dialog').showModal();
}));
$('restore-revision').addEventListener('click', handle(async () => {
  // Parse through a dedicated local endpoint, preserving metadata beyond visible fields.
  const result = await api('/api/parse', { method: 'POST', body: JSON.stringify({ source: revisionSource }) });
  const comments = current.comments, base = current;
  fill({ ...base, ...result, metadata: Object.keys(result.metadata).length > 1 ? result.metadata : base.metadata, comments }); change(); $('revision-dialog').close(); await render(); notice('Revision restored in the editor. Save to make it the current draft.');
}));
$('release').addEventListener('click', handle(async () => { if (review) return review.publish(); $('release-path').textContent = `content/essays/${current.slug}.md`; $('release-dialog').showModal(); }));
$('confirm-release').addEventListener('click', handle(async () => {
  await saveCurrent();
  const result = await api(`/api/essays/${current.slug}/publish`, { method: 'POST', body: JSON.stringify({ revision: current.revision, commentsRevision: current.commentsRevision }) });
  $('release-dialog').close(); await library(); notice(`Final Markdown prepared in ${result.path}. Review it before committing and deploying.`);
}));
$('audio-connect').addEventListener('submit', handle(async event => {
  event.preventDefault(); const data = await api('/api/audio-settings', { method: 'POST', body: JSON.stringify({ apiKey: $('api-key').value, voiceId: $('voice-id').value }) });
  $('api-key').value = ''; $('audio-connection').textContent = data.connected ? (connection.hosted ? 'Key stored securely for your workspace' : 'Key configured for this local session') : 'Not connected';
}));
$('load-voices').addEventListener('click', handle(async () => {
  const voices = await api('/api/voices'); $('voice-list').hidden = false;
  $('voice-list').innerHTML = '<option value="">Choose a voice</option>' + voices.map(voice => `<option value="${escape(voice.id)}" data-name="${escape(voice.name)}">${escape(voice.name)} · ${escape(voice.description)}</option>`).join('');
}));
$('voice-list').addEventListener('change', () => { $('voice-id').value = $('voice-list').value; $('narrator').value = $('voice-list').selectedOptions[0].dataset.name || 'ElevenLabs narrator'; });
$('voice-id').addEventListener('input', () => { $('narrator').value = $('voice-id').value === 'nPczCjzI2devNBz1zQrb' ? 'Brian · ElevenLabs' : 'ElevenLabs narrator'; });
$('voice-sample').addEventListener('click', handle(() => generate(true)));
$('generate-audio').addEventListener('click', handle(() => generate(false)));
$('audio-file').addEventListener('change', handle(async () => {
  if (!$('audio-file').files[0]) return;
  await saveCurrent(); await render(); const originalHash = audioHash;
  const result = await upload($('audio-file').files[0]); if (result.kind !== 'audio') throw new Error('Choose an audio file.');
  current.metadata.audio = { narrator: $('narrator').value || 'Narrator', ai_generated: $('uploaded-ai').checked, source_hash: originalHash, tracks: [{ title: 'Full essay', src: result.src }] };
  $('audio-file').value = ''; change(); await render(); notice('Recording attached. Save the draft to keep it.');
}));
$('remove-audio').addEventListener('click', () => { delete current.metadata.audio; change(); renderAudio(); });

try {
  connection = await initializeConnection();
  if (connection.hosted) {
    document.querySelector('.local-label').textContent = connection.local ? 'Hosted workflow · local preview' : 'Private workspace';
    document.querySelector('.storage-note').textContent = 'Your private writing workspace. Only confirmed releases reach the public site.';
    $('api-key').placeholder = 'Stored in your private AWS secret';
    $('release').textContent = 'Publish ↗';
    await api('/api/me');
    review = installReview({ api, notice, handle, saveCurrent, openEssay, library, getCurrent: () => current });
    await oauthConsent(api);
  }
  const essays = await library();
  const requested = location.hash.slice(1);
  if (essays.length) await openEssay(essays.some(essay => essay.slug === requested) ? requested : essays[0].slug);
  else { $('empty-state').hidden = false; $('save-state').textContent = 'Ready when you are'; }
  const audio = await api('/api/audio-settings'); $('audio-connection').textContent = audio.connected ? 'ElevenLabs key configured' : 'Connect your account to generate narration';
  if (!$('voice-id').value) { $('voice-id').value = audio.voiceId; $('narrator').value = audio.narrator; }
} catch (error) { notice(error.message, true); $('save-state').textContent = 'Could not open workspace'; }
