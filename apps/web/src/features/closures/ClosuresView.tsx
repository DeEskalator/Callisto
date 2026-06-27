import {
  type AnnouncementPreset,
  type Closure,
  type ClosureInput,
  ClosureInputSchema,
  laterDate,
  toZoned,
} from '@callisto/domain';
import { data, useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { formatDateRange, formatLongDate } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';

const t = localized({
  de: {
    current: 'Aktuell',
    upcoming: 'Bevorstehend',
    past: 'Vergangen',
    allDay: 'Ganztägig',
    timeRange: (from: string, to: string) => `${from} – ${to} Uhr`,
    title: 'Urlaub & Schließzeiten',
    defaultPreset: 'Standard für Urlaub',
    name: 'Bezeichnung',
    period: 'Zeitraum',
    extent: 'Umfang',
    preset: 'Ansage',
    status: 'Status',
    noun: ['Schließzeit', 'Schließzeiten'] as [string, string],
    newClosure: 'Neue Schließzeit …',
    empty: 'Keine Schließzeiten eingetragen',
    emptyHint:
      'Urlaub, Fortbildungen und Brückentage werden hier eingetragen, damit der Assistent Bescheid weiß.',
    from: 'Von',
    to: 'Bis',
    note: 'Notiz',
    deleteText: (title: string, period: string) =>
      `Soll „${title}“ (${period}) gelöscht werden? Die Terminslots dieses Zeitraums werden wieder freigegeben.`,
    editTitle: 'Schließzeit bearbeiten',
    newTitle: 'Neue Schließzeit',
    nameHint: 'Zum Beispiel „Sommerurlaub“ oder „Fortbildung“.',
    until: 'bis',
    lastDay: 'Letzter Tag',
    closedAllDay: 'Ganztägig geschlossen',
    closedFrom: 'Geschlossen ab',
    closedUntil: 'Geschlossen bis',
    oClock: 'Uhr',
    presetHint: 'Was der Assistent Anrufern in dieser Zeit sagt und was er für sie tun darf.',
    noteHint: 'Nur für das Praxisteam sichtbar.',
  },
  en: {
    current: 'Current',
    upcoming: 'Upcoming',
    past: 'Past',
    allDay: 'All day',
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    title: 'Vacation & closures',
    defaultPreset: 'Default for vacation',
    name: 'Name',
    period: 'Period',
    extent: 'Extent',
    preset: 'Announcement',
    status: 'Status',
    noun: ['Closure', 'closures'] as [string, string],
    newClosure: 'New closure …',
    empty: 'No closures entered',
    emptyHint:
      'Vacations, training days and bridge days are entered here so that the assistant knows about them.',
    from: 'From',
    to: 'To',
    note: 'Note',
    deleteText: (title: string, period: string) =>
      `Delete “${title}” (${period})? The appointment slots of this period are released again.`,
    editTitle: 'Edit closure',
    newTitle: 'New closure',
    nameHint: 'For example “Summer vacation” or “Training”.',
    until: 'to',
    lastDay: 'Last day',
    closedAllDay: 'Closed all day',
    closedFrom: 'Closed from',
    closedUntil: 'Closed until',
    oClock: '',
    presetHint: 'What the assistant tells callers during this time and what it may do for them.',
    noteHint: 'Only visible to the practice team.',
  },
});

type Phase = 'past' | 'current' | 'upcoming';

const phaseOf = (closure: Closure, today: string): Phase =>
  closure.to < today ? 'past' : closure.from > today ? 'upcoming' : 'current';

const PHASE_PILL: Record<Phase, { label: string; className: string }> = {
  current: { label: t.current, className: 'pill pill--warning' },
  upcoming: { label: t.upcoming, className: 'pill pill--accent' },
  past: { label: t.past, className: 'pill' },
};

const extentOf = (closure: Closure) =>
  closure.allDay ? t.allDay : t.timeRange(closure.fromTime ?? '', closure.toTime ?? '');

/** Vacations and other times the practice is closed outside of its regular hours. */
export function ClosuresView() {
  const api = useApi();
  const config = useConfig();
  const canManage = useHasPermission('settings.manage');
  const invalidate = useInvalidatePlanning();

  if (!config.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={config} />
      </ViewFrame>
    );
  }

  const { closures, presets, settings } = config.data;
  const today = toZoned(new Date(), settings.timeZone).date;
  const presetName = (closure: Closure) =>
    presets.find((preset) => preset.id === closure.presetId)?.name ?? t.defaultPreset;

  const columns: GridColumn<Closure>[] = [
    {
      id: 'title',
      header: t.name,
      width: 240,
      render: (closure) => closure.title,
      sortValue: (closure) => closure.title,
    },
    {
      id: 'period',
      header: t.period,
      width: 190,
      render: (closure) => formatDateRange(closure.from, closure.to),
      sortValue: (closure) => closure.from,
    },
    { id: 'extent', header: t.extent, width: 150, render: extentOf, muted: true },
    { id: 'preset', header: t.preset, width: 200, render: presetName, muted: true },
    {
      id: 'phase',
      header: t.status,
      width: 130,
      render: (closure) => {
        const pill = PHASE_PILL[phaseOf(closure, today)];
        return <span className={pill.className}>{pill.label}</span>;
      },
      sortValue: (closure) => phaseOf(closure, today),
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={closures}
      itemId={(closure) => closure.id}
      itemName={(closure) => closure.title}
      columns={columns}
      initialSort={{ columnId: 'period', descending: false }}
      canManage={canManage}
      newLabel={t.newClosure}
      onRefresh={() => void config.refetch()}
      empty={{
        title: t.empty,
        hint: t.emptyHint,
      }}
      details={(closure) => (
        <dl className="props">
          <dt>{t.name}</dt>
          <dd>{closure.title}</dd>
          <dt>{t.from}</dt>
          <dd>{formatLongDate(closure.from)}</dd>
          <dt>{t.to}</dt>
          <dd>{formatLongDate(closure.to)}</dd>
          <dt>{t.extent}</dt>
          <dd>{extentOf(closure)}</dd>
          <dt>{t.preset}</dt>
          <dd>{presetName(closure)}</dd>
          {closure.note && (
            <>
              <dt>{t.note}</dt>
              <dd>{closure.note}</dd>
            </>
          )}
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <ClosureDialog
          closure={item}
          presets={presets}
          today={today}
          onClose={close}
          onSaved={saved}
        />
      )}
      deleteText={(closure) =>
        t.deleteText(closure.title, formatDateRange(closure.from, closure.to))
      }
      onDelete={async (closure) => {
        await api.admin.closures[':id'].$delete({ param: { id: closure.id } });
        await invalidate();
      }}
    />
  );
}

function ClosureDialog(props: {
  closure: Closure | undefined;
  presets: AnnouncementPreset[];
  today: string;
  onClose: () => void;
  onSaved: (closure: Closure) => void;
}) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const { closure } = props;

  const form = useFormDialog({
    initial: (closure ?? {
      title: '',
      from: props.today,
      to: props.today,
      allDay: true,
    }) as ClosureInput,
    schema: ClosureInputSchema,
    save: async (input) => {
      const saved = await (closure
        ? data(api.admin.closures[':id'].$put({ param: { id: closure.id }, json: input }))
        : data(api.admin.closures.$post({ json: input })));
      await invalidate();
      return saved;
    },
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  return (
    <FormDialog title={closure ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
      <FormRow label={t.name} error={errors.title} hint={t.nameHint}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={draft.title}
            aria-invalid={Boolean(errors.title)}
            onChange={(event) => set({ title: event.target.value })}
            // biome-ignore lint/a11y/noAutofocus: the first field of a dialog takes the focus, as in any desktop dialog
            autoFocus
          />
        )}
      </FormRow>
      <FormRow label={t.period} error={errors.from ?? errors.to}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="date"
              className="input input--narrow"
              value={draft.from}
              onChange={(event) =>
                set({
                  from: event.target.value,
                  // Moving the start past the end drags the end along.
                  to: laterDate(draft.to, event.target.value),
                })
              }
            />
            {t.until}
            <input
              type="date"
              className="input input--narrow"
              aria-label={t.lastDay}
              value={draft.to}
              min={draft.from}
              onChange={(event) => set({ to: event.target.value })}
            />
          </div>
        )}
      </FormRow>
      <FormRow label={t.extent} error={errors.fromTime ?? errors.toTime}>
        {() => (
          <>
            <Checkbox
              label={t.closedAllDay}
              checked={draft.allDay}
              onChange={(allDay) =>
                set(
                  allDay
                    ? { allDay, fromTime: undefined, toTime: undefined }
                    : { allDay, fromTime: '12:00', toTime: '18:00' },
                )
              }
            />
            {!draft.allDay && (
              <div className="form__row">
                <input
                  type="time"
                  className="input input--tiny"
                  aria-label={t.closedFrom}
                  value={draft.fromTime ?? ''}
                  onChange={(event) => set({ fromTime: event.target.value })}
                />
                {t.until}
                <input
                  type="time"
                  className="input input--tiny"
                  aria-label={t.closedUntil}
                  value={draft.toTime ?? ''}
                  onChange={(event) => set({ toTime: event.target.value })}
                />
                {t.oClock}
              </div>
            )}
          </>
        )}
      </FormRow>
      <FormRow label={t.preset} hint={t.presetHint}>
        {(id) => (
          <select
            id={id}
            className="select"
            value={draft.presetId ?? ''}
            onChange={(event) => set({ presetId: event.target.value || undefined })}
          >
            <option value="">{t.defaultPreset}</option>
            {props.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        )}
      </FormRow>
      <FormRow label={t.note} error={errors.note} hint={t.noteHint}>
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            rows={2}
            value={draft.note ?? ''}
            onChange={(event) => set({ note: event.target.value || undefined })}
          />
        )}
      </FormRow>
    </FormDialog>
  );
}
