import type { Permission } from '@callisto/domain';
import { localized } from '../../lib/i18n';

/** What each permission means, in the words of the practice. */
export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> =
  localized({
    de: {
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
    },
    en: {
      'dashboard.view': {
        label: 'View the daily overview',
        description: 'Open the overview with the calls and inquiries of the day.',
      },
      'calls.view': {
        label: 'View calls',
        description: 'See who called when and what it was about.',
      },
      'transcripts.view': {
        label: 'Read transcripts',
        description: 'Read the wording of the conversations with the assistant.',
      },
      'inquiries.manage': {
        label: 'Handle inquiries',
        description:
          'Mark appointments, prescription requests and callbacks as done or change them.',
      },
      'schedule.manage': {
        label: 'Manage scheduling',
        description: 'Create and change categories, slot templates and single slots.',
      },
      'settings.manage': {
        label: 'Configure assistant and practice',
        description: 'Change opening hours, closures, announcements and practice details.',
      },
      'users.manage': {
        label: 'Manage users and roles',
        description: 'Create user accounts, suspend them and assign roles to them.',
      },
      'testmode.use': {
        label: 'Use test mode',
        description: 'Hold test calls with the assistant by voice or text.',
      },
      'audit.view': {
        label: 'View the audit log',
        description: 'Trace who changed what and when.',
      },
    },
  });
