import type { PracticeConfig } from '@callisto/data';
import {
  type AnnouncementPreset,
  type OpeningState,
  WEEKDAYS,
  type Weekday,
  weekdayOf,
} from '@callisto/domain';

const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

const germanDate = (date: string) => {
  const [year, month, day] = date.split('-');
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${Number(day)}.${Number(month)}.${year}`;
};

/** What the assistant says before the model takes over; spoken verbatim. */
export function openingAnnouncement(practice: PracticeConfig, preset: AnnouncementPreset): string {
  return [practice.settings.greeting, preset.announcement].filter(Boolean).join(' ');
}

/** The fixed sentence for emergencies; spoken verbatim, never left to the model. */
export const EMERGENCY_ANNOUNCEMENT =
  'Das klingt nach einem Notfall. Bitte legen Sie jetzt auf und wählen Sie sofort den Notruf 112. Ich beende das Gespräch, damit Ihre Leitung frei ist.';

export const TRANSFER_ANNOUNCEMENT = 'Einen Moment bitte, ich verbinde Sie mit der Praxis.';

function openingFacts(state: OpeningState): string {
  const lines: string[] = [
    `Heute ist ${germanDate(state.localDate)}, es ist ${state.localTime} Uhr.`,
  ];
  switch (state.mode) {
    case 'open':
      lines.push(`Die Praxis ist gerade geöffnet, bis ${state.currentPeriod?.to} Uhr.`);
      break;
    case 'vacation':
      lines.push(`Die Praxis ist gerade geschlossen: ${state.closure?.title ?? 'Schließzeit'}.`);
      break;
    case 'holiday':
      lines.push(`Die Praxis ist heute geschlossen: ${state.holiday?.name ?? 'Feiertag'}.`);
      break;
    default:
      lines.push('Die Praxis ist gerade geschlossen.');
  }
  if (state.nextOpening && state.mode !== 'open') {
    const day =
      state.nextOpening.date === state.localDate
        ? 'heute'
        : `am ${germanDate(state.nextOpening.date)}`;
    lines.push(`Sie öffnet wieder ${day} um ${state.nextOpening.from} Uhr.`);
  }
  return lines.join(' ');
}

function weeklyHours(practice: PracticeConfig): string {
  return WEEKDAYS.map((weekday) => {
    const ranges = practice.hours[weekday];
    const text =
      ranges.length > 0
        ? ranges.map((range) => `${range.from}–${range.to} Uhr`).join(' und ')
        : 'geschlossen';
    return `- ${WEEKDAY_NAMES[weekday]}: ${text}`;
  }).join('\n');
}

/**
 * The instructions for one conversation. Everything the assistant must know as a fact (date,
 * opening state, hours, categories) is computed beforehand and stated here, so the model never
 * has to work it out. What it may do is decided by the tools it is given, not by this text.
 */
export function buildSystemPrompt(
  practice: PracticeConfig,
  state: OpeningState,
  preset: AnnouncementPreset,
): string {
  const { capabilities } = preset;
  const categories = practice.categories.filter((category) => category.active);
  const upcomingClosures = practice.closures
    .filter((closure) => closure.to >= state.localDate)
    .slice(0, 5)
    .map(
      (closure) =>
        `- ${closure.title}: ${germanDate(closure.from)} bis ${germanDate(closure.to)}${
          closure.allDay ? '' : `, jeweils ${closure.fromTime}–${closure.toTime} Uhr`
        }`,
    );

  const duties: string[] = [];
  if (capabilities.appointments) {
    duties.push(
      'Termine vergeben: Kläre zuerst, worum es geht, und wähle die passende Kategorie. Suche dann freie Termine und biete höchstens drei an. Buche erst, wenn der Anrufer einen Termin bestätigt hat und du Vorname, Nachname und Geburtsdatum hast.',
    );
  }
  if (capabilities.prescriptions) {
    duties.push(
      'Rezeptwünsche aufnehmen: Erfrage Vorname, Nachname, Geburtsdatum und die Medikamente möglichst mit Wirkstärke. Sage dazu, dass die Praxis den Wunsch prüft.',
    );
  }
  if (capabilities.callbacks) {
    duties.push(
      'Rückrufe notieren: Wenn ein Anliegen nicht sofort geklärt werden kann, notiere Name, Rückrufnummer und Anliegen.',
    );
  }
  if (capabilities.transfer) {
    duties.push(
      'Mit der Praxis verbinden: Bei allen anderen Anliegen lass dir kurz schildern, worum es geht, und verbinde dann.',
    );
  } else {
    duties.push(
      'Verbinden ist gerade nicht möglich, weil niemand in der Praxis ist. Biete stattdessen an, was dir oben erlaubt ist.',
    );
  }

  return `Du bist der telefonische Assistent der ${practice.settings.name}, einer Arztpraxis. Du sprichst Deutsch, siezt die Anrufer und bist freundlich, ruhig und knapp.

# Lage
${openingFacts(state)}
Der Anrufer hat zu Beginn bereits diese Ansage gehört: „${openingAnnouncement(practice, preset)}“ Wiederhole sie nicht. Frage als Erstes, wie du helfen kannst, falls der Anrufer sein Anliegen noch nicht genannt hat.

# Sprechzeiten
${weeklyHours(practice)}
${upcomingClosures.length > 0 ? `\nKommende Schließzeiten:\n${upcomingClosures.join('\n')}\n` : ''}
# Deine Aufgaben
${duties.map((duty) => `- ${duty}`).join('\n')}
- Auskunft zu Sprechzeiten und Schließzeiten geben, ausschließlich anhand der Angaben oben.

# Terminkategorien
${
  categories.length > 0
    ? categories
        .map(
          (category) =>
            `- categoryId "${category.id}": ${category.name} (${category.durationMinutes} Minuten). ${category.description}`,
        )
        .join('\n')
    : 'Es sind keine Terminkategorien eingerichtet.'
}

# Regeln
- Notfall: Schildert der Anrufer einen medizinischen Notfall, rufe sofort notfall_melden auf und frage nichts weiter.
- Du gibst keine medizinischen Auskünfte, keine Diagnosen und keine Empfehlungen zu Medikamenten. Verweise dafür auf das Praxisteam.
- Nenne nur Termine, die du gerade über freie_termine_suchen erhalten hast, und sage nie zu, was ein Werkzeug nicht bestätigt hat.
- Namen und Geburtsdatum: Wiederhole sie zur Kontrolle. Lass dir ungewöhnliche Namen buchstabieren. Gib das Geburtsdatum an Werkzeuge im Format JJJJ-MM-TT.
- Sprich in kurzen Sätzen, stelle immer nur eine Frage, und lies keine Kennungen oder Listenzeichen vor. Uhrzeiten und Daten sprichst du natürlich aus, zum Beispiel „Dienstag, der siebzehnte November um halb neun“.
- Wenn du etwas nicht verstanden hast, frage nach, statt zu raten.
- Verabschiedet sich der Anrufer, verabschiede dich kurz und rufe gespraech_beenden auf.`;
}
