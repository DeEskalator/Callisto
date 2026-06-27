import { localized } from '../lib/i18n';
import { shortcutLabel } from '../lib/platform';
import { Modal } from '../ui/Modal';

const t = localized({
  de: {
    create: 'Neuen Eintrag anlegen',
    edit: 'Ausgewählten Eintrag bearbeiten',
    delete: 'Ausgewählten Eintrag löschen',
    refresh: 'Ansicht aktualisieren',
    move: 'Auswahl in einer Liste bewegen',
    switchArea: 'Zu einem Bereich wechseln',
    rightClick: 'Rechtsklick',
    contextMenu: 'Kontextmenü zum Eintrag öffnen',
    closeDialog: 'Dialog schließen',
    shortcuts: 'Tastenkürzel',
    close: 'Schließen',
    about: 'Über Callisto',
    description:
      'Callisto ist der Telefonassistent der Praxis. Er nimmt Anrufe entgegen, vergibt Termine, nimmt Rezeptwünsche auf und verbindet bei Bedarf mit dem Praxisteam.',
  },
  en: {
    create: 'Create a new entry',
    edit: 'Edit the selected entry',
    delete: 'Delete the selected entry',
    refresh: 'Refresh the view',
    move: 'Move the selection in a list',
    switchArea: 'Switch to an area',
    rightClick: 'Right-click',
    contextMenu: 'Open the context menu of an entry',
    closeDialog: 'Close a dialog',
    shortcuts: 'Keyboard shortcuts',
    close: 'Close',
    about: 'About Callisto',
    description:
      'Callisto is the phone assistant of the practice. It answers calls, books appointments, takes prescription requests and transfers to the practice team when needed.',
  },
});

const SHORTCUTS: Array<[string, string]> = [
  [shortcutLabel({ key: 'n', alt: true }), t.create],
  [shortcutLabel({ key: 'Enter' }), t.edit],
  [shortcutLabel({ key: 'Delete' }), t.delete],
  [shortcutLabel({ key: 'r', alt: true }), t.refresh],
  ['↑ ↓', t.move],
  [
    `${shortcutLabel({ key: '1', alt: true })} … ${shortcutLabel({ key: '9', alt: true })}`,
    t.switchArea,
  ],
  [t.rightClick, t.contextMenu],
  [shortcutLabel({ key: 'Escape' }), t.closeDialog],
];

export function ShortcutsDialog(props: { onClose: () => void }) {
  return (
    <Modal
      title={t.shortcuts}
      size="narrow"
      onClose={props.onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={props.onClose}>
          {t.close}
        </button>
      }
    >
      <dl className="props">
        {SHORTCUTS.map(([keys, description]) => (
          <div key={description} style={{ display: 'contents' }}>
            <dt>{keys}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function AboutDialog(props: { onClose: () => void }) {
  return (
    <Modal
      title={t.about}
      size="narrow"
      onClose={props.onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={props.onClose}>
          {t.close}
        </button>
      }
    >
      <p className="dialog__description">{t.description}</p>
    </Modal>
  );
}
