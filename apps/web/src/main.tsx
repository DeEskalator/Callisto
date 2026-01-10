import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/features.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { lazy, type ReactNode, StrictMode, Suspense, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext, ApiError, createApiClient } from './app/api';
import { loadRuntimeConfig, type RuntimeConfig } from './app/config';
import { router } from './app/router';
import { OidcSessionProvider, useSession } from './app/session';
import { initTheme } from './lib/theme';
import { Splash } from './shell/Splash';
import { ToastProvider } from './ui/Toast';

// The stand-in for the sign-in exists only in the dev server; a production build drops it.
const DevSessionProvider = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('./app/dev-session')).DevSessionProvider }))
  : undefined;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying helps with a flaky connection or a server error, not with a rejected request.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status > 0 && error.status < 500),
    },
  },
});

function SessionProvider(props: { config: RuntimeConfig; children: ReactNode }) {
  const { auth } = props.config;
  if (auth.mode === 'oidc') {
    return <OidcSessionProvider settings={auth}>{props.children}</OidcSessionProvider>;
  }
  if (DevSessionProvider) {
    return <DevSessionProvider>{props.children}</DevSessionProvider>;
  }
  return <Splash title="Die Anmeldung ist für diese Umgebung nicht konfiguriert" />;
}

function ApiProvider(props: { apiUrl: string; children: ReactNode }) {
  const session = useSession();
  const api = useMemo(() => createApiClient(props.apiUrl, session), [props.apiUrl, session]);
  return <ApiContext value={api}>{props.children}</ApiContext>;
}

function App(props: { config: RuntimeConfig }) {
  return (
    <Suspense fallback={<Splash title="Callisto" busy />}>
      <SessionProvider config={props.config}>
        <ApiProvider apiUrl={props.config.apiUrl}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </Suspense>
  );
}

initTheme();
const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<Splash title="Callisto" busy />);

try {
  const config = await loadRuntimeConfig();
  root.render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <Splash
      title="Callisto kann nicht gestartet werden"
      text={error instanceof Error ? error.message : undefined}
      action={{ label: 'Erneut versuchen', run: () => window.location.reload() }}
    />,
  );
}
