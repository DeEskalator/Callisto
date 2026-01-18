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
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';

type Phase = 'past' | 'current' | 'upcoming';

const phaseOf = (closure: Closure, today: string): Phase =>
  closure.to < today ? 'past' : closure.from > today ? 'upcoming' : 'current';

const PHASE_PILL: Record<Phase, { label: string; className: string }> = {
  current: { label: 'Aktuell', className: 'pill pill--warning' },
  upcoming: { label: 'Bevorstehend', className: 'pill pill--accent' },
  past: { label: 'Vergangen', className: 'pill' },
};

const extentOf = (closure: Closure) =>
  closure.allDay ? 'Ganztägig' : `${closure.fromTime} – ${closure.toTime} Uhr`;

/** Vacations and other times the practice is closed outside of its regular hours. */
export function ClosuresView() {
  const api = useApi();
  const config = useConfig();
  const canManage = useHasPermission('settings.manage');
  const invalidate = useInvalidatePlanning();

  if (!config.data) {
    return (
      <ViewFrame title="Urlaub & Schließzeiten">
        <QueryState query={config} />
      </ViewFrame>
    );
  }

  const { closures, presets, settings } = config.data;
  const today = toZoned(new Date(), settings.timeZone).date;
  const presetName = (closure: Closure) =>
    presets.find((preset) => preset.id === closure.presetId)?.name ?? 'Standard für Urlaub';

  const columns: GridColumn<Closure>[] = [
    {
      id: 'title',
      header: 'Bezeichnung',
      width: 240,
      render: (closure) => closure.title,
      sortValue: (closure) => closure.title,
    },
    {
      id: 'period',
      header: 'Zeitraum',
      width: 190,
      render: (closure) => formatDateRange(closure.from, closure.to),
      sortValue: (closure) => closure.from,
    },
    { id: 'extent', header: 'Umfang', width: 150, render: extentOf, muted: true },
    { id: 'preset', header: 'Ansage', width: 200, render: presetName, muted: true },
    {
      id: 'phase',
      header: 'Status',
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
      title="Urlaub & Schließzeiten"
      noun={['Schließzeit', 'Schließzeiten']}
      items={closures}
      itemId={(closure) => closure.id}
      itemName={(closure) => closure.title}
      columns={columns}
      initialSort={{ columnId: 'period', descending: false }}
      canManage={canManage}
      newLabel="Neue Schließzeit …"
      onRefresh={() => void config.refetch()}
      empty={{
        title: 'Keine Schließzeiten eingetragen',
        hint: 'Urlaub, Fortbildungen und Brückentage werden hier eingetragen, damit der Assistent Bescheid weiß.',
      }}
      details={(closure) => (
        <dl className="props">
          <dt>Bezeichnung</dt>
          <dd>{closure.title}</dd>
          <dt>Von</dt>
          <dd>{formatLongDate(closure.from)}</dd>
          <dt>Bis</dt>
          <dd>{formatLongDate(closure.to)}</dd>
          <dt>Umfang</dt>
          <dd>{extentOf(closure)}</dd>
          <dt>Ansage</dt>
          <dd>{presetName(closure)}</dd>
          {closure.note && (
            <>
              <dt>Notiz</dt>
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
      deleteText={(closure) => (
        <>
          Soll „{closure.title}“ ({formatDateRange(closure.from, closure.to)}) gelöscht werden? Die
          Terminslots dieses Zeitraums werden wieder freigegeben.
        </>
      )}
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
    <FormDialog
      title={closure ? 'Schließzeit bearbeiten' : 'Neue Schließzeit'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow
        label="Bezeichnung"
        error={errors.title}
        hint="Zum Beispiel „Sommerurlaub“ oder „Fortbildung“."
      >
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
      <FormRow label="Zeitraum" error={errors.from ?? errors.to}>
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
            bis
            <input
              type="date"
              className="input input--narrow"
              aria-label="Letzter Tag"
              value={draft.to}
              min={draft.from}
              onChange={(event) => set({ to: event.target.value })}
            />
          </div>
        )}
      </FormRow>
      <FormRow label="Umfang" error={errors.fromTime ?? errors.toTime}>
        {() => (
          <>
            <Checkbox
              label="Ganztägig geschlossen"
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
                  aria-label="Geschlossen ab"
                  value={draft.fromTime ?? ''}
                  onChange={(event) => set({ fromTime: event.target.value })}
                />
                bis
                <input
                  type="time"
                  className="input input--tiny"
                  aria-label="Geschlossen bis"
                  value={draft.toTime ?? ''}
                  onChange={(event) => set({ toTime: event.target.value })}
                />
                Uhr
              </div>
            )}
          </>
        )}
      </FormRow>
      <FormRow
        label="Ansage"
        hint="Was der Assistent Anrufern in dieser Zeit sagt und was er für sie tun darf."
      >
        {(id) => (
          <select
            id={id}
            className="select"
            value={draft.presetId ?? ''}
            onChange={(event) => set({ presetId: event.target.value || undefined })}
          >
            <option value="">Standard für Urlaub</option>
            {props.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        )}
      </FormRow>
      <FormRow label="Notiz" error={errors.note} hint="Nur für das Praxisteam sichtbar.">
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
