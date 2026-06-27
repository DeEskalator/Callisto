import { X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { localized } from '../lib/i18n';

const t = localized({
  de: { notification: 'Meldung', dismiss: 'Meldung schließen' },
  en: { notification: 'Notification', dismiss: 'Dismiss notification' },
});

interface Notification {
  id: number;
  kind: 'success' | 'error';
  title: string;
  text?: string | undefined;
}

type Notify = (notification: Omit<Notification, 'id'>) => void;

const NotifyContext = createContext<Notify>(() => {});

/** Shows a short message in the corner of the window, e.g. after something was saved. */
export function useNotify(): Notify {
  return useContext(NotifyContext);
}

let nextId = 1;

export function ToastProvider(props: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback<Notify>((notification) => {
    setNotifications((current) => [...current, { ...notification, id: nextId++ }]);
  }, []);
  const dismiss = (id: number) =>
    setNotifications((current) => current.filter((notification) => notification.id !== id));

  return (
    <NotifyContext value={notify}>
      <Toast.Provider swipeDirection="right" label={t.notification}>
        {props.children}
        {notifications.map((notification) => (
          <Toast.Root
            key={notification.id}
            className={notification.kind === 'error' ? 'toast toast--error' : 'toast'}
            // Errors stay until dismissed; confirmations go away by themselves.
            duration={notification.kind === 'error' ? Number.POSITIVE_INFINITY : 4000}
            onOpenChange={(open) => !open && dismiss(notification.id)}
          >
            <div>
              <Toast.Title className="toast__title">{notification.title}</Toast.Title>
              {notification.text && (
                <Toast.Description className="toast__text">{notification.text}</Toast.Description>
              )}
            </div>
            <Toast.Close asChild>
              <button
                type="button"
                className="btn btn--ghost btn--icon toast__close"
                aria-label={t.dismiss}
              >
                <X />
              </button>
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    </NotifyContext>
  );
}
