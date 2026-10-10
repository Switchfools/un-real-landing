import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { requireValue, fail } from './errors.mjs';

export function authenticator(config, db, dependencies = {}) {
  const jwks = dependencies.jwks || createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  const admin = dependencies.admin || createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (request, mcp = false) => {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    requireValue(token, 'Sign in to continue.', 401);
    let payload;
    try { ({ payload } = await jwtVerify(token, jwks, { issuer: `${config.supabaseUrl}/auth/v1`, audience: mcp ? `${config.origin}/mcp` : 'authenticated', algorithms: ['ES256', 'RS256'] })); }
    catch { throw fail('Your session is invalid or expired. Sign in again.', 401); }
    requireValue(typeof payload.sub === 'string', 'Invalid user identity.', 401);
    const clientId = typeof payload.client_id === 'string' ? payload.client_id : null;
    requireValue(mcp ? clientId : !clientId, mcp ? 'Connect through OAuth.' : 'OAuth clients cannot use Studio approval or publication endpoints.', 403);
    // User metadata can be edited by a user. Trust the provider identity held by Auth instead.
    const { data, error } = await admin.auth.admin.getUserById(payload.sub);
    requireValue(!error && data.user?.identities?.some(identity => identity.provider === 'github' && String(identity.identity_data?.provider_id || identity.identity_data?.sub || identity.id) === String(config.ownerGithubId)), 'This Studio is private.', 403);
    const identity = { owner: `github:${config.ownerGithubId}`, userId: payload.sub, clientId, permissions: ['read', 'propose'] };
    if (mcp) {
      const grant = await db.transaction(identity.owner, tx => tx.get('grant', clientId, false));
      requireValue(grant && !grant.revoked && grant.userId === payload.sub, 'This connection has not been approved or was revoked.', 403);
      identity.permissions = grant.permissions;
    }
    return identity;
  };
}
