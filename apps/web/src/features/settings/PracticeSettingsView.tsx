import { FEDERAL_STATES, type PracticeSettings, PracticeSettingsSchema } from '@callisto/domain';
import { useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { localized } from '../../lib/i18n';
import { discardCommand, saveCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { FormRow, FormSection } from '../../ui/Form';
import { QueryState } from '../../ui/QueryState';
import { useEditablePage } from '../../ui/useEditablePage';

const STATE_NAMES: Record<(typeof FEDERAL_STATES)[number], string> = localized({
  de: {
    BW: 'Baden-Württemberg',
    BY: 'Bayern',
    BE: 'Berlin',
    BB: 'Brandenburg',
    HB: 'Bremen',
    HH: 'Hamburg',
    HE: 'Hessen',
    MV: 'Mecklenburg-Vorpommern',
    NI: 'Niedersachsen',
    NW: 'Nordrhein-Westfalen',
    RP: 'Rheinland-Pfalz',
    SL: 'Saarland',
    SN: 'Sachsen',
    ST: 'Sachsen-Anhalt',
    SH: 'Schleswig-Holstein',
    TH: 'Thüringen',
  },
  en: {
    BW: 'Baden-Württemberg',
    BY: 'Bavaria',
    BE: 'Berlin',
    BB: 'Brandenburg',
    HB: 'Bremen',
    HH: 'Hamburg',
    HE: 'Hesse',
    MV: 'Mecklenburg-Western Pomerania',
    NI: 'Lower Saxony',
    NW: 'North Rhine-Westphalia',
    RP: 'Rhineland-Palatinate',
    SL: 'Saarland',
    SN: 'Saxony',
    ST: 'Saxony-Anhalt',
    SH: 'Schleswig-Holstein',
    TH: 'Thuringia',
  },
});

const t = localized({
  de: {
    title: 'Praxis',
    saved: 'Die Praxiseinstellungen wurden gespeichert',
    unsaved: 'Ungespeicherte Änderungen',
    practice: 'Praxis',
    name: 'Name der Praxis',
    federalState: 'Bundesland',
    federalStateHint:
      'Bestimmt die gesetzlichen Feiertage, an denen die Praxis als geschlossen gilt.',
    phone: 'Telefon',
    greeting: 'Begrüßung',
    greetingHint:
      'Der erste Satz jedes Gesprächs. Er muss dem Anrufer sagen, dass ein KI-Assistent spricht.',
    transfer: 'Weiterleitung an',
    transferHint:
      'Die Leitung der Praxis, an die der Assistent Anrufer verbindet, im Format +49… Sie darf nicht die Nummer sein, die auf den Assistenten umgeleitet wird.',
    booking: 'Terminvergabe',
    horizon: 'Buchbar im Voraus',
    horizonHint: 'So weit in die Zukunft bietet der Assistent Termine an.',
    days: 'Tage',
    lead: 'Vorlaufzeit',
    leadHint: 'Termine, die früher beginnen, werden nicht mehr angeboten.',
    minutes: 'Minuten',
    retention: 'Aufbewahrung',
    transcripts: 'Transkripte',
    transcriptsHint:
      'Nach dieser Zeit werden die Gesprächsmitschriften automatisch gelöscht. Tonaufnahmen werden nie gespeichert.',
    inquiries: 'Anliegen',
    inquiriesHint:
      'Terminbuchungen, Rezeptwünsche und Rückrufbitten werden nach dieser Zeit gelöscht.',
  },
  en: {
    title: 'Practice',
    saved: 'The practice settings were saved',
    unsaved: 'Unsaved changes',
    practice: 'Practice',
    name: 'Name of the practice',
    federalState: 'Federal state',
    federalStateHint: 'Determines the public holidays on which the practice counts as closed.',
    phone: 'Phone',
    greeting: 'Greeting',
    greetingHint:
      'The first sentence of every call. It must tell the caller that an AI assistant is speaking.',
    transfer: 'Transfer to',
    transferHint:
      'The practice line the assistant puts callers through to, in the format +49… It must not be the number that is forwarded to the assistant.',
    booking: 'Appointments',
    horizon: 'Bookable in advance',
    horizonHint: 'How far into the future the assistant offers appointments.',
    days: 'days',
    lead: 'Lead time',
    leadHint: 'Appointments that start sooner are no longer offered.',
    minutes: 'minutes',
    retention: 'Retention',
    transcripts: 'Transcripts',
    transcriptsHint:
      'After this time, conversation transcripts are deleted automatically. Audio is never stored.',
    inquiries: 'Inquiries',
    inquiriesHint:
      'Appointment bookings, prescription requests and callback requests are deleted after this time.',
  },
});

/** Master data of the practice and the general behaviour of the assistant. */
export function PracticeSettingsView() {
  const config = useConfig();
  if (!config.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={config} />
      </ViewFrame>
    );
  }
  return <PracticeSettingsEditor settings={config.data.settings} />;
}

function PracticeSettingsEditor(props: { settings: PracticeSettings }) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const canManage = useHasPermission('settings.manage');

  const page = useEditablePage({
    server: props.settings,
    schema: PracticeSettingsSchema,
    save: async (settings) => {
      await api.admin.settings.$put({ json: settings });
      await invalidate();
    },
    savedMessage: t.saved,
  });
  const { value: settings, errors, set } = page;

  return (
    <ViewFrame
      title={t.title}
      padded
      status={page.dirty ? t.unsaved : undefined}
      commands={[
        saveCommand(page.save, !page.dirty || page.saving || !canManage),
        discardCommand(page.discard, !page.dirty),
      ]}
    >
      <fieldset className="form form--page" disabled={!canManage}>
        <FormSection>{t.practice}</FormSection>
        <FormRow label={t.name} error={errors.name}>
          {(id) => (
            <input
              id={id}
              className="input"
              value={settings.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </FormRow>
        <FormRow label={t.federalState} error={errors.federalState} hint={t.federalStateHint}>
          {(id) => (
            <select
              id={id}
              className="select"
              value={settings.federalState}
              onChange={(event) =>
                set({ federalState: event.target.value as PracticeSettings['federalState'] })
              }
            >
              {FEDERAL_STATES.map((state) => (
                <option key={state} value={state}>
                  {STATE_NAMES[state]}
                </option>
              ))}
            </select>
          )}
        </FormRow>

        <FormSection>{t.phone}</FormSection>
        <FormRow label={t.greeting} error={errors.greeting} hint={t.greetingHint}>
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              rows={3}
              value={settings.greeting}
              aria-invalid={Boolean(errors.greeting)}
              onChange={(event) => set({ greeting: event.target.value })}
            />
          )}
        </FormRow>
        <FormRow label={t.transfer} error={errors.transferNumber} hint={t.transferHint}>
          {(id) => (
            <input
              id={id}
              type="tel"
              className="input input--narrow"
              placeholder="+4930123456"
              value={settings.transferNumber ?? ''}
              aria-invalid={Boolean(errors.transferNumber)}
              onChange={(event) =>
                set({ transferNumber: event.target.value.replace(/\s/g, '') || undefined })
              }
            />
          )}
        </FormRow>

        <FormSection>{t.booking}</FormSection>
        <FormRow label={t.horizon} error={errors.bookingHorizonDays} hint={t.horizonHint}>
          {(id) => (
            <div className="form__row">
              <input
                id={id}
                type="number"
                className="input input--tiny"
                min={1}
                max={365}
                value={settings.bookingHorizonDays}
                onChange={(event) => set({ bookingHorizonDays: event.target.valueAsNumber })}
              />
              {t.days}
            </div>
          )}
        </FormRow>
        <FormRow label={t.lead} error={errors.bookingLeadMinutes} hint={t.leadHint}>
          {(id) => (
            <div className="form__row">
              <input
                id={id}
                type="number"
                className="input input--tiny"
                min={0}
                step={15}
                value={settings.bookingLeadMinutes}
                onChange={(event) => set({ bookingLeadMinutes: event.target.valueAsNumber })}
              />
              {t.minutes}
            </div>
          )}
        </FormRow>

        <FormSection>{t.retention}</FormSection>
        <FormRow
          label={t.transcripts}
          error={errors['retention.transcriptDays']}
          hint={t.transcriptsHint}
        >
          {(id) => (
            <div className="form__row">
              <input
                id={id}
                type="number"
                className="input input--tiny"
                min={1}
                value={settings.retention.transcriptDays}
                onChange={(event) =>
                  set({
                    retention: {
                      ...settings.retention,
                      transcriptDays: event.target.valueAsNumber,
                    },
                  })
                }
              />
              {t.days}
            </div>
          )}
        </FormRow>
        <FormRow label={t.inquiries} error={errors['retention.inquiryDays']} hint={t.inquiriesHint}>
          {(id) => (
            <div className="form__row">
              <input
                id={id}
                type="number"
                className="input input--tiny"
                min={1}
                value={settings.retention.inquiryDays}
                onChange={(event) =>
                  set({
                    retention: { ...settings.retention, inquiryDays: event.target.valueAsNumber },
                  })
                }
              />
              {t.days}
            </div>
          )}
        </FormRow>
      </fieldset>
    </ViewFrame>
  );
}
