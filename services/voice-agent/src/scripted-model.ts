import type { ConversationModel, ModelConfig, ModelEvents, ModelSession } from './model';

type Step =
  | 'idle'
  | 'pick_category'
  | 'pick_slot'
  | 'identify_for_appointment'
  | 'medications'
  | 'identify_for_prescription'
  | 'identify_for_callback';

interface OfferedSlot {
  slotId: string;
  date: string;
  weekday: string;
  time: string;
}

const germanDate = (date: string) => {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.`;
};

/** "Max Mustermann, 1.2.1980" or "Max Mustermann 01.02.1980" */
function parseIdentity(text: string) {
  const date = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/.exec(text);
  const phone = /(\+?\d[\d /-]{6,}\d)/.exec(text.replace(date?.[0] ?? '', ''));
  const names = text
    .replace(date?.[0] ?? '', '')
    .replace(phone?.[0] ?? '', '')
    .split(/[\s,;]+/)
    .filter((word) => /^[A-Za-zÄÖÜäöüß-]{2,}$/.test(word))
    .filter((word) => !/^(ich|bin|heiße|mein|name|ist|geboren|am|und|der|die|nummer)$/i.test(word));
  return {
    firstName: names.length > 1 ? names[0] : undefined,
    lastName: names.length > 1 ? names[names.length - 1] : names[0],
    dateOfBirth: date
      ? `${date[3]}-${date[2]?.padStart(2, '0')}-${date[1]?.padStart(2, '0')}`
      : undefined,
    phone: phone?.[1]?.replace(/[\s/-]/g, ''),
  };
}

/**
 * A stand-in for the language model that follows a fixed script. It exists so that the whole
 * path (test panel, session, tools, bookings, dashboard) can be run and tested on a developer's
 * machine without an AWS account. It understands typed keywords only and is no measure of how
 * the real assistant converses.
 */
export class ScriptedModel implements ConversationModel {
  async start(config: ModelConfig, events: ModelEvents): Promise<ModelSession> {
    const has = (tool: string) => config.tools.some((spec) => spec.name === tool);
    const categories = [...config.systemPrompt.matchAll(/categoryId "([^"]+)": ([^(]+) \(/g)].map(
      (match) => ({ id: match[1] as string, name: (match[2] as string).trim() }),
    );
    const situation = /# Lage\n([^\n]+)/.exec(config.systemPrompt)?.[1] ?? '';

    let step: Step = 'idle';
    let offered: OfferedSlot[] = [];
    let chosen: OfferedSlot | undefined;
    let medications = '';
    let topic = '';
    let pendingTool = '';
    let nextToolId = 1;
    let closed = false;
    let warnedAboutAudio = false;

    const say = (text: string) => setTimeout(() => !closed && events.onAssistantText(text), 250);
    const call = (name: string, input: Record<string, unknown>) => {
      pendingTool = name;
      setTimeout(
        () => !closed && events.onToolUse({ id: `tool-${nextToolId++}`, name, input }),
        250,
      );
    };
    const searchSlots = (categoryId: string) => {
      step = 'idle';
      call('freie_termine_suchen', { categoryId });
    };

    const handle = (text: string) => {
      const lower = text.toLowerCase();
      if (/tschüss|wiederhören|wiedersehen|das war alles|nein danke|das wars/.test(lower)) {
        say('Gern geschehen. Auf Wiederhören!');
        return call('gespraech_beenden', {});
      }
      switch (step) {
        case 'pick_category': {
          const category = categories.find((candidate) =>
            lower.includes(candidate.name.toLowerCase().slice(0, 5)),
          );
          return category
            ? searchSlots(category.id)
            : say(
                `Ich kann anbieten: ${categories.map((each) => each.name).join(', ')}. Was passt?`,
              );
        }
        case 'pick_slot': {
          if (/nein|kein|andere|später/.test(lower)) {
            step = 'idle';
            return say('In Ordnung. Kann ich sonst etwas für Sie tun?');
          }
          const index = /zweit|2\./.test(lower) ? 1 : /dritt|3\./.test(lower) ? 2 : 0;
          chosen = offered[index] ?? offered[0];
          step = 'identify_for_appointment';
          return say('Gern. Nennen Sie mir bitte Vorname, Nachname und Geburtsdatum.');
        }
        case 'identify_for_appointment':
          return call('termin_buchen', { slotId: chosen?.slotId, ...parseIdentity(text) });
        case 'medications':
          medications = text;
          step = 'identify_for_prescription';
          return say('Danke. Nennen Sie mir bitte Vorname, Nachname und Geburtsdatum.');
        case 'identify_for_prescription':
          return call('rezept_bestellen', {
            ...parseIdentity(text),
            medications: medications.split(/,| und /).map((name) => ({ name: name.trim() })),
          });
        case 'identify_for_callback':
          return call('rueckruf_notieren', { ...parseIdentity(text), topic });
        default:
          break;
      }
      if (has('freie_termine_suchen') && /termin/.test(lower)) {
        const category = categories.find((candidate) =>
          lower.includes(candidate.name.toLowerCase().slice(0, 5)),
        );
        if (category) {
          return searchSlots(category.id);
        }
        step = 'pick_category';
        return say(
          `Gern. Wofür brauchen Sie den Termin? Ich kann anbieten: ${categories.map((each) => each.name).join(', ')}.`,
        );
      }
      if (has('rezept_bestellen') && /rezept|medikament|tabletten/.test(lower)) {
        step = 'medications';
        return say('Gern. Welches Medikament benötigen Sie?');
      }
      if (/sprechzeit|geöffnet|offen|öffnungszeit|wann/.test(lower)) {
        return say(`${situation} Kann ich sonst etwas für Sie tun?`);
      }
      if (has('mit_praxis_verbinden')) {
        return call('mit_praxis_verbinden', { summary: text });
      }
      if (has('rueckruf_notieren')) {
        topic = text;
        step = 'identify_for_callback';
        return say(
          'Dazu notiere ich gern eine Rückrufbitte. Nennen Sie mir bitte Ihren Namen und eine Rückrufnummer.',
        );
      }
      return say(
        'Dabei kann ich im Moment leider nicht helfen. Bitte rufen Sie zur Sprechzeit wieder an.',
      );
    };

    const afterTool = (result: Record<string, unknown>) => {
      const tool = pendingTool;
      pendingTool = '';
      if (result.ok !== true) {
        return say(String(result.message ?? 'Das hat leider nicht geklappt.'));
      }
      switch (tool) {
        case 'freie_termine_suchen': {
          offered = (result.slots as OfferedSlot[]) ?? [];
          if (offered.length === 0) {
            return say(`${result.message} Kann ich sonst etwas für Sie tun?`);
          }
          step = 'pick_slot';
          const list = offered
            .map((slot) => `${slot.weekday}, ${germanDate(slot.date)} um ${slot.time} Uhr`)
            .join('; ');
          return say(`Ich habe folgende Termine frei: ${list}. Welcher passt Ihnen?`);
        }
        case 'termin_buchen': {
          step = 'idle';
          const booked = result.booked as { weekday: string; date: string; time: string };
          const hint = result.hintForPatient ? ` ${result.hintForPatient}` : '';
          return say(
            `Ihr Termin ist gebucht: ${booked.weekday}, ${germanDate(booked.date)} um ${booked.time} Uhr.${hint} Kann ich sonst etwas für Sie tun?`,
          );
        }
        default:
          step = 'idle';
          return say(`${result.message ?? 'Das ist notiert.'} Kann ich sonst etwas für Sie tun?`);
      }
    };

    return {
      sendAudio: () => {
        if (!warnedAboutAudio) {
          warnedAboutAudio = true;
          say('Im lokalen Demo-Modus verstehe ich keine Sprache. Bitte tippen Sie Ihre Antwort.');
        }
      },
      sendText: handle,
      sendToolResult: (_id, result) => afterTool(result as Record<string, unknown>),
      close: async () => {
        closed = true;
      },
    };
  }
}
