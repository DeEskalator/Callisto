import {
  type AppointmentCategory,
  type SlotTemplate,
  type SlotTemplateInput,
  SlotTemplateInputSchema,
  toZoned,
  WEEKDAYS,
  type Weekday,
} from '@callisto/domain';
import { data, useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { formatDate, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { CategoryName } from '../categories/CategoriesView';

const t = localized({
  de: {
    from: (date: string) => `ab ${date}`,
    title: 'Slot-Vorlagen',
    name: 'Name',
    category: 'Kategorie',
    weekdays: 'Wochentage',
    window: 'Zeitfenster',
    interval: 'Takt',
    capacity: 'Parallel',
    validity: 'Gültig',
    status: 'Status',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    noun: ['Slot-Vorlage', 'Slot-Vorlagen'] as [string, string],
    newTemplate: 'Neue Vorlage …',
    empty: 'Noch keine Slot-Vorlagen',
    emptyHint:
      'Eine Vorlage legt fest, an welchen Wochentagen und zu welchen Zeiten Termine einer Kategorie buchbar sind.',
    noCategories: 'Legen Sie zuerst unter „Kategorien“ mindestens eine Terminkategorie an.',
    timeRange: (from: string, to: string) => `${from} – ${to} Uhr`,
    every: (minutes: string) => `alle ${minutes} Minuten ein Termin`,
    onePatient: 'Ein Patient je Termin',
    patients: (count: number) => `${count} Patienten gleichzeitig`,
    inactiveLong: 'Inaktiv, erzeugt keine Slots',
    deleteText: (name: string) =>
      `Soll die Vorlage „${name}“ gelöscht werden? Ihre freien Slots werden entfernt, bereits gebuchte Termine bleiben bestehen.`,
    editTitle: 'Slot-Vorlage bearbeiten',
    newTitle: 'Neue Slot-Vorlage',
    nameHint: 'Zum Beispiel „Vorsorge nachmittags“.',
    until: 'bis',
    windowEnd: 'Ende des Zeitfensters',
    oClock: 'Uhr',
    intervalHint:
      'Abstand zwischen zwei Terminen. Ohne Angabe folgen die Termine direkt aufeinander.',
    minutes: 'Minuten',
    capacityHint: 'Wie viele Patienten zur selben Zeit einen Termin bekommen können.',
    validFrom: 'ab',
    validUntil: 'Gültig bis (leer für unbegrenzt)',
    activeLabel: 'Aktiv: aus dieser Vorlage werden Slots erzeugt',
  },
  en: {
    from: (date: string) => `from ${date}`,
    title: 'Slot templates',
    name: 'Name',
    category: 'Category',
    weekdays: 'Weekdays',
    window: 'Time window',
    interval: 'Interval',
    capacity: 'Parallel',
    validity: 'Valid',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    noun: ['Slot template', 'slot templates'] as [string, string],
    newTemplate: 'New template …',
    empty: 'No slot templates yet',
    emptyHint:
      'A template defines on which weekdays and at which times appointments of a category can be booked.',
    noCategories: 'First create at least one appointment category under “Categories”.',
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    every: (minutes: string) => `one appointment every ${minutes} minutes`,
    onePatient: 'One patient per appointment',
    patients: (count: number) => `${count} patients at the same time`,
    inactiveLong: 'Inactive, creates no slots',
    deleteText: (name: string) =>
      `Delete the template “${name}”? Its free slots are removed; appointments already booked remain.`,
    editTitle: 'Edit slot template',
    newTitle: 'New slot template',
    nameHint: 'For example “Check-ups in the afternoon”.',
    until: 'to',
    windowEnd: 'End of the time window',
    oClock: '',
    intervalHint:
      'Time between two appointments. Without a value, appointments follow each other directly.',
    minutes: 'minutes',
    capacityHint: 'How many patients can get an appointment at the same time.',
    validFrom: 'from',
    validUntil: 'Valid until (empty for no end)',
    activeLabel: 'Active: slots are created from this template',
  },
});

const weekdaysText = (weekdays: Weekday[]) =>
  WEEKDAYS.filter((weekday) => weekdays.includes(weekday))
    .map((weekday) => WEEKDAY_SHORT[weekday])
    .join(', ');

const validityText = (template: SlotTemplate) =>
  template.validUntil
    ? `${formatDate(template.validFrom)} – ${formatDate(template.validUntil)}`
    : t.from(formatDate(template.validFrom));

/** Recurring windows in which a category can be booked, e.g. "Vorsorge, Di und Do 15–17 Uhr". */
export function TemplatesView() {
  const api = useApi();
  const config = useConfig();
  const canManage = useHasPermission('schedule.manage');
  const invalidate = useInvalidatePlanning();

  if (!config.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={config} />
      </ViewFrame>
    );
  }
  const { categories, templates, settings } = config.data;
  const today = toZoned(new Date(), settings.timeZone).date;
  const categoryOf = (template: SlotTemplate) =>
    categories.find((category) => category.id === template.categoryId);
  const intervalOf = (template: SlotTemplate) =>
    template.intervalMinutes ?? categoryOf(template)?.durationMinutes;

  const columns: GridColumn<SlotTemplate>[] = [
    {
      id: 'name',
      header: t.name,
      width: 210,
      render: (template) => template.name,
      sortValue: (template) => template.name,
    },
    {
      id: 'category',
      header: t.category,
      width: 190,
      render: (template) => {
        const category = categoryOf(template);
        return category ? <CategoryName category={category} /> : '–';
      },
      sortValue: (template) => categoryOf(template)?.name,
    },
    {
      id: 'weekdays',
      header: t.weekdays,
      width: 150,
      render: (template) => weekdaysText(template.weekdays),
    },
    {
      id: 'time',
      header: t.window,
      width: 130,
      render: (template) => `${template.from} – ${template.to}`,
      sortValue: (template) => template.from,
    },
    {
      id: 'interval',
      header: t.interval,
      width: 80,
      align: 'right',
      render: (template) => `${intervalOf(template) ?? '–'} min`,
    },
    {
      id: 'capacity',
      header: t.capacity,
      width: 80,
      align: 'right',
      render: (template) => template.capacity,
      sortValue: (template) => template.capacity,
    },
    { id: 'validity', header: t.validity, width: 190, muted: true, render: validityText },
    {
      id: 'active',
      header: t.status,
      width: 110,
      render: (template) =>
        template.active ? (
          <span className="pill pill--success">{t.active}</span>
        ) : (
          <span className="pill">{t.inactive}</span>
        ),
      sortValue: (template) => template.active,
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={templates}
      itemId={(template) => template.id}
      itemName={(template) => template.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel={t.newTemplate}
      onRefresh={() => void config.refetch()}
      empty={{
        title: t.empty,
        hint: categories.length > 0 ? t.emptyHint : t.noCategories,
      }}
      details={(template) => (
        <dl className="props">
          <dt>{t.name}</dt>
          <dd>{template.name}</dd>
          <dt>{t.category}</dt>
          <dd>{categoryOf(template)?.name ?? '–'}</dd>
          <dt>{t.weekdays}</dt>
          <dd>
            {WEEKDAYS.filter((weekday) => template.weekdays.includes(weekday))
              .map((weekday) => WEEKDAY_NAMES[weekday])
              .join(', ')}
          </dd>
          <dt>{t.window}</dt>
          <dd>{t.timeRange(template.from, template.to)}</dd>
          <dt>{t.interval}</dt>
          <dd>{t.every(String(intervalOf(template) ?? '–'))}</dd>
          <dt>{t.capacity}</dt>
          <dd>{template.capacity === 1 ? t.onePatient : t.patients(template.capacity)}</dd>
          <dt>{t.validity}</dt>
          <dd>{validityText(template)}</dd>
          <dt>{t.status}</dt>
          <dd>{template.active ? t.active : t.inactiveLong}</dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <TemplateDialog
          template={item}
          categories={categories}
          today={today}
          onClose={close}
          onSaved={saved}
        />
      )}
      deleteText={(template) => t.deleteText(template.name)}
      onDelete={async (template) => {
        await api.admin['slot-templates'][':id'].$delete({ param: { id: template.id } });
        await invalidate();
      }}
    />
  );
}

function TemplateDialog(props: {
  template: SlotTemplate | undefined;
  categories: AppointmentCategory[];
  today: string;
  onClose: () => void;
  onSaved: (template: SlotTemplate) => void;
}) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const { template, categories } = props;

  const form = useFormDialog({
    initial: (template ?? {
      name: '',
      categoryId: categories[0]?.id ?? '',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      from: '08:00',
      to: '12:00',
      capacity: 1,
      validFrom: props.today,
      active: true,
    }) as SlotTemplateInput,
    schema: SlotTemplateInputSchema,
    save: async (input) => {
      const saved = await (template
        ? data(api.admin['slot-templates'][':id'].$put({ param: { id: template.id }, json: input }))
        : data(api.admin['slot-templates'].$post({ json: input })));
      await invalidate();
      return saved;
    },
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;
  const category = categories.find((candidate) => candidate.id === draft.categoryId);

  const toggleWeekday = (weekday: Weekday) =>
    set({
      weekdays: draft.weekdays.includes(weekday)
        ? draft.weekdays.filter((candidate) => candidate !== weekday)
        : [...draft.weekdays, weekday],
    });

  return (
    <FormDialog title={template ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
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
      <FormRow label={t.category} error={errors.categoryId}>
        {(id) => (
          <select
            id={id}
            className="select"
            value={draft.categoryId}
            onChange={(event) => set({ categoryId: event.target.value })}
          >
            {categories.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.durationMinutes} min)
              </option>
            ))}
          </select>
        )}
      </FormRow>
      <FormRow label={t.weekdays} error={errors.weekdays}>
        {() => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the property sheet
          <div className="segmented" role="group" aria-label={t.weekdays}>
            {WEEKDAYS.map((weekday) => (
              <button
                key={weekday}
                type="button"
                aria-pressed={draft.weekdays.includes(weekday)}
                title={WEEKDAY_NAMES[weekday]}
                onClick={() => toggleWeekday(weekday)}
              >
                {WEEKDAY_SHORT[weekday]}
              </button>
            ))}
          </div>
        )}
      </FormRow>
      <FormRow label={t.window} error={errors.from ?? errors.to}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="time"
              className="input input--tiny"
              value={draft.from}
              onChange={(event) => set({ from: event.target.value })}
            />
            {t.until}
            <input
              type="time"
              className="input input--tiny"
              aria-label={t.windowEnd}
              value={draft.to}
              onChange={(event) => set({ to: event.target.value })}
            />
            {t.oClock}
          </div>
        )}
      </FormRow>
      <FormRow label={t.interval} error={errors.intervalMinutes} hint={t.intervalHint}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="number"
              className="input input--tiny"
              min={5}
              max={240}
              step={5}
              placeholder={category ? String(category.durationMinutes) : ''}
              value={draft.intervalMinutes ?? ''}
              onChange={(event) =>
                set({
                  intervalMinutes: event.target.value ? event.target.valueAsNumber : undefined,
                })
              }
            />
            {t.minutes}
          </div>
        )}
      </FormRow>
      <FormRow label={t.capacity} error={errors.capacity} hint={t.capacityHint}>
        {(id) => (
          <input
            id={id}
            type="number"
            className="input input--tiny"
            min={1}
            max={10}
            value={draft.capacity}
            onChange={(event) => set({ capacity: event.target.valueAsNumber })}
          />
        )}
      </FormRow>
      <FormRow label={t.validity} error={errors.validFrom ?? errors.validUntil}>
        {(id) => (
          <div className="form__row">
            {t.validFrom}
            <input
              id={id}
              type="date"
              className="input input--narrow"
              value={draft.validFrom}
              onChange={(event) => set({ validFrom: event.target.value })}
            />
            {t.until}
            <input
              type="date"
              className="input input--narrow"
              aria-label={t.validUntil}
              value={draft.validUntil ?? ''}
              min={draft.validFrom}
              onChange={(event) => set({ validUntil: event.target.value || undefined })}
            />
          </div>
        )}
      </FormRow>
      <FormRow label={t.status}>
        {() => (
          <Checkbox
            label={t.activeLabel}
            checked={draft.active}
            onChange={(active) => set({ active })}
          />
        )}
      </FormRow>
    </FormDialog>
  );
}
