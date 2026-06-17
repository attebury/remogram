import { sanitizeField } from './caps.js';

/** Gitea does not expose OAuth scope or token expiry on GET /user. */
export function unimplementedTokenScopeSignal() {
  return { implemented: false, scopes: null };
}

export function unimplementedTokenExpirySignal() {
  return { implemented: false, expires_at: null };
}

/** Restricted Gitea users are read-only; others may write per forge policy. */
export function normalizeGiteaCanWrite(user) {
  if (user == null || typeof user !== 'object') return false;
  if (user.restricted === true) return false;
  return true;
}

export function buildProviderIdentityBody({
  login,
  can_write,
  token_scope_signal,
  token_expiry_signal,
}) {
  return {
    login: sanitizeField(login),
    can_write: Boolean(can_write),
    token_scope_signal,
    token_expiry_signal,
  };
}

export function buildProviderIdentityFromGiteaUser(user) {
  return buildProviderIdentityBody({
    login: user?.login ?? '',
    can_write: normalizeGiteaCanWrite(user),
    token_scope_signal: unimplementedTokenScopeSignal(),
    token_expiry_signal: unimplementedTokenExpirySignal(),
  });
}

export function parseGitHubOAuthScopes(headerValue) {
  if (headerValue == null || String(headerValue).trim() === '') {
    return unimplementedTokenScopeSignal();
  }
  const scopes = String(headerValue)
    .split(',')
    .map((scope) => sanitizeField(scope.trim()))
    .filter(Boolean);
  if (scopes.length === 0) {
    return unimplementedTokenScopeSignal();
  }
  return { implemented: true, scopes };
}

export function githubCanWriteFromScopes(tokenScopeSignal) {
  if (!tokenScopeSignal?.implemented || !Array.isArray(tokenScopeSignal.scopes)) {
    return false;
  }
  return tokenScopeSignal.scopes.some(
    (scope) => scope === 'repo' || scope === 'public_repo' || scope.startsWith('repo:'),
  );
}

export function buildProviderIdentityFromGitHubUser(user, oauthScopesHeader) {
  const token_scope_signal = parseGitHubOAuthScopes(oauthScopesHeader);
  return buildProviderIdentityBody({
    login: user?.login ?? '',
    can_write: githubCanWriteFromScopes(token_scope_signal),
    token_scope_signal,
    token_expiry_signal: unimplementedTokenExpirySignal(),
  });
}

export function normalizeGitLabCanWrite(user) {
  if (user == null || typeof user !== 'object') return false;
  if (user.state != null && user.state !== 'active') return false;
  if (user.can_create_project === false) return false;
  return true;
}

export function parseGitLabPatSelfSignals(patSelf) {
  if (patSelf == null || typeof patSelf !== 'object') {
    return {
      token_scope_signal: unimplementedTokenScopeSignal(),
      token_expiry_signal: unimplementedTokenExpirySignal(),
    };
  }
  let token_scope_signal = unimplementedTokenScopeSignal();
  if (Array.isArray(patSelf.scopes)) {
    const scopes = patSelf.scopes.map((scope) => sanitizeField(String(scope))).filter(Boolean);
    if (scopes.length > 0) {
      token_scope_signal = { implemented: true, scopes };
    }
  }
  const token_expiry_signal =
    'expires_at' in patSelf
      ? {
          implemented: true,
          expires_at: patSelf.expires_at == null ? null : sanitizeField(String(patSelf.expires_at)),
        }
      : unimplementedTokenExpirySignal();
  return { token_scope_signal, token_expiry_signal };
}

export function buildProviderIdentityFromGitLabUser(user, patSelf) {
  const { token_scope_signal, token_expiry_signal } = parseGitLabPatSelfSignals(patSelf);
  return buildProviderIdentityBody({
    login: user?.username ?? user?.login ?? '',
    can_write: normalizeGitLabCanWrite(user),
    token_scope_signal,
    token_expiry_signal,
  });
}
