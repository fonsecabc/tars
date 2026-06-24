/**
 * @tars/mcp — MCP tool definitions for the personal memory engine.
 *
 * Thin adapters over the core {@link Memory} facade. Depends on the MCP SDK (the
 * protocol contract) and zod, but knows nothing about HTTP / OAuth / transport — that
 * lives only in `@tars/server`.
 */
export { registerMemoryTools } from './tools.js';
