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
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';

const t = localized({
  de: {
    modes: {
      open: 'Während der Sprechzeit',
      closed: 'Außerhalb der Sprechzeit',
      holiday: 'An Feiertagen',
      vacation: 'Bei Urlaub und Schließzeiten',
    },
    capabilities: {
      appointments: 'Termine vergeben',
      prescriptions: 'Rezeptwünsche aufnehmen',
      callbacks: 'Rückrufe notieren',
      transfer: 'Zur Praxis verbinden',
    },
    infoOnly: 'Nur Auskunft',
    assignmentSaved: 'Die Zuordnung wurde gespeichert',
    assignmentFailed: 'Die Zuordnung wurde nicht gespeichert',
    title: 'Ansagen',
    closure: (title: string) => `Schließzeit „${title}“`,
    name: 'Name',
    announcement: 'Ansagetext',
    noAnnouncement: 'Keine zusätzliche Ansage',
    mayDo: 'Der Assistent darf',
    applies: 'Gilt',
    unused: 'Nicht verwendet',
    noun: ['Ansage', 'Ansagen'] as [string, string],
    newPreset: 'Neue Ansage …',
    empty: 'Keine Ansagen vorhanden',
    whichWhen: 'Welche Ansage gilt wann?',
    allowed: 'Erlaubt',
    deleteText: (name: string) => `Soll die Ansage „${name}“ gelöscht werden?`,
    editTitle: 'Ansage bearbeiten',
    newTitle: 'Neue Ansage',
    nameHint: 'Zum Beispiel „Urlaub mit Vertretung“.',
    announcementHint:
      'Wird nach der Begrüßung wörtlich angesagt. Nennen Sie hier zum Beispiel die Vertretung oder die 116 117.',
  },
  en: {
    modes: {
      open: 'During opening hours',
      closed: 'Outside opening hours',
      holiday: 'On public holidays',
      vacation: 'During vacations and closures',
    },
    capabilities: {
      appointments: 'Book appointments',
      prescriptions: 'Take prescription requests',
      callbacks: 'Note callbacks',
      transfer: 'Put through to the practice',
    },
    infoOnly: 'Information only',
    assignmentSaved: 'The assignment was saved',
    assignmentFailed: 'The assignment was not saved',
    title: 'Announcements',
    closure: (title: string) => `Closure “${title}”`,
    name: 'Name',
    announcement: 'Announcement',
    noAnnouncement: 'No additional announcement',
    mayDo: 'The assistant may',
    applies: 'Applies',
    unused: 'Not used',
    noun: ['Announcement', 'announcements'] as [string, string],
    newPreset: 'New announcement …',
    empty: 'No announcements',
    whichWhen: 'Which announcement applies when?',
    allowed: 'Allowed',
    deleteText: (name: string) => `Delete the announcement “${name}”?`,
    editTitle: 'Edit announcement',
    newTitle: 'New announcement',
    nameHint: 'For example “Vacation with substitute”.',
    announcementHint:
      'Read out word for word after the greeting. Mention the substitute practice or the 116 117 here, for example.',
  },
});

const MODE_LABELS: Record<OpeningMode, string> = t.modes;

const CAPABILITY_LABELS: Record<keyof PresetCapabilities, string> = t.capabilities;
const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as Array<keyof PresetCapabilities>;

const capabilitiesText = (preset: AnnouncementPreset) =>
  CAPABILITIES.filter((capability) => preset.capabilities[capability])
    .map((capability) => CAPABILITY_LABELS[capability])
    .join(', ') || t.infoOnly;

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
    onSuccess: () => notify({ kind: 'success', title: t.assignmentSaved }),
    onError: (error) =>
      notify({
        kind: 'error',
        title: t.assignmentFailed,
        text: errorMessage(error),
      }),
  });

  if (!config.data) {
    return (
      <ViewFrame title={t.title}>
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
      .map((closure) => t.closure(closure.title)),
  ];

  const columns: GridColumn<AnnouncementPreset>[] = [
    {
      id: 'name',
      header: t.name,
      width: 220,
      render: (preset) => preset.name,
      sortValue: (preset) => preset.name,
    },
    {
      id: 'announcement',
      header: t.announcement,
      width: 380,
      muted: true,
      render: (preset) => preset.announcement || t.noAnnouncement,
    },
    { id: 'capabilities', header: t.mayDo, width: 300, render: capabilitiesText },
    {
      id: 'usage',
      header: t.applies,
      width: 260,
      muted: true,
      render: (preset) => usageOf(preset).join(', ') || t.unused,
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={presets}
      itemId={(preset) => preset.id}
      itemName={(preset) => preset.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel={t.newPreset}
      onRefresh={() => void config.refetch()}
      empty={{ title: t.empty }}
      header={
        <fieldset className="assignments" disabled={!canManage || assign.isPending}>
          <legend className="assignments__title">{t.whichWhen}</legend>
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
          <dt>{t.name}</dt>
          <dd>{preset.name}</dd>
          <dt>{t.announcement}</dt>
          <dd>{preset.announcement || t.noAnnouncement}</dd>
          <dt>{t.allowed}</dt>
          <dd>{capabilitiesText(preset)}</dd>
          <dt>{t.applies}</dt>
          <dd>{usageOf(preset).join(', ') || t.unused}</dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <PresetDialog preset={item} onClose={close} onSaved={saved} />
      )}
      deleteText={(preset) => t.deleteText(preset.name)}
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
    <FormDialog title={preset ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
      <FormRow label={t.name} error={errors.name} hint={t.nameHint}>
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
      <FormRow label={t.announcement} error={errors.announcement} hint={t.announcementHint}>
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
      <FormRow label={t.mayDo}>
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
