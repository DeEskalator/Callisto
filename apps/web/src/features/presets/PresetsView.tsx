import {
  type AnnouncementPreset,
  type AnnouncementPresetInput,
  AnnouncementPresetInputSchema,
  OPENING_MODES,
  type OpeningMode,
  type PracticeSettings,
  type PresetCapabilities,
} from '@callisto/domain';
import { useMutation } from '@tanstack/react-query';
import { data, errorMessage, useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';

const MODE_LABELS: Record<OpeningMode, string> = {
  open: 'Während der Sprechzeit',
  closed: 'Außerhalb der Sprechzeit',
  holiday: 'An Feiertagen',
  vacation: 'Bei Urlaub und Schließzeiten',
};

const CAPABILITY_LABELS: Record<keyof PresetCapabilities, string> = {
  appointments: 'Termine vergeben',
  prescriptions: 'Rezeptwünsche aufnehmen',
  callbacks: 'Rückrufe notieren',
  transfer: 'Zur Praxis verbinden',
};
const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as Array<keyof PresetCapabilities>;

const capabilitiesText = (preset: AnnouncementPreset) =>
  CAPABILITIES.filter((capability) => preset.capabilities[capability])
    .map((capability) => CAPABILITY_LABELS[capability])
    .join(', ') || 'Nur Auskunft';

/**
 * Announcement presets: what the assistant tells callers in a given situation and what it may do
 * for them, plus which preset applies when.
 */
export function PresetsView() {
  const api = useApi();
  const config = useConfig();
  const canManage = useHasPermission('settings.manage');
  const invalidate = useInvalidatePlanning();
  const notify = useNotify();

  const assign = useMutation({
    mutationFn: async (settings: PracticeSettings) => {
      await api.admin.settings.$put({ json: settings });
      await invalidate();
    },
    onSuccess: () => notify({ kind: 'success', title: 'Die Zuordnung wurde gespeichert' }),
    onError: (error) =>
      notify({
        kind: 'error',
        title: 'Die Zuordnung wurde nicht gespeichert',
        text: errorMessage(error),
      }),
  });

  if (!config.data) {
    return (
      <ViewFrame title="Ansagen">
        <QueryState query={config} />
      </ViewFrame>
    );
  }
  const { presets, settings, closures } = config.data;
  const usageOf = (preset: AnnouncementPreset) => [
    ...OPENING_MODES.filter((mode) => settings.presetAssignments[mode] === preset.id).map(
      (mode) => MODE_LABELS[mode],
    ),
    ...closures
      .filter((closure) => closure.presetId === preset.id)
      .map((closure) => `Schließzeit „${closure.title}“`),
  ];

  const columns: GridColumn<AnnouncementPreset>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 220,
      render: (preset) => preset.name,
      sortValue: (preset) => preset.name,
    },
    {
      id: 'announcement',
      header: 'Ansagetext',
      width: 380,
      muted: true,
      render: (preset) => preset.announcement || 'Keine zusätzliche Ansage',
    },
    { id: 'capabilities', header: 'Der Assistent darf', width: 300, render: capabilitiesText },
    {
      id: 'usage',
      header: 'Gilt',
      width: 260,
      muted: true,
      render: (preset) => usageOf(preset).join(', ') || 'Nicht verwendet',
    },
  ];

  return (
    <CollectionView
      title="Ansagen"
      noun={['Ansage', 'Ansagen']}
      items={presets}
      itemId={(preset) => preset.id}
      itemName={(preset) => preset.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel="Neue Ansage …"
      onRefresh={() => void config.refetch()}
      empty={{ title: 'Keine Ansagen vorhanden' }}
      header={
        <fieldset className="assignments" disabled={!canManage || assign.isPending}>
          <legend className="assignments__title">Welche Ansage gilt wann?</legend>
          <div className="assignments__grid">
            {OPENING_MODES.map((mode) => (
              <label key={mode} className="assignments__item">
                <span>{MODE_LABELS[mode]}</span>
                <select
                  className="select"
                  value={settings.presetAssignments[mode]}
                  onChange={(event) =>
                    assign.mutate({
                      ...settings,
                      presetAssignments: {
                        ...settings.presetAssignments,
                        [mode]: event.target.value,
                      },
                    })
                  }
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      }
      details={(preset) => (
        <dl className="props">
          <dt>Name</dt>
          <dd>{preset.name}</dd>
          <dt>Ansagetext</dt>
          <dd>{preset.announcement || 'Keine zusätzliche Ansage'}</dd>
          <dt>Erlaubt</dt>
          <dd>{capabilitiesText(preset)}</dd>
          <dt>Gilt</dt>
          <dd>{usageOf(preset).join(', ') || 'Nicht verwendet'}</dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <PresetDialog preset={item} onClose={close} onSaved={saved} />
      )}
      deleteText={(preset) => <>Soll die Ansage „{preset.name}“ gelöscht werden?</>}
      onDelete={async (preset) => {
        await api.admin.presets[':id'].$delete({ param: { id: preset.id } });
        await invalidate();
      }}
    />
  );
}

function PresetDialog(props: {
  preset: AnnouncementPreset | undefined;
  onClose: () => void;
  onSaved: (preset: AnnouncementPreset) => void;
}) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const { preset } = props;

  const form = useFormDialog({
    initial: (preset ?? {
      name: '',
      announcement: '',
      capabilities: { appointments: true, prescriptions: true, callbacks: true, transfer: false },
    }) as AnnouncementPresetInput,
    schema: AnnouncementPresetInputSchema,
    save: async (input) => {
      const saved = await (preset
        ? data(api.admin.presets[':id'].$put({ param: { id: preset.id }, json: input }))
        : data(api.admin.presets.$post({ json: input })));
      await invalidate();
      return saved;
    },
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  return (
    <FormDialog
      title={preset ? 'Ansage bearbeiten' : 'Neue Ansage'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow label="Name" error={errors.name} hint="Zum Beispiel „Urlaub mit Vertretung“.">
        {(id) => (
          <input
            id={id}
            className="input"
            value={draft.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => set({ name: event.target.value })}
            // biome-ignore lint/a11y/noAutofocus: the first field of a dialog takes the focus, as in any desktop dialog
            autoFocus
          />
        )}
      </FormRow>
      <FormRow
        label="Ansagetext"
        error={errors.announcement}
        hint="Wird nach der Begrüßung wörtlich angesagt. Nennen Sie hier zum Beispiel die Vertretung oder die 116 117."
      >
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            rows={5}
            value={draft.announcement}
            onChange={(event) => set({ announcement: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow label="Der Assistent darf">
        {() => (
          <>
            {CAPABILITIES.map((capability) => (
              <Checkbox
                key={capability}
                label={CAPABILITY_LABELS[capability]}
                checked={draft.capabilities[capability]}
                onChange={(checked) =>
                  set({ capabilities: { ...draft.capabilities, [capability]: checked } })
                }
              />
            ))}
          </>
        )}
      </FormRow>
    </FormDialog>
  );
}
