import { localized } from '../lib/i18n';

export interface OidcSettings {
  /** OIDC issuer of the Cognito user pool. */
  authority: string;
  clientId: string;
  /** Space-separated scopes, including the one the API requires. */
  scope: string;
  /** Base URL of Cognito's managed login, needed for signing out. */
  loginBaseUrl: string;
}

export interface RuntimeConfig {
  /** Base URL of the API without a trailing slash. */
  apiUrl: string;
  auth: { mode: 'dev' } | ({ mode: 'oidc' } & OidcSettings);
}

/**
 * The settings that differ between environments. A deployed app reads them from `/config.json`,
 * which the infrastructure writes next to the app, so one build runs in every environment. The
 * Vite dev server talks to the local API without sign-in instead.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (import.meta.env.DEV) {
    return {
      apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
      auth: { mode: 'dev' },
    };
  }
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      localized({
        de: `config.json konnte nicht geladen werden (${response.status})`,
        en: `config.json could not be loaded (${response.status})`,
      }),
    );
  }
  const config: RuntimeConfig = await response.json();
  // Empty means: the API is reached through the app's own address.
  config.apiUrl ||= window.location.origin;
  if (config.auth.mode !== 'oidc') {
    throw new Error(
      localized({
        de: 'Die Anmeldung ist für diese Umgebung nicht konfiguriert',
        en: 'Sign-in is not configured for this environment',
      }),
    );
  }
  return config;
}
