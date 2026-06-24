import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Pool } from 'pg';

export interface StoredAuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string | null;
  expiresAt: Date;
}

export interface StoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  resource: string | null;
  expiresAt: Date;
}

type TokenRow = {
  token: string;
  client_id: string;
  scopes: string[];
  resource: string | null;
  expires_at: Date;
};

function mapToken(r: TokenRow): StoredToken {
  return {
    token: r.token,
    clientId: r.client_id,
    scopes: r.scopes,
    resource: r.resource,
    expiresAt: r.expires_at,
  };
}

/**
 * Postgres persistence for OAuth state: registered clients (DCR), one-time authorization
 * codes, and access/refresh tokens. All transport-layer state — lives in `@tars/server`.
 */
export class OAuthStore {
  constructor(private readonly pool: Pool) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const res = await this.pool.query<{ client: OAuthClientInformationFull }>(
      'SELECT client FROM oauth_clients WHERE client_id = $1',
      [clientId],
    );
    return res.rows[0]?.client;
  }

  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_clients (client_id, client) VALUES ($1, $2)
       ON CONFLICT (client_id) DO UPDATE SET client = EXCLUDED.client`,
      [client.client_id, client],
    );
  }

  async saveAuthCode(code: StoredAuthCode): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_auth_codes
         (code, client_id, redirect_uri, code_challenge, scopes, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        code.code,
        code.clientId,
        code.redirectUri,
        code.codeChallenge,
        code.scopes,
        code.resource,
        code.expiresAt,
      ],
    );
  }

  async getAuthCode(code: string): Promise<StoredAuthCode | undefined> {
    const res = await this.pool.query<{
      code: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      scopes: string[];
      resource: string | null;
      expires_at: Date;
    }>(
      `SELECT code, client_id, redirect_uri, code_challenge, scopes, resource, expires_at
       FROM oauth_auth_codes WHERE code = $1`,
      [code],
    );
    const r = res.rows[0];
    if (!r) {
      return undefined;
    }
    return {
      code: r.code,
      clientId: r.client_id,
      redirectUri: r.redirect_uri,
      codeChallenge: r.code_challenge,
      scopes: r.scopes,
      resource: r.resource,
      expiresAt: r.expires_at,
    };
  }

  async deleteAuthCode(code: string): Promise<void> {
    await this.pool.query('DELETE FROM oauth_auth_codes WHERE code = $1', [code]);
  }

  async saveAccessToken(token: StoredToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_access_tokens (token, client_id, scopes, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [token.token, token.clientId, token.scopes, token.resource, token.expiresAt],
    );
  }

  async getAccessToken(token: string): Promise<StoredToken | undefined> {
    const res = await this.pool.query<TokenRow>(
      `SELECT token, client_id, scopes, resource, expires_at
       FROM oauth_access_tokens WHERE token = $1`,
      [token],
    );
    const r = res.rows[0];
    return r ? mapToken(r) : undefined;
  }

  async deleteAccessToken(token: string): Promise<void> {
    await this.pool.query('DELETE FROM oauth_access_tokens WHERE token = $1', [token]);
  }

  async saveRefreshToken(token: StoredToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_refresh_tokens (token, client_id, scopes, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [token.token, token.clientId, token.scopes, token.resource, token.expiresAt],
    );
  }

  async getRefreshToken(token: string): Promise<StoredToken | undefined> {
    const res = await this.pool.query<TokenRow>(
      `SELECT token, client_id, scopes, resource, expires_at
       FROM oauth_refresh_tokens WHERE token = $1`,
      [token],
    );
    const r = res.rows[0];
    return r ? mapToken(r) : undefined;
  }

  async deleteRefreshToken(token: string): Promise<void> {
    await this.pool.query('DELETE FROM oauth_refresh_tokens WHERE token = $1', [token]);
  }

  /** Best-effort cleanup of expired codes/tokens. Safe to call periodically. */
  async pruneExpired(): Promise<void> {
    await this.pool.query('DELETE FROM oauth_auth_codes WHERE expires_at < now()');
    await this.pool.query('DELETE FROM oauth_access_tokens WHERE expires_at < now()');
    await this.pool.query('DELETE FROM oauth_refresh_tokens WHERE expires_at < now()');
  }
}
