import {
  type AppointmentCategory,
  addDays,
  eachDate,
  germanHolidayOn,
  laterDate,
  type ManualSlotInput,
  ManualSlotInputSchema,
  type Slot,
  toZoned,
  WEEKDAYS,
  weekdayOf,
} from '@callisto/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, LockOpen, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import { type CSSProperties, useState } from 'react';
import { data, errorMessage, useApi } from '../../app/api';
import { queryKeys, useConfig, useConflicts, useHasPermission } from '../../app/queries';
import { formatLongDate, formatShortDay } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { type Command, newCommand, refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { contextMenuEntries, type MenuEntry } from '../../ui/Menu';
import { ConfirmDialog } from '../../ui/Modal';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';

const t = localized({
  de: {
    statuses: { free: 'Frei', booked: 'Gebucht', blocked: 'Gesperrt' },
    notChanged: 'Der Slot wurde nicht geändert',
    reconciled: 'Die Slots wurden neu erzeugt',
    reconcileText: (created: number, updated: number, removed: number) =>
      `${created} angelegt, ${updated} angepasst, ${removed} entfernt.`,
    notReconciled: 'Die Slots wurden nicht neu erzeugt',
    title: 'Kalender',
    unblock: 'Freigeben',
    block: 'Sperren',
    delete: 'Löschen …',
    single: 'Einzelner Slot …',
    reconcile: 'Slots neu erzeugen',
    status: (total: number, booked: number, blocked: number) =>
      `${total} Slots · ${booked} gebucht · ${blocked} gesperrt`,
    // The short day ends with a dot ("So., 22.11."), so the year follows directly.
    period: (from: string, to: string, year: string, week: number) =>
      `${from} – ${to}${year} · KW ${week}`,
    previousWeek: 'Vorherige Woche',
    today: 'Heute',
    nextWeek: 'Nächste Woche',
    details: 'Details',
    category: 'Kategorie',
    deletedCategory: 'Gelöschte Kategorie',
    date: 'Datum',
    time: 'Zeit',
    timeRange: (from: string, to: string) => `${from} – ${to} Uhr`,
    state: 'Status',
    origin: 'Herkunft',
    fromTemplate: (name: string) => `Vorlage „${name}“`,
    deleted: 'gelöscht',
    manual: 'Einzeln angelegt',
    hint: 'Hinweis',
    conflict:
      'Der Termin liegt in einer Schließzeit oder an einem Feiertag. Bitte nehmen Sie Kontakt mit dem Patienten auf.',
    nothingSelected: 'Kein Slot ausgewählt',
    noSlots: 'Keine Slots',
    deleteTitle: 'Slot löschen',
    deleteText: (date: string, time: string) =>
      `Soll der einzeln angelegte Slot am ${date} um ${time} Uhr gelöscht werden?`,
    confirmDelete: 'Löschen',
    free: (count: number) => `${count} frei`,
    createTitle: 'Einzelnen Slot anlegen',
    start: 'Beginn',
    oClock: 'Uhr',
  },
  en: {
    statuses: { free: 'Free', booked: 'Booked', blocked: 'Blocked' },
    notChanged: 'The slot was not changed',
    reconciled: 'The slots were generated again',
    reconcileText: (created: number, updated: number, removed: number) =>
      `${created} created, ${updated} updated, ${removed} removed.`,
    notReconciled: 'The slots were not generated again',
    title: 'Calendar',
    unblock: 'Unblock',
    block: 'Block',
    delete: 'Delete …',
    single: 'Single slot …',
    reconcile: 'Generate slots again',
    status: (total: number, booked: number, blocked: number) =>
      `${total} slots · ${booked} booked · ${blocked} blocked`,
    period: (from: string, to: string, year: string, week: number) =>
      `${from} – ${to}/${year} · Week ${week}`,
    previousWeek: 'Previous week',
    today: 'Today',
    nextWeek: 'Next week',
    details: 'Details',
    category: 'Category',
    deletedCategory: 'Deleted category',
    date: 'Date',
    time: 'Time',
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    state: 'Status',
    origin: 'Origin',
    fromTemplate: (name: string) => `Template “${name}”`,
    deleted: 'deleted',
    manual: 'Created individually',
    hint: 'Note',
    conflict:
      'The appointment falls into a closure or onto a public holiday. Please get in touch with the patient.',
    nothingSelected: 'No slot selected',
    noSlots: 'No slots',
    deleteTitle: 'Delete slot',
    deleteText: (date: string, time: string) =>
      `Delete the individually created slot on ${date} at ${time}?`,
    confirmDelete: 'Delete',
    free: (count: number) => `${count} free`,
    createTitle: 'Create a single slot',
    start: 'Start',
    oClock: '',
  },
});

const STATUS_LABELS: Record<Slot['status'], string> = t.statuses;

/** The Monday of the week a date falls into. */
const mondayOf = (date: string) => addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));

/** ISO 8601 week number: the week with the year's first Thursday is week 1. */
function isoWeek(date: string): number {
  const thursday = new Date(`${addDays(mondayOf(date), 3)}T00:00:00Z`);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000)) + 1;
}

/** The slots of one week: what can be booked when, what is booked and what is blocked. */
export function CalendarView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const config = useConfig();
  const canManage = useHasPermission('schedule.manage');
  const conflictIds = new Set((useConflicts().data ?? []).map((slot) => slot.id));

  const timeZone = config.data?.settings.timeZone ?? 'Europe/Berlin';
  const today = toZoned(new Date(), timeZone).date;
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selectedId, setSelectedId] = useState<string>();
  const [menuSlotId, setMenuSlotId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Slot>();
  const weekEnd = addDays(weekStart, 6);

  const slots = useQuery({
    queryKey: queryKeys.slots(weekStart, weekEnd),
    queryFn: () => data(api.admin.slots.$get({ query: { from: weekStart, to: weekEnd } })),
  });
  const refreshSlots = () => queryClient.invalidateQueries({ queryKey: queryKeys.allSlots });
  const failed = (title: string) => (error: unknown) =>
    notify({ kind: 'error', title, text: errorMessage(error) });

  const setStatus = useMutation({
    mutationFn: (change: { slot: Slot; status: 'free' | 'blocked' }) =>
      api.admin.slots[':id'].$patch({
        param: { id: change.slot.id },
        json: { status: change.status },
      }),
    onSuccess: refreshSlots,
    onError: failed(t.notChanged),
  });
  const remove = useMutation({
    mutationFn: (slot: Slot) => api.admin.slots[':id'].$delete({ param: { id: slot.id } }),
    onSuccess: async () => {
      await refreshSlots();
      setDeleting(undefined);
    },
  });
  const reconcile = useMutation({
    mutationFn: () => data(api.admin.slots.reconcile.$post()),
    onSuccess: async (changes) => {
      await refreshSlots();
      notify({
        kind: 'success',
        title: t.reconciled,
        text: t.reconcileText(changes.created, changes.updated, changes.removed),
      });
    },
    onError: failed(t.notReconciled),
  });

  if (!config.data || !slots.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={config.data ? slots : config} />
      </ViewFrame>
    );
  }

  const { categories, closures, templates, settings } = config.data;
  const categoryOf = (slot: Slot) => categories.find((category) => category.id === slot.categoryId);
  const selected = slots.data.find((slot) => slot.id === selectedId);
  const days = eachDate(weekStart, weekEnd);

  const actionsFor = (slot: Slot | undefined): Command[] => [
    {
      id: 'block',
      label: slot?.status === 'blocked' ? t.unblock : t.block,
      icon: slot?.status === 'blocked' ? LockOpen : Lock,
      disabled: !slot || slot.status === 'booked' || !canManage,
      run: () =>
        slot && setStatus.mutate({ slot, status: slot.status === 'blocked' ? 'free' : 'blocked' }),
    },
    {
      id: 'delete',
      label: t.delete,
      icon: Trash2,
      danger: true,
      // Slots of a template would simply be generated again; they are blocked instead.
      disabled: !slot || slot.status === 'booked' || Boolean(slot.templateId) || !canManage,
      run: () => slot && setDeleting(slot),
    },
  ];

  const commands: Command[] = [
    newCommand(t.single, () => setCreating(true), !canManage || categories.length === 0),
    ...actionsFor(selected),
    {
      id: 'reconcile',
      label: t.reconcile,
      icon: Sparkles,
      toolbar: false,
      disabled: !canManage || reconcile.isPending,
      run: () => reconcile.mutate(),
    },
    refreshCommand(() => void slots.refetch()),
  ];

  const menuSlot = slots.data.find((slot) => slot.id === menuSlotId);
  const menu: MenuEntry[] = menuSlot
    ? actionsFor(menuSlot).map((command) => ({
        label: command.label,
        disabled: command.disabled ?? false,
        danger: command.danger ?? false,
        onSelect: command.run,
        ...(command.icon ? { icon: command.icon } : {}),
      }))
    : [
        {
          label: t.single,
          icon: Plus,
          disabled: !canManage,
          onSelect: () => setCreating(true),
        },
      ];

  const slotIdAt = (target: EventTarget) =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-slot-id]')?.dataset.slotId
      : undefined;

  const booked = slots.data.filter((slot) => slot.status === 'booked').length;
  const blocked = slots.data.filter((slot) => slot.status === 'blocked').length;

  return (
    <ViewFrame
      title={t.title}
      commands={commands}
      status={t.status(slots.data.length, booked, blocked)}
      toolbarEnd={
        <div className="toolbar__nav">
          <span className="toolbar__period">
            {t.period(
              formatShortDay(weekStart),
              formatShortDay(weekEnd),
              weekEnd.slice(0, 4),
              isoWeek(weekStart),
            )}
          </span>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={t.previousWeek}
            title={t.previousWeek}
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft />
          </button>
          <button type="button" className="btn" onClick={() => setWeekStart(mondayOf(today))}>
            {t.today}
          </button>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={t.nextWeek}
            title={t.nextWeek}
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight />
          </button>
        </div>
      }
      inspector={{
        title: t.details,
        content: selected ? (
          <dl className="props">
            <dt>{t.category}</dt>
            <dd>{categoryOf(selected)?.name ?? t.deletedCategory}</dd>
            <dt>{t.date}</dt>
            <dd>{formatLongDate(selected.date)}</dd>
            <dt>{t.time}</dt>
            <dd>{t.timeRange(selected.startTime, selected.endTime)}</dd>
            <dt>{t.state}</dt>
            <dd>{STATUS_LABELS[selected.status]}</dd>
            <dt>{t.origin}</dt>
            <dd>
              {selected.templateId
                ? t.fromTemplate(
                    templates.find((template) => template.id === selected.templateId)?.name ??
                      t.deleted,
                  )
                : t.manual}
            </dd>
            {conflictIds.has(selected.id) && (
              <>
                <dt>{t.hint}</dt>
                <dd>{t.conflict}</dd>
              </>
            )}
          </dl>
        ) : (
          <div className="inspector__empty">{t.nothingSelected}</div>
        ),
      }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: clicks are delegated from the slot buttons inside */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the slots themselves are buttons and handle the keyboard */}
          <div
            className="week"
            onClick={(event) => setSelectedId(slotIdAt(event.target))}
            onContextMenu={(event) => {
              const id = slotIdAt(event.target);
              setMenuSlotId(id);
              if (id) {
                setSelectedId(id);
              }
            }}
          >
            {days.map((date) => {
              const holiday = germanHolidayOn(date, settings.federalState);
              const closure = closures.find(
                (candidate) => candidate.from <= date && date <= candidate.to,
              );
              const daySlots = slots.data.filter((slot) => slot.date === date);
              return (
                <section
                  key={date}
                  className="week__day"
                  data-today={date === today}
                  data-past={date < today}
                  aria-label={formatLongDate(date)}
                >
                  <header className="week__header">
                    <span className="week__date">{formatShortDay(date)}</span>
                    {holiday && <span className="pill pill--warning">{holiday.name}</span>}
                    {!holiday && closure && (
                      <span className="pill pill--warning" title={closure.title}>
                        {closure.allDay ? closure.title : `${closure.fromTime}–${closure.toTime}`}
                      </span>
                    )}
                  </header>
                  <div className="week__slots">
                    {chipsOf(daySlots).map(({ slot, free }) => (
                      <SlotChip
                        key={slot.id}
                        slot={slot}
                        free={free}
                        category={categoryOf(slot)}
                        selected={slot.id === selectedId}
                        conflict={conflictIds.has(slot.id)}
                      />
                    ))}
                    {daySlots.length === 0 && <span className="week__empty">{t.noSlots}</span>}
                  </div>
                </section>
              );
            })}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="menu">{contextMenuEntries(menu)}</ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {creating && (
        <ManualSlotDialog
          categories={categories.filter((category) => category.active)}
          date={laterDate(weekStart, today)}
          onClose={() => setCreating(false)}
          onSaved={async (slot) => {
            await refreshSlots();
            setCreating(false);
            setWeekStart(mondayOf(slot.date));
            setSelectedId(slot.id);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t.deleteTitle}
          text={t.deleteText(formatLongDate(deleting.date), deleting.startTime)}
          confirmLabel={t.confirmDelete}
          danger
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : undefined}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => {
            remove.reset();
            setDeleting(undefined);
          }}
        />
      )}
    </ViewFrame>
  );
}

/**
 * What a day shows: one chip per slot, except that free slots of the same category at the same
 * time (a template with several parallel places) share a chip that says how many are free.
 */
function chipsOf(daySlots: Slot[]): Array<{ slot: Slot; free: number }> {
  const chips: Array<{ slot: Slot; free: number }> = [];
  const freeChips = new Map<string, { slot: Slot; free: number }>();
  for (const slot of daySlots) {
    if (slot.status !== 'free') {
      chips.push({ slot, free: 0 });
      continue;
    }
    const key = `${slot.startTime}/${slot.categoryId}`;
    const existing = freeChips.get(key);
    if (existing) {
      existing.free += 1;
    } else {
      const chip = { slot, free: 1 };
      freeChips.set(key, chip);
      chips.push(chip);
    }
  }
  return chips;
}

function SlotChip(props: {
  slot: Slot;
  /** How many free slots the chip stands for; 0 for a booked or blocked slot. */
  free: number;
  category: AppointmentCategory | undefined;
  selected: boolean;
  conflict: boolean;
}) {
  const { slot, category } = props;
  return (
    <button
      type="button"
      className="slot"
      data-slot-id={slot.id}
      data-status={slot.status}
      data-conflict={props.conflict}
      aria-pressed={props.selected}
      style={{ '--slot-color': category?.color ?? 'var(--text-faint)' } as CSSProperties}
      title={`${t.timeRange(slot.startTime, slot.endTime)} · ${category?.name ?? ''} · ${STATUS_LABELS[slot.status]}`}
    >
      <span className="slot__time">{slot.startTime}</span>
      <span className="slot__name">{category?.name ?? '–'}</span>
      {slot.status !== 'free' && <span className="slot__status">{STATUS_LABELS[slot.status]}</span>}
      {props.free > 1 && <span className="slot__count">{t.free(props.free)}</span>}
    </button>
  );
}

function ManualSlotDialog(props: {
  categories: AppointmentCategory[];
  date: string;
  onClose: () => void;
  onSaved: (slot: Slot) => void;
}) {
  const api = useApi();
  const form = useFormDialog({
    initial: {
      categoryId: props.categories[0]?.id ?? '',
      date: props.date,
      startTime: '08:00',
    } as ManualSlotInput,
    schema: ManualSlotInputSchema,
    save: (input) => data(api.admin.slots.$post({ json: input })),
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  return (
    <FormDialog title={t.createTitle} size="narrow" form={form} onClose={props.onClose}>
      <FormRow label={t.category} error={errors.categoryId}>
        {(id) => (
          <select
            id={id}
            className="select"
            value={draft.categoryId}
            onChange={(event) => set({ categoryId: event.target.value })}
            // biome-ignore lint/a11y/noAutofocus: the first field of a dialog takes the focus, as in any desktop dialog
            autoFocus
          >
            {props.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.durationMinutes} min)
              </option>
            ))}
          </select>
        )}
      </FormRow>
      <FormRow label={t.date} error={errors.date}>
        {(id) => (
          <input
            id={id}
            type="date"
            className="input input--narrow"
            value={draft.date}
            onChange={(event) => set({ date: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow label={t.start} error={errors.startTime}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="time"
              className="input input--tiny"
              value={draft.startTime}
              onChange={(event) => set({ startTime: event.target.value })}
            />
            {t.oClock}
          </div>
        )}
      </FormRow>
    </FormDialog>
  );
}
