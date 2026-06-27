import { X } from 'lucide-react';
import { AlertDialog, Dialog } from 'radix-ui';
import type { FormEvent, ReactNode } from 'react';
import { localized } from '../lib/i18n';

const t = localized({
  de: { close: 'Schließen', cancel: 'Abbrechen' },
  en: { close: 'Close', cancel: 'Cancel' },
});

/**
 * A modal dialog with title bar, scrolling body and a footer for the buttons. The body sits in
 * a form, so Enter in a text field triggers `onSubmit` like the default button of a desktop
 * dialog, and Escape cancels.
 */
export function Modal(props: {
  title: string;
  size?: 'narrow' | 'wide';
  onClose: () => void;
  onSubmit?: () => void;
  /** Buttons, right-aligned; put the primary action last. */
  footer: ReactNode;
  /** Message shown at the left of the footer, e.g. why saving failed. */
  error?: string | undefined;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit?.();
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={props.size ? `dialog dialog--${props.size}` : 'dialog'}
          aria-describedby={undefined}
        >
          <form className="dialog__form" onSubmit={submit} noValidate>
            <header className="dialog__header">
              <Dialog.Title className="dialog__title">{props.title}</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="btn btn--ghost btn--icon" aria-label={t.close}>
                  <X />
                </button>
              </Dialog.Close>
            </header>
            <div className="dialog__body">{props.children}</div>
            <footer className="dialog__footer">
              {props.error && (
                <span className="dialog__footer-start" role="alert">
                  {props.error}
                </span>
              )}
              {props.footer}
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Asks before something irreversible happens. Cancel is the default; Escape cancels. */
export function ConfirmDialog(props: {
  title: string;
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog dialog--narrow">
          <header className="dialog__header">
            <AlertDialog.Title className="dialog__title">{props.title}</AlertDialog.Title>
          </header>
          <div className="dialog__body">
            <AlertDialog.Description className="dialog__description" asChild>
              <div>{props.text}</div>
            </AlertDialog.Description>
          </div>
          <footer className="dialog__footer">
            {props.error && (
              <span className="dialog__footer-start" role="alert">
                {props.error}
              </span>
            )}
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn">
                {t.cancel}
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className={props.danger ? 'btn btn--danger' : 'btn btn--primary'}
              disabled={props.busy}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </footer>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
