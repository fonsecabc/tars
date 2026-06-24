-- Up Migration
-- OAuth 2.1 state for the public (tunnel) ingress. Owned by @tars/server; kept in a
-- separate migrations dir + ledger so `core` stays free of transport/OAuth concerns.

CREATE TABLE oauth_clients (
  client_id  text PRIMARY KEY,
  client     jsonb NOT NULL,        -- full OAuthClientInformationFull (DCR result)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_auth_codes (
  code           text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,     -- PKCE S256 challenge (SDK verifies the verifier)
  scopes         text[] NOT NULL DEFAULT '{}',
  resource       text,              -- RFC 8707 resource indicator
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_access_tokens (
  token      text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes     text[] NOT NULL DEFAULT '{}',
  resource   text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_refresh_tokens (
  token      text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes     text[] NOT NULL DEFAULT '{}',
  resource   text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_access_tokens_expires_idx ON oauth_access_tokens (expires_at);
CREATE INDEX oauth_refresh_tokens_expires_idx ON oauth_refresh_tokens (expires_at);

-- Down Migration
DROP TABLE IF EXISTS oauth_refresh_tokens;
DROP TABLE IF EXISTS oauth_access_tokens;
DROP TABLE IF EXISTS oauth_auth_codes;
DROP TABLE IF EXISTS oauth_clients;
