import {
  type AppointmentCategory,
  type AppointmentCategoryInput,
  AppointmentCategoryInputSchema,
} from '@callisto/domain';
import { data, useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';

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
      <ViewFrame title="Kategorien">
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
      header: 'Name',
      width: 220,
      render: (category) => <CategoryName category={category} />,
      sortValue: (category) => category.name,
    },
    {
      id: 'duration',
      header: 'Dauer',
      width: 90,
      align: 'right',
      render: (category) => `${category.durationMinutes} min`,
      sortValue: (category) => category.durationMinutes,
    },
    {
      id: 'description',
      header: 'Wofür',
      width: 420,
      muted: true,
      render: (category) => category.description,
    },
    {
      id: 'templates',
      header: 'Vorlagen',
      width: 90,
      align: 'right',
      render: (category) => templatesOf(category).length,
      sortValue: (category) => templatesOf(category).length,
    },
    {
      id: 'active',
      header: 'Status',
      width: 110,
      render: (category) =>
        category.active ? (
          <span className="pill pill--success">Aktiv</span>
        ) : (
          <span className="pill">Inaktiv</span>
        ),
      sortValue: (category) => category.active,
    },
  ];

  return (
    <CollectionView
      title="Kategorien"
      noun={['Kategorie', 'Kategorien']}
      items={categories}
      itemId={(category) => category.id}
      itemName={(category) => category.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage={canManage}
      newLabel="Neue Kategorie …"
      onRefresh={() => void config.refetch()}
      empty={{
        title: 'Noch keine Kategorien',
        hint: 'Legen Sie für jede Art von Termin eine Kategorie an, zum Beispiel „Vorsorge“ oder „Blutabnahme“.',
      }}
      details={(category) => (
        <dl className="props">
          <dt>Name</dt>
          <dd>
            <CategoryName category={category} />
          </dd>
          <dt>Dauer</dt>
          <dd>{category.durationMinutes} Minuten</dd>
          <dt>Wofür</dt>
          <dd>{category.description || '–'}</dd>
          <dt>Hinweis</dt>
          <dd>{category.patientHint ?? '–'}</dd>
          <dt>Status</dt>
          <dd>{category.active ? 'Aktiv' : 'Inaktiv, wird nicht vergeben'}</dd>
          <dt>Vorlagen</dt>
          <dd>
            {templatesOf(category)
              .map((template) => template.name)
              .join(', ') || 'Keine'}
          </dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <CategoryDialog category={item} onClose={close} onSaved={saved} />
      )}
      deleteText={(category) => (
        <>
          Soll die Kategorie „{category.name}“ gelöscht werden? Bereits gebuchte Termine bleiben
          bestehen.
        </>
      )}
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
    <FormDialog
      title={category ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow label="Name" error={errors.name}>
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
        label="Wofür"
        error={errors.description}
        hint="Beschreiben Sie, welche Anliegen in diese Kategorie gehören. Daran entscheidet der Assistent, welche Kategorie er einem Anrufer anbietet."
      >
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
      <FormRow label="Dauer" error={errors.durationMinutes}>
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
            Minuten
          </div>
        )}
      </FormRow>
      <FormRow
        label="Hinweis"
        error={errors.patientHint}
        hint="Wird dem Patienten nach der Buchung gesagt, zum Beispiel „Bitte kommen Sie nüchtern.“"
      >
        {(id) => (
          <input
            id={id}
            className="input"
            value={draft.patientHint ?? ''}
            onChange={(event) => set({ patientHint: event.target.value || undefined })}
          />
        )}
      </FormRow>
      <FormRow label="Farbe" error={errors.color} hint="Kennzeichnet die Kategorie im Kalender.">
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
      <FormRow label="Status">
        {() => (
          <Checkbox
            label="Aktiv: Termine dieser Kategorie werden vergeben"
            checked={draft.active}
            onChange={(active) => set({ active })}
          />
        )}
      </FormRow>
    </FormDialog>
  );
}
