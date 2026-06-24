import { randomBytes, randomUUID } from 'node:crypto';

import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { Pool } from 'pg';

import { OAuthStore } from './store.js';

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface TarsOAuthProviderOptions {
  /** Canonical resource/issuer identifier this server's tokens are bound to (RFC 8707). */
  resource: URL;
  /** Access-token lifetime in seconds (default 1 hour). */
  accessTokenTtlSeconds?: number;
  /** Refresh-token lifetime in seconds (default 30 days). */
  refreshTokenTtlSeconds?: number;
}

/**
 * Single-owner OAuth 2.1 provider backed by Postgres. Simplifications for one user:
 * `/authorize` auto-approves (no login/consent UI) and DCR accepts any client (public +
 * PKCE; client secret optional). Tokens are short-lived opaque strings; refresh tokens
 * rotate on use. Audience (RFC 8707) is enforced implicitly — only tokens minted by this
 * provider exist in the store, so foreign tokens never verify. PKCE (S256) is validated
 * by the SDK token handler via {@link challengeForAuthorizationCode}.
 */
export class TarsOAuthProvider implements OAuthServerProvider {
  private readonly store: OAuthStore;
  private readonly resource: URL;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(pool: Pool, options: TarsOAuthProviderOptions) {
    this.store = new OAuthStore(pool);
    this.resource = options.resource;
    this.accessTtl = options.accessTokenTtlSeconds ?? 60 * 60;
    this.refreshTtl = options.refreshTokenTtlSeconds ?? 60 * 60 * 24 * 30;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: async (client) => {
        const full: OAuthClientInformationFull = {
          ...client,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await this.store.saveClient(full);
        return full;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Single-owner: auto-approve. Mint a one-time authorization code and redirect back.
    const code = randomToken();
    await this.store.saveAuthCode({
      code,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      resource: params.resource?.href ?? null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state !== undefined) {
      target.searchParams.set('state', params.state);
    }
    res.redirect(target.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = await this.store.getAuthCode(authorizationCode);
    if (!code || code.clientId !== client.client_id || code.expiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError('invalid or expired authorization code');
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const code = await this.store.getAuthCode(authorizationCode);
    if (!code || code.clientId !== client.client_id || code.expiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError('invalid or expired authorization code');
    }
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    await this.store.deleteAuthCode(authorizationCode); // one-time use
    return this.issueTokens(client.client_id, code.scopes, code.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const stored = await this.store.getRefreshToken(refreshToken);
    if (
      !stored ||
      stored.clientId !== client.client_id ||
      stored.expiresAt.getTime() < Date.now()
    ) {
      throw new InvalidGrantError('invalid or expired refresh token');
    }
    await this.store.deleteRefreshToken(refreshToken); // rotation: old token is now dead
    const grantScopes = scopes && scopes.length > 0 ? scopes : stored.scopes;
    return this.issueTokens(client.client_id, grantScopes, stored.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = await this.store.getAccessToken(token);
    if (!stored) {
      throw new InvalidTokenError('invalid access token');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      await this.store.deleteAccessToken(token);
      throw new InvalidTokenError('access token expired');
    }
    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: Math.floor(stored.expiresAt.getTime() / 1000),
      resource: new URL(stored.resource ?? this.resource.href),
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.store.deleteAccessToken(request.token);
    await this.store.deleteRefreshToken(request.token);
  }

  private async issueTokens(
    clientId: string,
    scopes: string[],
    resource: string | null,
  ): Promise<OAuthTokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const boundResource = resource ?? this.resource.href;
    const now = Date.now();
    await this.store.saveAccessToken({
      token: accessToken,
      clientId,
      scopes,
      resource: boundResource,
      expiresAt: new Date(now + this.accessTtl * 1000),
    });
    await this.store.saveRefreshToken({
      token: refreshToken,
      clientId,
      scopes,
      resource: boundResource,
      expiresAt: new Date(now + this.refreshTtl * 1000),
    });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTtl,
      refresh_token: refreshToken,
      scope: scopes.length > 0 ? scopes.join(' ') : undefined,
    };
  }
}
