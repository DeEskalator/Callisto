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
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { CategoryName } from '../categories/CategoriesView';

const weekdaysText = (weekdays: Weekday[]) =>
  WEEKDAYS.filter((weekday) => weekdays.includes(weekday))
    .map((weekday) => WEEKDAY_SHORT[weekday])
    .join(', ');

const validityText = (template: SlotTemplate) =>
  template.validUntil
    ? `${formatDate(template.validFrom)} – ${formatDate(template.validUntil)}`
    : `ab ${formatDate(template.validFrom)}`;

/** Recurring windows in which a category can be booked, e.g. "Vorsorge, Di und Do 15–17 Uhr". */
export function TemplatesView() {
  const api = useApi();
  const config = useConfig();
  const canManage = useHasPermission('schedule.manage');
  const invalidate = useInvalidatePlanning();

  if (!config.data) {
    return (
      <ViewFrame title="Slot-Vorlagen">
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
      header: 'Name',
      width: 210,
      render: (template) => template.name,
      sortValue: (template) => template.name,
    },
    {
      id: 'category',
      header: 'Kategorie',
      width: 190,
      render: (template) => {
        const category = categoryOf(template);
        return category ? <CategoryName category={category} /> : '–';
      },
      sortValue: (template) => categoryOf(template)?.name,
    },
    {
      id: 'weekdays',
      header: 'Wochentage',
      width: 150,
      render: (template) => weekdaysText(template.weekdays),
    },
    {
      id: 'time',
      header: 'Zeitfenster',
      width: 130,
      render: (template) => `${template.from} – ${template.to}`,
      sortValue: (template) => template.from,
    },
    {
      id: 'interval',
      header: 'Takt',
      width: 80,
      align: 'right',
      render: (template) => `${intervalOf(template) ?? '–'} min`,
    },
    {
      id: 'capacity',
      header: 'Parallel',
      width: 80,
      align: 'right',
      render: (template) => template.capacity,
      sortValue: (template) => template.capacity,
    },
    { id: 'validity', header: 'Gültig', width: 190, muted: true, render: validityText },
    {
      id: 'active',
      header: 'Status',
      width: 110,
      render: (template) =>
        template.active ? (
          <span className="pill pill--success">Aktiv</span>
        ) : (
          <span className="pill">Inaktiv</span>
        ),
      sortValue: (template) => template.active,
    },
  ];

  return (
    <CollectionView
      title="Slot-Vorlagen"
      noun={['Slot-Vorlage', 'Slot-Vorlagen']}
      items={templates}
      itemId={(template) => template.id}
      itemName={(template) => template.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel="Neue Vorlage …"
      onRefresh={() => void config.refetch()}
      empty={{
        title: 'Noch keine Slot-Vorlagen',
        hint:
          categories.length > 0
            ? 'Eine Vorlage legt fest, an welchen Wochentagen und zu welchen Zeiten Termine einer Kategorie buchbar sind.'
            : 'Legen Sie zuerst unter „Kategorien“ mindestens eine Terminkategorie an.',
      }}
      details={(template) => (
        <dl className="props">
          <dt>Name</dt>
          <dd>{template.name}</dd>
          <dt>Kategorie</dt>
          <dd>{categoryOf(template)?.name ?? '–'}</dd>
          <dt>Wochentage</dt>
          <dd>
            {WEEKDAYS.filter((weekday) => template.weekdays.includes(weekday))
              .map((weekday) => WEEKDAY_NAMES[weekday])
              .join(', ')}
          </dd>
          <dt>Zeitfenster</dt>
          <dd>
            {template.from} – {template.to} Uhr
          </dd>
          <dt>Takt</dt>
          <dd>alle {intervalOf(template) ?? '–'} Minuten ein Termin</dd>
          <dt>Parallel</dt>
          <dd>
            {template.capacity === 1
              ? 'Ein Patient je Termin'
              : `${template.capacity} Patienten gleichzeitig`}
          </dd>
          <dt>Gültig</dt>
          <dd>{validityText(template)}</dd>
          <dt>Status</dt>
          <dd>{template.active ? 'Aktiv' : 'Inaktiv, erzeugt keine Slots'}</dd>
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
      deleteText={(template) => (
        <>
          Soll die Vorlage „{template.name}“ gelöscht werden? Ihre freien Slots werden entfernt,
          bereits gebuchte Termine bleiben bestehen.
        </>
      )}
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
    <FormDialog
      title={template ? 'Slot-Vorlage bearbeiten' : 'Neue Slot-Vorlage'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow label="Name" error={errors.name} hint="Zum Beispiel „Vorsorge nachmittags“.">
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
      <FormRow label="Kategorie" error={errors.categoryId}>
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
      <FormRow label="Wochentage" error={errors.weekdays}>
        {() => (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the property sheet
          <div className="segmented" role="group" aria-label="Wochentage">
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
      <FormRow label="Zeitfenster" error={errors.from ?? errors.to}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="time"
              className="input input--tiny"
              value={draft.from}
              onChange={(event) => set({ from: event.target.value })}
            />
            bis
            <input
              type="time"
              className="input input--tiny"
              aria-label="Ende des Zeitfensters"
              value={draft.to}
              onChange={(event) => set({ to: event.target.value })}
            />
            Uhr
          </div>
        )}
      </FormRow>
      <FormRow
        label="Takt"
        error={errors.intervalMinutes}
        hint="Abstand zwischen zwei Terminen. Ohne Angabe folgen die Termine direkt aufeinander."
      >
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
            Minuten
          </div>
        )}
      </FormRow>
      <FormRow
        label="Parallel"
        error={errors.capacity}
        hint="Wie viele Patienten zur selben Zeit einen Termin bekommen können."
      >
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
      <FormRow label="Gültig" error={errors.validFrom ?? errors.validUntil}>
        {(id) => (
          <div className="form__row">
            ab
            <input
              id={id}
              type="date"
              className="input input--narrow"
              value={draft.validFrom}
              onChange={(event) => set({ validFrom: event.target.value })}
            />
            bis
            <input
              type="date"
              className="input input--narrow"
              aria-label="Gültig bis (leer für unbegrenzt)"
              value={draft.validUntil ?? ''}
              min={draft.validFrom}
              onChange={(event) => set({ validUntil: event.target.value || undefined })}
            />
          </div>
        )}
      </FormRow>
      <FormRow label="Status">
        {() => (
          <Checkbox
            label="Aktiv: aus dieser Vorlage werden Slots erzeugt"
            checked={draft.active}
            onChange={(active) => set({ active })}
          />
        )}
      </FormRow>
    </FormDialog>
  );
}
