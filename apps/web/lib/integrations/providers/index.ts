/**
 * Provider implementations for apps/web
 *
 * These implementations connect the interfaces from @openloomi/integrations/core
 * to the concrete infrastructure in apps/web (DB, storage, auth, config).
 */

export { credentialStore, WebCredentialStore } from "./credential-store";
export { fileIngester, WebFileIngester } from "./file-ingester";
export { authProvider, WebAuthProvider } from "./auth-provider";
export { configProvider, WebConfigProvider } from "./config-provider";
