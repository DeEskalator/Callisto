import { shortcutLabel } from '../lib/platform';
import { Modal } from '../ui/Modal';

const SHORTCUTS: Array<[string, string]> = [
  [shortcutLabel({ key: 'n', alt: true }), 'Neuen Eintrag anlegen'],
  [shortcutLabel({ key: 'Enter' }), 'Ausgewählten Eintrag bearbeiten'],
  [shortcutLabel({ key: 'Delete' }), 'Ausgewählten Eintrag löschen'],
  [shortcutLabel({ key: 'r', alt: true }), 'Ansicht aktualisieren'],
  ['↑ ↓', 'Auswahl in einer Liste bewegen'],
  [
    `${shortcutLabel({ key: '1', alt: true })} … ${shortcutLabel({ key: '9', alt: true })}`,
    'Zu einem Bereich wechseln',
  ],
  ['Rechtsklick', 'Kontextmenü zum Eintrag öffnen'],
  [shortcutLabel({ key: 'Escape' }), 'Dialog schließen'],
];

export function ShortcutsDialog(props: { onClose: () => void }) {
  return (
    <Modal
      title="Tastenkürzel"
      size="narrow"
      onClose={props.onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={props.onClose}>
          Schließen
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
      title="Über Callisto"
      size="narrow"
      onClose={props.onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={props.onClose}>
          Schließen
        </button>
      }
    >
      <p className="dialog__description">
        Callisto ist der Telefonassistent der Praxis. Er nimmt Anrufe entgegen, vergibt Termine,
        nimmt Rezeptwünsche auf und verbindet bei Bedarf mit dem Praxisteam.
      </p>
    </Modal>
  );
}
