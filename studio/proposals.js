const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function diffMarkup(parts, split = false) {
  if (split) {
    const groups = []; let left = 0, right = 0, removed = [], added = [];
    const lines = text => { const values = text.split('\n'); if (values.at(-1) === '') values.pop(); return values; };
    const cell = (line, number, kind) => line === undefined ? '<div class="diff-line empty" aria-hidden="true"></div>' : `<div class="diff-line ${kind}"><span class="diff-numbers" aria-hidden="true">${number}</span><span class="diff-symbol" aria-label="${kind === 'context' ? 'Unchanged' : kind}">${kind === 'added' ? '+' : kind === 'removed' ? '−' : ' '}</span><code>${escape(line || ' ')}</code></div>`;
    const flush = () => { for (let i = 0; i < Math.max(removed.length, added.length); i++) groups.push(`<div class="diff-row">${cell(removed[i], removed[i] === undefined ? '' : ++left, 'removed')}${cell(added[i], added[i] === undefined ? '' : ++right, 'added')}</div>`); removed = []; added = []; };
    for (const part of parts) {
      if (part.kind === 'removed') removed.push(...lines(part.text));
      else if (part.kind === 'added') added.push(...lines(part.text));
      else { flush(); for (const line of lines(part.text)) groups.push(`<div class="diff-row">${cell(line, ++left, 'context')}${cell(line, ++right, 'context')}</div>`); }
    }
    flush(); return `<div class="change-diff split-diff" role="region" aria-label="Manuscript changes: before and after" tabindex="0"><div class="diff-row diff-labels"><span>Before</span><span>Proposed</span></div>${groups.join('')}</div>`;
  }
  let before = 0, after = 0;
  return `<div class="change-diff" role="region" aria-label="Manuscript changes" tabindex="0">${parts.flatMap(part => {
    const lines = part.text.split('\n'); if (lines.at(-1) === '') lines.pop();
    return lines.map(line => {
      const previous = part.kind !== 'added' ? ++before : '', next = part.kind !== 'removed' ? ++after : '';
      const symbol = part.kind === 'added' ? '+' : part.kind === 'removed' ? '−' : ' ';
      return `<div class="diff-line ${part.kind}"><span class="diff-numbers" aria-hidden="true">${previous}<span>${next}</span></span><span class="diff-symbol" aria-label="${part.kind === 'context' ? 'Unchanged' : part.kind}">${symbol}</span><code>${escape(line || ' ')}</code></div>`;
    });
  }).join('')}</div>`;
}

export function installReview({ api, notice, handle, saveCurrent, openEssay, library, getCurrent }) {
  let selection, release, pollTimer;
  const button = document.createElement('button'); button.id = 'proposed-changes'; button.className = 'import-essay'; button.textContent = 'Proposed changes';
  document.querySelector('.library-heading').after(button);
  const dialog = document.createElement('dialog'); dialog.id = 'changes-dialog'; dialog.className = 'changes-dialog';
  dialog.innerHTML = '<div class="changes-heading"><div><p class="eyebrow">You decide what becomes your writing</p><h2>Proposed changes</h2></div><button data-close aria-label="Close proposed changes">✕</button></div><div class="changes-workspace"><nav class="proposal-list" aria-label="Proposals"></nav><section class="proposal-detail" aria-label="Review a proposal"><p class="small-note">Choose a proposal to review its changes.</p></section></div>';
  document.body.append(dialog);
  const detail = dialog.querySelector('.proposal-detail');
  const refresh = async () => {
    const proposals = await api('/api/proposals');
    button.textContent = `Proposed changes · ${proposals.filter(item => item.state === 'pending').length}`;
    dialog.querySelector('.proposal-list').innerHTML = proposals.length ? proposals.map(item => `<button data-proposal="${escape(item.id)}"><strong>${escape(item.slug)}</strong><span>${escape(item.state)} · v${item.version}</span><span>${escape(item.summary)}</span></button>`).join('') : '<p class="small-note">Ask ChatGPT to propose an essay or revise an existing draft. The proposal will appear here for your review.</p>';
    // Never replace an open diff while the author is reading it.
    if (selection && proposals.some(item => item.id === selection.id && (item.version !== selection.version || item.state !== selection.state))) {
      detail.querySelector('[role=status]').textContent = 'This proposal changed. Reopen it to review the latest version.';
      detail.querySelectorAll('[data-decision]').forEach(node => { node.disabled = true; });
    }
  };
  const show = async (id, version) => {
    selection = await api(`/api/proposals/${id}${version ? `?version=${version}` : ''}`);
    const change = selection;
    detail.innerHTML = `<p class="eyebrow">${escape(change.slug)} · Version ${change.version} · ${escape(change.state)}</p><h3>${escape(change.summary)}</h3><p class="small-note">Approving saves this batch to your private draft. Publication is a separate decision.</p><p role="status">${change.stale ? 'The manuscript, comments, or proposal changed. Ask ChatGPT for a refreshed proposal.' : ''}</p><details class="metadata-changes"><summary>Metadata changes · ${change.metadataChanges.length}</summary>${change.metadataChanges.map(item => `<p><strong>${escape(item.field)}</strong><br>Before: ${escape(typeof item.before === "string" ? item.before : JSON.stringify(item.before))}<br>Proposed: ${escape(typeof item.after === "string" ? item.after : JSON.stringify(item.after))}</p>`).join('')}</details><div class="diff-controls" role="group" aria-label="Diff view"><button data-diff="unified" aria-pressed="true">Unified diff</button><button data-diff="split" aria-pressed="false">Split diff</button><button data-diff="preview" aria-pressed="false">Reader preview</button></div><div class="diff-content">${diffMarkup(change.diff)}</div><div class="proposal-preview" hidden>${change.html}</div><section class="comment-resolutions"><h4>Comments proposed for resolution</h4>${change.resolvedComments.length ? change.resolvedComments.map(comment => `<blockquote><p>${escape(comment.quote)}</p><p>${escape(comment.text)}</p></blockquote>`).join('') : '<p class="small-note">No comment resolutions in this batch.</p>'}</section><div class="dialog-actions"><button data-decision="reject" ${change.state !== 'pending' ? 'disabled' : ''}>Reject batch</button><button class="primary" data-decision="approve" ${change.stale || change.state !== 'pending' ? 'disabled' : ''}>Approve batch</button></div>`;
    dialog.querySelectorAll('[data-proposal]').forEach(node => node.setAttribute('aria-current', String(node.dataset.proposal === id)));
  };
  button.addEventListener('click', handle(async () => { await saveCurrent(); await refresh(); dialog.showModal(); }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('.proposal-list').addEventListener('click', handle(async event => { const target = event.target.closest('[data-proposal]'); if (target) await show(target.dataset.proposal); }));
  detail.addEventListener('click', handle(async event => {
    const view = event.target.closest('[data-diff]');
    if (view) {
      detail.querySelectorAll('[data-diff]').forEach(node => node.setAttribute('aria-pressed', String(node === view)));
      detail.querySelector('.diff-content').hidden = view.dataset.diff === 'preview'; detail.querySelector('.proposal-preview').hidden = view.dataset.diff !== 'preview';
      detail.querySelector('.diff-content').innerHTML = diffMarkup(selection.diff, view.dataset.diff === 'split'); return;
    }
    const decision = event.target.closest('[data-decision]'); if (!decision) return;
    decision.disabled = true;
    try {
      const result = await api(`/api/proposals/${selection.id}/${decision.dataset.decision}`, { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), version: selection.version }) });
      await refresh(); await show(selection.id, selection.version);
      if (result.document) { await openEssay(result.document.slug); notice('Batch approved and saved to your private draft.'); } else notice('Batch rejected. Your manuscript is unchanged.');
      await library();
    } catch (error) { detail.querySelector('[role=status]').textContent = error.message; }
  }));
  const releaseDialog = document.createElement('dialog'); releaseDialog.id = 'hosted-release-dialog'; releaseDialog.className = 'changes-dialog'; document.body.append(releaseDialog);
  const releasesButton = document.createElement('button'); releasesButton.className = 'import-essay'; releasesButton.textContent = 'Publication status'; button.after(releasesButton);
  const statusDialog = document.createElement('dialog'); statusDialog.innerHTML = '<h2>Publication status</h2><div class="release-status-list"></div><div class="dialog-actions"><button>Close</button></div>'; document.body.append(statusDialog);
  statusDialog.querySelector('button').onclick = () => statusDialog.close();
  const showStatuses = async () => {
    const statuses = await Promise.all((await api('/api/releases')).reverse().map(item => api(`/api/releases/${item.id}`)));
    statusDialog.querySelector('.release-status-list').innerHTML = statuses.length ? statuses.map(item => `<article><h3>${escape(item.slug)}</h3><p>${escape(item.state)}</p>${item.error ? `<p>${escape(item.error)}</p>` : ''}${item.runUrl ? `<a class="text-link" href="${escape(item.runUrl)}" target="_blank" rel="noopener">View deployment ↗</a>` : ''}${item.liveUrl ? `<a class="text-link" href="${escape(item.liveUrl)}" target="_blank" rel="noopener">Open published site ↗</a>` : ''}${item.state === 'failed' && !item.committedAt ? `<button data-retry="${escape(item.id)}">Check and retry release</button>` : ''}</article>`).join('') : '<p>No releases yet.</p>';
    clearTimeout(pollTimer); if (statusDialog.open && statuses.some(item => ['preparing', 'committed', 'deploying'].includes(item.state))) pollTimer = setTimeout(() => showStatuses().catch(error => notice(error.message, true)), 5000);
  };
  releasesButton.addEventListener('click', handle(async () => { statusDialog.showModal(); await showStatuses(); }));
  statusDialog.addEventListener('click', handle(async event => { const retry = event.target.closest('[data-retry]'); if (retry) { await api(`/api/jobs/${retry.dataset.retry}/retry`, { method: 'POST', body: '{}' }); await showStatuses(); } }));
  const connections = document.createElement('button'); connections.textContent = 'ChatGPT connections'; connections.className = 'import-essay'; releasesButton.after(connections);
  const connectionsDialog = document.createElement('dialog'); document.body.append(connectionsDialog);
  const showConnections = async () => {
    const grants = await api('/api/connections');
    connectionsDialog.innerHTML = `<h2>ChatGPT connections</h2><p class="small-note">Add a custom MCP server in ChatGPT using this address and OAuth authentication:</p><code class="endpoint">${escape(location.origin)}/mcp</code><p class="small-note">Connections can read and propose. Approval and publication stay here.</p>${grants.map(grant => `<article><h3>${escape(grant.name || 'ChatGPT')}</h3><p>${grant.revoked ? 'Revoked' : escape(grant.permissions.join(' · '))}</p>${grant.revoked ? '' : `<button data-revoke="${escape(grant.clientId)}">Revoke access</button>`}</article>`).join('')}<div class="dialog-actions"><button data-close>Close</button></div>`;
    connectionsDialog.querySelector('[data-close]').onclick = () => connectionsDialog.close();
  };
  connections.addEventListener('click', handle(async () => { await showConnections(); connectionsDialog.showModal(); }));
  connectionsDialog.addEventListener('click', handle(async event => { const target = event.target.closest('[data-revoke]'); if (target) { await api(`/api/connections/${encodeURIComponent(target.dataset.revoke)}/revoke`, { method: 'POST', body: '{}' }); await showConnections(); } }));
  const interval = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 15000);
  window.addEventListener('pagehide', () => clearInterval(interval));
  refresh().catch(error => notice(error.message, true));
  const query = new URLSearchParams(location.search);
  if (query.has('proposal')) { refresh().then(() => show(query.get('proposal'), query.get('version'))).then(() => dialog.showModal()).catch(error => notice(error.message, true)); }
  return {
    publish: async () => {
      await saveCurrent(); const current = getCurrent();
      release = await api(`/api/essays/${current.slug}/release-preview`, { method: 'POST', body: JSON.stringify({ revision: current.revision, commentsRevision: current.commentsRevision }) });
      releaseDialog.innerHTML = `<div class="changes-heading"><div><p class="eyebrow">A deliberate release</p><h2>Publish ${escape(current.metadata.title)}</h2></div><button data-close aria-label="Close publication review">✕</button></div><p>Review the changes from the last publication. Confirming commits this exact essay and the listed media to GitHub and starts deployment.</p>${diffMarkup(release.diff)}<details><summary>Reader preview</summary><div class="proposal-preview">${release.html}</div></details><h3>Included media</h3><ul>${release.assets.map(asset => `<li>${escape(asset.filename)} · ${(asset.size / 1000000).toFixed(2)} MB</li>`).join('') || '<li>No media</li>'}</ul><p role="status"></p><div class="dialog-actions"><button data-close>Keep editing</button><button id="publish-reviewed-release" class="primary">Publish reviewed release</button></div>`;
      releaseDialog.querySelectorAll('[data-close]').forEach(node => { node.onclick = () => releaseDialog.close(); });
      releaseDialog.querySelector('#publish-reviewed-release').onclick = async event => {
        event.target.disabled = true;
        try {
          await api(`/api/releases/${release.id}/confirm`, { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), reviewHash: release.reviewHash }) });
          releaseDialog.close(); statusDialog.showModal(); await showStatuses();
        } catch (error) { releaseDialog.querySelector('[role=status]').textContent = error.message; event.target.disabled = false; }
      };
      releaseDialog.showModal();
    },
  };
}
