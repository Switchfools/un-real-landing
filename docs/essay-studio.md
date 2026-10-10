# Private Essay Studio

Discuss an idea in ChatGPT, request a proposal, review its exact version in Studio,
and approve it into the private draft. Publishing is a separate reviewed action.
Saving a comment never calls a model. No OpenAI API key is required.

| Service | Address |
| --- | --- |
| Studio | https://studio.un-real.ai |
| MCP | https://studio.un-real.ai/mcp |
| Published website | https://un-real.ai/ |
| Supabase | `yvbpaajyfruqxtelsfoo`, project `unreal-essay-studio` |
| AWS | `UnrealEssayStudio`, account `885072868436`, `eu-central-1` |

The initial owner is GitHub account `Switchfools`, numeric identity `37335567`.
Only that provider identity can open the workspace. Changing the display name or
user-editable profile metadata cannot grant access. Collaboration is out of scope.

The custom domain is configured in `infra/domain.mjs`. Its DNS-validated ACM
certificate is in `us-east-1`, as CloudFront requires; application resources stay
in `eu-central-1`. GoDaddy's `studio` CNAME points to
`du33fyw9w0t2v.cloudfront.net`. Keep its ACM validation CNAME for renewal.
The original CloudFront browser address redirects to `studio.un-real.ai`, keeping
proposal and OAuth query parameters. Sign in again on the new domain; browser
sessions and unsaved recovery copies are scoped to their original host.
Reconnect ChatGPT using `https://studio.un-real.ai/mcp` if it was connected to the
old address. Runtime origin, the Supabase site/redirect URL, and the OAuth audience
hook must agree when changing domains; the GitHub provider callback remains the
Supabase `/auth/v1/callback` URL. Studio sends `noindex, nofollow` while the public
mission and published essays stay indexable at `un-real.ai`.

## Everyday writing and review

The editor retains the abstract, footnotes, passage comments, revisions, images,
voice auditions and multipart narration. The preview and public page use
`scripts/essays.mjs`. Use **Save draft** or Cmd/Ctrl+S; browser recovery preserves
unsaved edits when local storage is available. On a save conflict, export edits
before reloading. Restore history to the editor, then save a new revision.

**Proposed changes** shows the purpose, metadata changes, unified or split diff,
reader preview, and suggested comment resolutions. Plus/minus symbols and text
labels distinguish changes without relying on color. Each proposal version is
immutable. Approval names that version and checks both manuscript and comment
revisions in one database transaction. A changed proposal or base requires a new
review. Rejected proposals stay in history. Ambiguous or changed passage anchors
remain visible; select the intended passage and choose **Reattach to selection**.

**Publish** compares the accepted draft against its last committed public copy.
Open comments, missing required metadata, abstracts over 180 words, and outdated
narration block release. Confirmation freezes the source and referenced media.
Later writing cannot enter that release. States are:

| State | Meaning |
| --- | --- |
| preparing | Frozen release is queued or preparing its Git commit |
| committed | The exact commit reached `main`; Pages has not started yet |
| deploying | The matching Pages workflow/deployment is running |
| live | The matching commit has both a successful workflow and Pages deployment |
| failed | Preparation, commit, or deployment needs attention |

The publishing GitHub App makes one commit containing only the release Markdown
and referenced media. It uses a short-lived installation token, so its commit can
trigger Actions. It never force-pushes. If `main` changed after review, prepare a
fresh release. For a failed Pages workflow, open its run and rerun the failed jobs;
**Publication status** checks again. A failed pre-commit job can be explicitly
retried from Studio. Duplicate confirmations and retries do not create another
release or approval.

## Connect ChatGPT

In ChatGPT's Plugins area, choose **+ → Add custom MCP server**. Set the URL to
`https://studio.un-real.ai/mcp` and choose OAuth. Supabase supports dynamic
client registration, so this connection uses its own OAuth client; do not enter
the GitHub sign-in secret. Follow the GitHub sign-in and Studio consent screen.
Allow reading, and optionally proposals. Account/workspace controls may affect
the connection UI. See [OpenAI's connection instructions](https://developers.openai.com/plugins/build/plugins)
and [OAuth requirements](https://developers.openai.com/plugins/build/auth).

The connection can list/read essays, comments, history and proposals, propose a
new essay/revision, and revise a pending proposal. It cannot approve, publish,
generate audio, manage connections or write directly to database tables. These
restrictions are enforced by the backend, not by tool descriptions alone.
**ChatGPT connections → Revoke access** takes effect on the next request,
including requests carrying an otherwise valid token.

Example requests:

> Use the ideas in this conversation to propose an essay. Include a short abstract
> and one concrete action. Save it as a proposal in Essay Studio and give me its
> review link. Identify unsupported claims rather than inventing references.

> Read my saved comments on this essay. Propose one batch that addresses them;
> suggest resolutions only for comments you actually address. Keep the accepted
> draft unchanged until I review it.

To finish a real acceptance walkthrough: create a proposal from a chosen chat,
review it, add comments in Studio, ask ChatGPT for a revised proposal, compare
versions, and approve the desired version. Then separately choose an essay to
publish, review its final release, and verify the exact commit's live Pages URL.
Do not use a production publication as an automatic test fixture.

## Local development and checks

Use Node.js 24, then:

```sh
npm ci
npm run studio                 # original filesystem adapter, loopback :4310
npm run studio:hosted-local    # persistent local Postgres preview, loopback :4312
npm run check
npm run infra:synth
```

The hosted local preview stores data in ignored `.local/hosted-preview/` and uses
loopback-only test identities. It exercises the real HTTP/MCP/proposal code but
does not publish to GitHub. Those test identities are absent from the Lambda
runtime. Browser tests use temporary synthetic workspaces, not real private files.
Provider, JWT, ownership, migration, conflicts and worker recovery tests use
isolated fixtures; no paid audio is generated by tests.

`node scripts/check-hosted-studio.mjs` checks the actual deployed sign-in screen,
OAuth discovery, unauthenticated endpoints and private-schema denial. The
operator `studio-data.mjs probe` checks a real Postgres JSON round-trip and rolls
back all test records. These require the ignored deployment configuration.

## Deployment and account setup

The separate AWS stack uses private S3, CloudFront, HTTP API Gateway, Node.js
Lambda, an SQS FIFO worker queue and a dead-letter queue. It creates its own
Secrets Manager secrets, roles, alerts and budget. It does not alter Karteria's
services or data. No NAT gateway or always-running application instance is used.

For this workspace use the account-verifying wrapper:

```sh
python3 ../karteria/scripts/aws-env.py aws sts get-caller-identity
npm run build:studio
python3 ../karteria/scripts/aws-env.py node_modules/.bin/cdk deploy UnrealEssayStudio \
  --app 'node infra/app.mjs' --outputs-file .local/essay-studio/aws-outputs.json
```

On another computer use an AWS profile for account `885072868436` instead of the
wrapper. Verify the account first. The CDK environment is pinned to that account
and `eu-central-1`. Keep generated outputs and credentials in ignored `.local/`.
Infrastructure changes use CDK from an authorized operator; the CI role cannot
modify CloudFormation or account IAM. The stack owns its GitHub OIDC provider;
if bootstrapping into an account with an existing provider, import that provider
instead of trying to create a duplicate.

The backend workflow `.github/workflows/studio.yml` validates pull requests and
deploys on `main`/manual dispatch through GitHub OIDC. Its role trusts only
`repo:Switchfools/un-real-landing:environment:essay-studio-production`. It can update
the two Studio Lambda functions/aliases, the Studio web bucket and its CloudFront
distribution. Known production identifiers are defaults; repository variables
`STUDIO_DEPLOY_ROLE`, `STUDIO_WEB_BUCKET`, `STUDIO_DISTRIBUTION`, and `STUDIO_URL`
can override them after a replacement stack. Restrict the environment to `main`.
No long-lived AWS GitHub secret is needed. `.github/workflows/pages.yml` continues
to deploy only the public `dist/` artifact.

Supabase setup uses an authenticated CLI and a **separate project**:

```sh
SUPABASE_CLI=../karteria/node_modules/.bin/supabase \
  python3 scripts/setup-studio.py create --org vyyqwuyllbmupczajxyb --owner 37335567
SUPABASE_CLI=../karteria/node_modules/.bin/supabase \
  python3 scripts/setup-studio.py configure --origin https://studio.un-real.ai
node scripts/setup-studio-github.mjs
```

The setup screen at `http://127.0.0.1:4313` prepares two GitHub registrations:

1. A sign-in OAuth app with callback
   `https://yvbpaajyfruqxtelsfoo.supabase.co/auth/v1/callback`. Save its client ID and
   secret through the local form. Device Flow stays disabled.
2. A private publishing GitHub App created from its manifest. Install it on
   **Only select repositories → un-real-landing**. Permissions are Contents write,
   Actions read and Deployments read. The local callback exchanges the manifest
   code and verifies the installation; its private key never enters the browser.

The files use `0600` permissions. Apply the final settings:

```sh
SUPABASE_CLI=../karteria/node_modules/.bin/supabase python3 scripts/setup-studio.py apply-auth
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs publisher
```

Supabase hooks restrict signup to the configured GitHub ID and give OAuth tokens
the MCP audience. Normal Studio tokens use the authenticated audience and must
not contain `client_id`. The API verifies JWT signatures using JWKS and checks
the server-held GitHub identity on each request. The private schema is not exposed
through the Supabase Data API, and `anon`/`authenticated` have no table grants.
A dedicated non-superuser, non-BYPASSRLS database login serves Lambda transactions.

Close the temporary setup server after registration. Keep setup files in a
private password-manager/encrypted backup. GitHub app key rotation requires
updating the publishing secret; sign-in secret rotation requires `apply-auth`.
Runtime secret changes take effect on a cold Lambda instance; deploy a new
version to switch configuration promptly. OAuth grant revocation does not need
a deployment.

## Migration, backups and restoration

The importer first creates a compressed byte-for-byte source backup locally and
in the private, versioned backup bucket, and verifies the remote checksum. It
imports manuscripts, comments, original revisions, legacy release history,
voice auditions and all media. It preserves Markdown bytes and asset references.
It then verifies record counts and all content/media hashes. An existing nonempty
workspace cannot be silently replaced. Legacy release history is retained as
immutable records and exact import files; no historical live status is invented.

```sh
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs import
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs probe
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs activate
node scripts/untrack-private-studio.mjs
```

Activation requires verified migration. Untracking checks the source manifest
again and uses `git rm --cached`: local originals and existing Git history remain.
The private hosted workspace becomes authoritative. Local writing remains an
explicit import/export workflow; there is no bidirectional filesystem sync.
Drafts, workbench files and new media are ignored by Git. Explicitly published
Markdown and referenced media remain tracked; the publishing app commits them
directly. For manual file publication, deliberately `git add -f` only the referenced
media files. Never add an entire private asset directory.

Take an operator backup after important writing sessions and before migrations:

```sh
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs backup
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs export-originals /private/tmp/studio-originals
```

Workspace backups include all records and ready media with checksums. Download
the named S3 backup/version, compare the recorded SHA-256, and keep an encrypted
off-account copy. S3 buckets retain versions and survive stack deletion. Supabase
backup retention depends on the project plan; the application backup works on
all plans. There is no scheduled application backup by default.

For disaster recovery, provision an empty replacement database, apply the schema,
configure its dedicated login, and point a private runtime config at that database:

```sh
python3 ../karteria/scripts/aws-env.py node scripts/studio-data.mjs restore /path/to/workspace-backup.json.gz
```

Restore verifies checksums, repins media versions, revokes saved MCP connections,
and stops pending side effects for explicit review/retry. It refuses a nonempty
workspace. Preserve the owner identity, sign in again, reconnect ChatGPT and
verify draft/revision/media counts before switching the hosted runtime. Source
import backups (`essay-studio-files-v1`) are separate from complete workspace
backups (`essay-studio-backup-v1`); unpack a source backup to a new content tree
and use the importer. Neither operation rewrites Git history.

## Audio, failures and operating costs

Connect ElevenLabs in the authenticated **Audio** panel. Its key is stored in
`unreal/essay-studio/elevenlabs`, not returned to the browser. The initial migration
preserves existing auditions but does not invent a missing provider key. Narration
requires an explicit Studio action. Long recordings run one part at a time with
durable progress, context-aware cached parts, narrator credit and stale detection.
Uploads use signed S3 POSTs with exact size/type/checksum restrictions: images up
to 12 MB; MP3/M4A/WAV/OGG up to 60 MB. Downloads expire after 15 minutes; refresh
the preview for new links. Portable Markdown always keeps local asset references.

A timeout after a provider request is **uncertain**: it may already have cost
credits. The worker stops; only an explicit retry can continue. Cached completed
parts are reused. The queue's visibility timeout exceeds the worker lease and
Lambda timeout. A durable outbox sweep covers crashes between a transaction and
queue delivery. Failed/uncertain jobs, worker errors, API error spikes and dead
letters have CloudWatch alarms. Logs omit manuscript contents and credentials.

The stack creates SNS topic `UnrealEssayStudio-alerts` and a $10/month AWS budget
with an 80% actual-spend alert, filtered by `Application=UnrealEssayStudio`. Activate
that cost-allocation tag in AWS Billing after it appears, then subscribe a chosen
email to the SNS topic and confirm its subscription. Alerts are not a spending
cap, and an unconfirmed topic subscription delivers no email. Supabase and
ElevenLabs are billed separately from this AWS budget. Review the DLQ and job
state before retrying; never bulk-replay uncertain audio work.

For the initial deployment, the `Application` cost-allocation tag was activated
on 2026-10-10 and the owner's chosen email was subscribed. AWS requires the owner
to confirm its subscription email before alerts can be delivered.

For a lightly used, single-author Studio, allow roughly **$3–10/month for AWS**
as an estimate, with storage, traffic and logs affecting the total. Three Secrets
Manager secrets are a small recurring baseline; Lambda and API Gateway scale
with use. Supabase Free may suffice and pauses inactive projects; on an existing
Pro organization an additional project starts at **$10/month**. Pro itself starts
at $25/month. ElevenLabs charges depend on the chosen plan and generated text.
Check current [Supabase pricing](https://supabase.com/pricing),
[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) and
[Lambda pricing](https://aws.amazon.com/lambda/pricing/) before changing capacity.

Public registration, collaborator roles, automatic model calls,
and an in-Studio AI chat are deliberately outside this version.
