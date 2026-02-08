/**
 * An independent second look at what the caller says. The model has its own emergency tool, but a
 * missed emergency is the worst mistake this system can make, so every utterance of the caller is
 * also checked here, outside the model, and a hit overrides the conversation.
 */
export interface EmergencyMonitor {
  isEmergency(utterance: string): Promise<boolean>;
}

// Phrases that describe something happening now. They are deliberately narrow: a false alarm
// ends a harmless call, and "ich hatte letztes Jahr einen Herzinfarkt" must not trigger one.
const ACUTE = [
  /(bekomm|krieg)\w* (ich )?(gerade |jetzt |kaum |fast )?keine luft/,
  /\b(akute|starke|schwere|plötzliche?) atemnot\b/,
  /\berstick/,
  /\b(starke|heftige|plötzliche?|stechende) (schmerzen in der brust|brustschmerzen)\b/,
  /\bbewusstlos\b/,
  /\b(ist |liegt )?(nicht|kaum) (mehr )?ansprechbar\b/,
  /\batmet nicht( mehr)?\b/,
  /\b(verdacht auf|gerade|jetzt|vermutlich) (einen |ein )?(schlaganfall|herzinfarkt)\b/,
  /\b(gesicht|mundwinkel) hängt\b/,
  /\bverblute/,
  /\b(starke|heftige) blutung\b.*\b(hört nicht auf|nicht zu stoppen)\b/,
  /\bkrampf(t|anfall)\b.*\b(gerade|jetzt|immer noch)\b/,
  /\b(allergischer|anaphylaktischer) schock\b/,
  /\b(mich|sich) umbringen\b/,
  /\bnicht mehr leben (will|möchte)\b/,
  /\bsuizid/,
];
const IN_THE_PAST = /\b(hatte|hatten|letztes jahr|vor \w+ (jahren|monaten|wochen)|damals|früher)\b/;

export class KeywordEmergencyMonitor implements EmergencyMonitor {
  async isEmergency(utterance: string): Promise<boolean> {
    const text = utterance.toLowerCase();
    return ACUTE.some((pattern) => pattern.test(text)) && !IN_THE_PAST.test(text);
  }
}
