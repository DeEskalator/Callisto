import type { Permission } from '@callisto/domain';

/** What each permission means, in the words of the practice. */
export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  'dashboard.view': {
    label: 'Tagesgeschehen ansehen',
    description: 'Die Übersicht mit den Anrufen und Anliegen des Tages öffnen.',
  },
  'calls.view': {
    label: 'Anrufe ansehen',
    description: 'Sehen, wer wann angerufen hat und worum es ging.',
  },
  'transcripts.view': {
    label: 'Transkripte lesen',
    description: 'Den Wortlaut der Gespräche mit dem Assistenten lesen.',
  },
  'inquiries.manage': {
    label: 'Anliegen bearbeiten',
    description: 'Termine, Rezeptwünsche und Rückrufe als erledigt markieren oder ändern.',
  },
  'schedule.manage': {
    label: 'Terminplanung verwalten',
    description: 'Kategorien, Slot-Vorlagen und einzelne Slots anlegen und ändern.',
  },
  'settings.manage': {
    label: 'Assistent und Praxis einstellen',
    description: 'Sprechzeiten, Schließzeiten, Ansagen und Praxisdaten ändern.',
  },
  'users.manage': {
    label: 'Benutzer und Rollen verwalten',
    description: 'Benutzerkonten anlegen, sperren und ihnen Rollen zuweisen.',
  },
  'testmode.use': {
    label: 'Testmodus verwenden',
    description: 'Probeanrufe mit dem Assistenten per Sprache oder Text führen.',
  },
  'audit.view': {
    label: 'Protokoll einsehen',
    description: 'Nachvollziehen, wer wann was geändert hat.',
  },
};
