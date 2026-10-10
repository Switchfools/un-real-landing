let config = { hosted: false }, client;
export async function initializeConnection() {
  const response = await fetch('/api/config');
  config = await response.json();
  if (!response.ok) throw new Error(config.error || 'The Studio could not connect. Please try again.');
  if (!config.hosted || config.local) return config;
  const { createClient } = await import('/vendor/supabase.js');
  client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
  const parameters = new URLSearchParams(location.search);
  if (parameters.has('authorization_id')) sessionStorage.setItem('studio-authorization', parameters.get('authorization_id'));
  if (parameters.has('proposal')) sessionStorage.setItem('studio-review-return', location.search);
  let { data: { session } } = await client.auth.getSession();
  if (!session) {
    const dialog = document.createElement('dialog'); dialog.className = 'studio-login';
    dialog.innerHTML = '<p class="eyebrow">Your private writing room</p><h1>Welcome back.</h1><p>Sign in to read, revise, and review your essays.</p><button class="primary">Sign in with GitHub</button><p class="small-note" role="status"></p>';
    document.body.append(dialog); dialog.showModal(); dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.querySelector('button').addEventListener('click', async () => {
      const result = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${config.origin}/auth/callback` } });
      if (result.error) dialog.querySelector('[role=status]').textContent = result.error.message;
    });
    session = await new Promise(resolve => { client.auth.onAuthStateChange((_event, next) => { if (next) resolve(next); }); });
    dialog.close(); dialog.remove();
  }
  if (location.pathname === '/auth/callback') {
    const review = sessionStorage.getItem('studio-review-return') || '';
    sessionStorage.removeItem('studio-review-return'); history.replaceState(null, '', `/${review}`);
  }
  const signOut = document.createElement('button'); signOut.textContent = 'Sign out'; signOut.id = 'sign-out';
  signOut.addEventListener('click', async () => { if (!confirm('Save your edits before signing out. Sign out now?')) return; await client.auth.signOut(); location.assign('/'); });
  document.querySelector('.library').append(signOut);
  return config;
}
export async function authorizationHeaders() {
  if (!config.hosted) return {};
  if (config.local) return { Authorization: 'Bearer local-author' };
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Your session ended. Export unsaved edits, then sign in again.');
  return { Authorization: `Bearer ${session.access_token}` };
}
export async function oauthConsent(api) {
  if (!client) return;
  const id = new URLSearchParams(location.search).get('authorization_id') || sessionStorage.getItem('studio-authorization');
  if (!id) return;
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  if (error) { sessionStorage.removeItem('studio-authorization'); throw new Error('This connection request expired. Restart the connection in ChatGPT.'); }
  if (data.redirect_url) { sessionStorage.removeItem('studio-authorization'); location.assign(data.redirect_url); return; }
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<p class="eyebrow">Connect your writing</p><h2>Allow access to Essay Studio?</h2><p class="oauth-client"></p><p>The connection can read your private essays and comments.</p><label class="checkbox-label"><input type="checkbox" checked> Also allow proposed essays and edits</label><p class="small-note">Only you can approve a batch, publish an essay, or generate narration in the Studio.</p><p role="status"></p><div class="dialog-actions"><button data-deny>Cancel</button><button class="primary" data-allow>Allow connection</button></div>';
  dialog.querySelector('.oauth-client').textContent = data.client?.name || 'MCP client'; document.body.append(dialog); dialog.showModal();
  for (const decision of ['allow', 'deny']) dialog.querySelector(`[data-${decision}]`).addEventListener('click', async () => {
    try {
      if (decision === 'allow') await api('/api/connections/authorize', { method: 'POST', body: JSON.stringify({ authorizationId: id, permissions: dialog.querySelector('input').checked ? ['read', 'propose'] : ['read'] }) });
      const result = decision === 'allow' ? await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
      if (result.error) throw result.error;
      sessionStorage.removeItem('studio-authorization'); location.assign(result.data.redirect_url);
    } catch (error) { dialog.querySelector('[role=status]').textContent = error.message; }
  });
}
