import {
  type AppointmentCategory,
  type AppointmentCategoryInput,
  AppointmentCategoryInputSchema,
} from '@callisto/domain';
import { data, useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';

const t = localized({
  de: {
    title: 'Kategorien',
    name: 'Name',
    duration: 'Dauer',
    purpose: 'Wofür',
    templates: 'Vorlagen',
    status: 'Status',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    noun: ['Kategorie', 'Kategorien'] as [string, string],
    newCategory: 'Neue Kategorie …',
    empty: 'Noch keine Kategorien',
    emptyHint:
      'Legen Sie für jede Art von Termin eine Kategorie an, zum Beispiel „Vorsorge“ oder „Blutabnahme“.',
    minutesOf: (minutes: number) => `${minutes} Minuten`,
    hint: 'Hinweis',
    inactiveLong: 'Inaktiv, wird nicht vergeben',
    none: 'Keine',
    deleteText: (name: string) =>
      `Soll die Kategorie „${name}“ gelöscht werden? Bereits gebuchte Termine bleiben bestehen.`,
    editTitle: 'Kategorie bearbeiten',
    newTitle: 'Neue Kategorie',
    purposeHint:
      'Beschreiben Sie, welche Anliegen in diese Kategorie gehören. Daran entscheidet der Assistent, welche Kategorie er einem Anrufer anbietet.',
    minutes: 'Minuten',
    patientHint:
      'Wird dem Patienten nach der Buchung gesagt, zum Beispiel „Bitte kommen Sie nüchtern.“',
    color: 'Farbe',
    colorHint: 'Kennzeichnet die Kategorie im Kalender.',
    activeLabel: 'Aktiv: Termine dieser Kategorie werden vergeben',
  },
  en: {
    title: 'Categories',
    name: 'Name',
    duration: 'Duration',
    purpose: 'Purpose',
    templates: 'Templates',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    noun: ['Category', 'categories'] as [string, string],
    newCategory: 'New category …',
    empty: 'No categories yet',
    emptyHint:
      'Create a category for every kind of appointment, for example “Check-up” or “Blood test”.',
    minutesOf: (minutes: number) => `${minutes} minutes`,
    hint: 'Hint',
    inactiveLong: 'Inactive, not booked',
    none: 'None',
    deleteText: (name: string) =>
      `Delete the category “${name}”? Appointments already booked remain.`,
    editTitle: 'Edit category',
    newTitle: 'New category',
    purposeHint:
      'Describe which concerns belong in this category. The assistant uses this to decide which category to offer a caller.',
    minutes: 'minutes',
    patientHint: 'Told to the patient after booking, for example “Please come fasting.”',
    color: 'Colour',
    colorHint: 'Marks the category in the calendar.',
    activeLabel: 'Active: appointments of this category are booked',
  },
});

export function CategoryName(props: { category: Pick<AppointmentCategory, 'name' | 'color'> }) {
  return (
    <>
      <span className="swatch" style={{ background: props.category.color }} />
      {props.category.name}
    </>
  );
}

/** The kinds of appointments the assistant can book, e.g. "Vorsorge" or "Blutabnahme". */
export function CategoriesView() {
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
  const { categories, templates } = config.data;
  const templatesOf = (category: AppointmentCategory) =>
    templates.filter((template) => template.categoryId === category.id);

  const columns: GridColumn<AppointmentCategory>[] = [
    {
      id: 'name',
      header: t.name,
      width: 220,
      render: (category) => <CategoryName category={category} />,
      sortValue: (category) => category.name,
    },
    {
      id: 'duration',
      header: t.duration,
      width: 90,
      align: 'right',
      render: (category) => `${category.durationMinutes} min`,
      sortValue: (category) => category.durationMinutes,
    },
    {
      id: 'description',
      header: t.purpose,
      width: 420,
      muted: true,
      render: (category) => category.description,
    },
    {
      id: 'templates',
      header: t.templates,
      width: 90,
      align: 'right',
      render: (category) => templatesOf(category).length,
      sortValue: (category) => templatesOf(category).length,
    },
    {
      id: 'active',
      header: t.status,
      width: 110,
      render: (category) =>
        category.active ? (
          <span className="pill pill--success">{t.active}</span>
        ) : (
          <span className="pill">{t.inactive}</span>
        ),
      sortValue: (category) => category.active,
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={categories}
      itemId={(category) => category.id}
      itemName={(category) => category.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel={t.newCategory}
      onRefresh={() => void config.refetch()}
      empty={{
        title: t.empty,
        hint: t.emptyHint,
      }}
      details={(category) => (
        <dl className="props">
          <dt>{t.name}</dt>
          <dd>
            <CategoryName category={category} />
          </dd>
          <dt>{t.duration}</dt>
          <dd>{t.minutesOf(category.durationMinutes)}</dd>
          <dt>{t.purpose}</dt>
          <dd>{category.description || '–'}</dd>
          <dt>{t.hint}</dt>
          <dd>{category.patientHint ?? '–'}</dd>
          <dt>{t.status}</dt>
          <dd>{category.active ? t.active : t.inactiveLong}</dd>
          <dt>{t.templates}</dt>
          <dd>
            {templatesOf(category)
              .map((template) => template.name)
              .join(', ') || t.none}
          </dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <CategoryDialog category={item} onClose={close} onSaved={saved} />
      )}
      deleteText={(category) => t.deleteText(category.name)}
      onDelete={async (category) => {
        await api.admin.categories[':id'].$delete({ param: { id: category.id } });
        await invalidate();
      }}
    />
  );
}

function CategoryDialog(props: {
  category: AppointmentCategory | undefined;
  onClose: () => void;
  onSaved: (category: AppointmentCategory) => void;
}) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const { category } = props;

  const form = useFormDialog({
    initial: (category ?? {
      name: '',
      description: '',
      durationMinutes: 15,
      color: '#1d4ed8',
      active: true,
    }) as AppointmentCategoryInput,
    schema: AppointmentCategoryInputSchema,
    save: async (input) => {
      const saved = await (category
        ? data(api.admin.categories[':id'].$put({ param: { id: category.id }, json: input }))
        : data(api.admin.categories.$post({ json: input })));
      await invalidate();
      return saved;
    },
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  return (
    <FormDialog title={category ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
      <FormRow label={t.name} error={errors.name}>
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
      <FormRow label={t.purpose} error={errors.description} hint={t.purposeHint}>
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            rows={3}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow label={t.duration} error={errors.durationMinutes}>
        {(id) => (
          <div className="form__row">
            <input
              id={id}
              type="number"
              className="input input--tiny"
              min={5}
              max={240}
              step={5}
              value={draft.durationMinutes}
              aria-invalid={Boolean(errors.durationMinutes)}
              onChange={(event) => set({ durationMinutes: event.target.valueAsNumber })}
            />
            {t.minutes}
          </div>
        )}
      </FormRow>
      <FormRow label={t.hint} error={errors.patientHint} hint={t.patientHint}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={draft.patientHint ?? ''}
            onChange={(event) => set({ patientHint: event.target.value || undefined })}
          />
        )}
      </FormRow>
      <FormRow label={t.color} error={errors.color} hint={t.colorHint}>
        {(id) => (
          <input
            id={id}
            type="color"
            className="input input--tiny"
            value={draft.color}
            onChange={(event) => set({ color: event.target.value })}
          />
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
