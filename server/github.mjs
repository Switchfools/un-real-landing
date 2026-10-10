import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { requireValue, fail } from './errors.mjs';

export class GitHubPublisher {
  constructor(config, fetcher = fetch) { this.config = config; this.fetch = fetcher; }
  async token() {
    if (this.cachedToken && this.tokenExpires > Date.now() + 60000) return this.cachedToken;
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(String(this.config.appId)).setIssuedAt(Math.floor(Date.now() / 1000) - 30).setExpirationTime('9m').sign(createPrivateKey(this.config.privateKey));
    const response = await this.fetch(`https://api.github.com/app/installations/${this.config.installationId}/access_tokens`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ repositories: [this.config.repo.split('/')[1]], permissions: { contents: 'write', actions: 'read', deployments: 'read' } }), signal: AbortSignal.timeout(15000) });
    requireValue(response.ok, 'GitHub authorization failed. Check the publishing app installation.', 502);
    const data = await response.json(); this.cachedToken = data.token; this.tokenExpires = Date.parse(data.expires_at); return data.token;
  }
  async request(path, { method = 'GET', body, allow404 = false } = {}) {
    const response = await this.fetch(`https://api.github.com/repos/${this.config.repo}${path}`, { method, headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    if (allow404 && response.status === 404) return null;
    if (response.status === 409 || response.status === 422) throw fail('The repository changed or its branch rules rejected this release. Review a new release; no force push was attempted.', 409);
    requireValue(response.ok, `GitHub returned ${response.status}. The release can be checked or retried.`, 502);
    return response.status === 204 ? null : response.json();
  }
  async head() { return (await this.request('/git/ref/heads/main')).object.sha; }
  async source(slug, commit) {
    const file = await this.request(`/contents/content/essays/${encodeURIComponent(slug)}.md?ref=${encodeURIComponent(commit)}`, { allow404: true });
    return file ? Buffer.from(file.content, 'base64').toString('utf8') : '';
  }
  async prepareCommit(release, assets) {
    requireValue(await this.head() === release.baseCommit, 'GitHub changed since this release was reviewed. Prepare a fresh release.', 409);
    const parent = await this.request(`/git/commits/${release.baseCommit}`);
    const files = [{ path: `content/essays/${release.slug}.md`, bytes: Buffer.from(release.source) }, ...assets.map(({ filename, bytes }) => ({ path: `content/essay-assets/${release.slug}/${filename}`, bytes }))];
    const tree = [];
    for (const file of files) {
      requireValue(file.path === `content/essays/${release.slug}.md` || file.path.startsWith(`content/essay-assets/${release.slug}/`) && !file.path.includes('..'), 'Publication path is outside this release.');
      const blob = await this.request('/git/blobs', { method: 'POST', body: { content: file.bytes.toString('base64'), encoding: 'base64' } });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const createdTree = await this.request('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
    // Fixed author/date make retried preparations produce the same Git object.
    const author = { name: 'un-real Essay Studio', email: 'contact-us@un-real.ai', date: release.confirmedAt };
    const commit = await this.request('/git/commits', { method: 'POST', body: { message: `Publish ${release.title}\n\nEssay-Studio-Release: ${release.id}`, tree: createdTree.sha, parents: [release.baseCommit], author, committer: author } });
    return commit.sha;
  }
  async advance(release) {
    const current = await this.head();
    if (current === release.commitSha) return;
    if (current !== release.baseCommit) {
      const comparison = await this.request(`/compare/${release.commitSha}...${current}`);
      if (comparison.status === 'ahead' || comparison.status === 'identical') return;
      throw fail('GitHub changed before this release was committed. Prepare a new release.', 409);
    }
    await this.request('/git/refs/heads/main', { method: 'PATCH', body: { sha: release.commitSha, force: false } });
  }
  async deployment(commitSha) {
    const { workflow_runs: runs = [] } = await this.request(`/actions/workflows/pages.yml/runs?head_sha=${commitSha}&event=push&per_page=10`);
    const run = runs[0];
    if (!run) return { state: 'committed' };
    if (run.status !== 'completed') return { state: 'deploying', runUrl: run.html_url, runId: run.id };
    if (run.conclusion !== 'success') return { state: 'failed', runUrl: run.html_url, error: `Pages workflow ${run.conclusion}. The previous site remains live.` };
    const deployments = await this.request(`/deployments?sha=${commitSha}&environment=github-pages&per_page=10`);
    for (const deployment of deployments) {
      const statuses = await this.request(`/deployments/${deployment.id}/statuses?per_page=1`);
      if (statuses[0]?.state === 'success') return { state: 'live', runUrl: run.html_url, liveUrl: statuses[0].environment_url || `https://${this.config.repo.split('/')[0].toLowerCase()}.github.io/${this.config.repo.split('/')[1]}/` };
    }
    return { state: 'deploying', runUrl: run.html_url, runId: run.id };
  }
}
