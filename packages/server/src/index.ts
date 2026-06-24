/**
 * @tars/server — the single transport-aware package: MCP over Streamable HTTP.
 * (OAuth + tunnel are added in Phase 5.)
 */
export { createApp } from './http-app.js';
export type { AppOptions, AuthConfig } from './http-app.js';
export { TarsOAuthProvider, type TarsOAuthProviderOptions } from './oauth/provider.js';
export { OAuthStore } from './oauth/store.js';
export { SERVER_MIGRATIONS_DIR, SERVER_MIGRATIONS_TABLE } from './migrations.js';
