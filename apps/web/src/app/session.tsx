import { WebStorageStateStore } from 'oidc-client-ts';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { AuthProvider, hasAuthParams, useAuth } from 'react-oidc-context';
import { localized } from '../lib/i18n';
import { Splash } from '../shell/Splash';
import type { OidcSettings } from './config';

const t = localized({
  de: {
    failed: 'Die Anmeldung ist fehlgeschlagen',
    retry: 'Erneut anmelden',
    signIn: 'Anmeldung',
    redirecting: 'Sie werden zur Anmeldung weitergeleitet …',
  },
  en: {
    failed: 'Sign-in failed',
    retry: 'Sign in again',
    signIn: 'Sign-in',
    redirecting: 'Taking you to the sign-in …',
  },
});

/** What the rest of the app needs to know about the signed-in user's session. */
export interface Session {
  /** Headers that identify the caller to the API. */
  authHeaders(): Promise<Record<string, string>>;
  signOut(): void;
  /** Development only: the demo users one can switch between. */
  devUsers?: Array<{ id: string; label: string }>;
  devUserId?: string;
  switchDevUser?(userId: string): void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used below a session provider');
  }
  return session;
}

/** Path the login page returns to; registered as callback URL of the Cognito app client. */
const CALLBACK_PATH = '/auth/callback';

/**
 * Signs the user in through Cognito's managed login (authorization code flow with PKCE). The app
 * never sees a password. Tokens are kept in session storage, i.e. for this tab only, and are
 * renewed in the background while the tab is open.
 */
export function OidcSessionProvider(props: { settings: OidcSettings; children: ReactNode }) {
  const { settings } = props;
  return (
    <AuthProvider
      authority={settings.authority}
      client_id={settings.clientId}
      redirect_uri={window.location.origin + CALLBACK_PATH}
      scope={settings.scope}
      response_type="code"
      automaticSilentRenew
      userStore={new WebStorageStateStore({ store: window.sessionStorage })}
      // Removes the authorization code from the address bar once it has been redeemed.
      onSigninCallback={() => window.history.replaceState({}, document.title, '/')}
    >
      <OidcSession settings={settings}>{props.children}</OidcSession>
    </AuthProvider>
  );
}

function OidcSession(props: { settings: OidcSettings; children: ReactNode }) {
  const auth = useAuth();
  const { settings } = props;
  const hasTriedSignin = useRef(false);
  const accessToken = useRef<string | undefined>(undefined);
  accessToken.current = auth.user?.access_token;

  useEffect(() => {
    const idle = !auth.isAuthenticated && !auth.activeNavigator && !auth.isLoading;
    if (idle && !hasAuthParams() && !hasTriedSignin.current) {
      hasTriedSignin.current = true;
      void auth.signinRedirect();
    }
  }, [auth]);

  // When the background renewal fails (e.g. the refresh token ran out), sign in again.
  useEffect(
    () => auth.events.addAccessTokenExpired(() => void auth.signinRedirect()),
    [auth.events, auth.signinRedirect],
  );

  const session = useMemo<Session>(
    () => ({
      authHeaders: async (): Promise<Record<string, string>> =>
        accessToken.current ? { Authorization: `Bearer ${accessToken.current}` } : {},
      signOut: () => {
        void auth.removeUser().then(() => {
          const logout = new URL('/logout', settings.loginBaseUrl);
          logout.searchParams.set('client_id', settings.clientId);
          logout.searchParams.set('logout_uri', `${window.location.origin}/`);
          window.location.assign(logout);
        });
      },
    }),
    [auth.removeUser, settings],
  );

  if (auth.error) {
    return (
      <Splash
        title={t.failed}
        text={auth.error.message}
        action={{ label: t.retry, run: () => void auth.signinRedirect() }}
      />
    );
  }
  if (!auth.isAuthenticated) {
    return <Splash title={t.signIn} text={t.redirecting} busy />;
  }
  return <SessionContext value={session}>{props.children}</SessionContext>;
}
