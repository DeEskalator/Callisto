import { FEDERAL_STATES, type PracticeSettings, PracticeSettingsSchema } from '@callisto/domain';
import { useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { discardCommand, saveCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { FormRow, FormSection } from '../../ui/Form';
import { QueryState } from '../../ui/QueryState';
import { useEditablePage } from '../../ui/useEditablePage';

const STATE_NAMES: Record<(typeof FEDERAL_STATES)[number], string> = {
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
};

/** Master data of the practice and the general behaviour of the assistant. */
export function PracticeSettingsView() {
  const config = useConfig();
  if (!config.data) {
    return (
      <ViewFrame title="Praxis">
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
    savedMessage: 'Die Praxiseinstellungen wurden gespeichert',
  });
  const { value: settings, errors, set } = page;

  return (
    <ViewFrame
      title="Praxis"
      padded
      status={page.dirty ? 'Ungespeicherte Änderungen' : undefined}
      commands={[
        saveCommand(page.save, !page.dirty || page.saving || !canManage),
        discardCommand(page.discard, !page.dirty),
      ]}
    >
      <fieldset className="form form--page" disabled={!canManage}>
        <FormSection>Praxis</FormSection>
        <FormRow label="Name der Praxis" error={errors.name}>
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
        <FormRow
          label="Bundesland"
          error={errors.federalState}
          hint="Bestimmt die gesetzlichen Feiertage, an denen die Praxis als geschlossen gilt."
        >
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

        <FormSection>Telefon</FormSection>
        <FormRow
          label="Begrüßung"
          error={errors.greeting}
          hint="Der erste Satz jedes Gesprächs. Er muss dem Anrufer sagen, dass ein KI-Assistent spricht."
        >
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
        <FormRow
          label="Weiterleitung an"
          error={errors.transferNumber}
          hint="Die Leitung der Praxis, an die der Assistent Anrufer verbindet, im Format +49… Sie darf nicht die Nummer sein, die auf den Assistenten umgeleitet wird."
        >
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

        <FormSection>Terminvergabe</FormSection>
        <FormRow
          label="Buchbar im Voraus"
          error={errors.bookingHorizonDays}
          hint="So weit in die Zukunft bietet der Assistent Termine an."
        >
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
              Tage
            </div>
          )}
        </FormRow>
        <FormRow
          label="Vorlaufzeit"
          error={errors.bookingLeadMinutes}
          hint="Termine, die früher beginnen, werden nicht mehr angeboten."
        >
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
              Minuten
            </div>
          )}
        </FormRow>

        <FormSection>Aufbewahrung</FormSection>
        <FormRow
          label="Transkripte"
          error={errors['retention.transcriptDays']}
          hint="Nach dieser Zeit werden die Gesprächsmitschriften automatisch gelöscht. Tonaufnahmen werden nie gespeichert."
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
              Tage
            </div>
          )}
        </FormRow>
        <FormRow
          label="Anliegen"
          error={errors['retention.inquiryDays']}
          hint="Terminbuchungen, Rezeptwünsche und Rückrufbitten werden nach dieser Zeit gelöscht."
        >
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
              Tage
            </div>
          )}
        </FormRow>
      </fieldset>
    </ViewFrame>
  );
}
