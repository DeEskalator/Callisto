import {
  PERMISSIONS,
  type Permission,
  type Role,
  type RoleInput,
  RoleInputSchema,
} from '@callisto/domain';
import { useQueryClient } from '@tanstack/react-query';
import { data, useApi } from '../../app/api';
import { queryKeys } from '../../app/queries';
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { PERMISSION_LABELS } from './permissions';
import { useRoles, useUsers } from './UsersView';

const t = localized({
  de: {
    title: 'Rollen',
    role: 'Rolle',
    kind: 'Art',
    builtin: 'Vorgegeben',
    custom: 'Eigene Rolle',
    permissions: 'Rechte',
    ofTotal: (granted: number, total: number) => `${granted} von ${total}`,
    users: 'Benutzer',
    noun: ['Rolle', 'Rollen'] as [string, string],
    newRole: 'Neue Rolle …',
    empty: 'Keine Rollen',
    builtinLong: 'Vorgegeben, nicht änderbar',
    nobody: 'Niemand',
    deleteText: (name: string) => `Soll die Rolle „${name}“ gelöscht werden?`,
    editTitle: 'Rolle bearbeiten',
    newTitle: 'Neue Rolle',
    name: 'Name',
    nameHint: 'Zum Beispiel „Empfang“ oder „Auszubildende“.',
  },
  en: {
    title: 'Roles',
    role: 'Role',
    kind: 'Kind',
    builtin: 'Built-in',
    custom: 'Custom role',
    permissions: 'Permissions',
    ofTotal: (granted: number, total: number) => `${granted} of ${total}`,
    users: 'Users',
    noun: ['Role', 'roles'] as [string, string],
    newRole: 'New role …',
    empty: 'No roles',
    builtinLong: 'Built-in, cannot be changed',
    nobody: 'Nobody',
    deleteText: (name: string) => `Delete the role “${name}”?`,
    editTitle: 'Edit role',
    newTitle: 'New role',
    name: 'Name',
    nameHint: 'For example “Reception” or “Trainees”.',
  },
});

/** Roles bundle permissions; every user has exactly one role. */
export function RolesView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const users = useUsers();

  if (!roles.data || !users.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={roles.data ? users : roles} />
      </ViewFrame>
    );
  }
  const membersOf = (role: Role) => users.data.filter((user) => user.roleId === role.id);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.roles }),
      // The own permissions may have changed with the role.
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    ]);

  const columns: GridColumn<Role>[] = [
    {
      id: 'name',
      header: t.role,
      width: 220,
      render: (role) => role.name,
      sortValue: (role) => role.name,
    },
    {
      id: 'kind',
      header: t.kind,
      width: 130,
      muted: true,
      render: (role) => (role.builtin ? t.builtin : t.custom),
      sortValue: (role) => role.builtin,
    },
    {
      id: 'permissions',
      header: t.permissions,
      width: 110,
      align: 'right',
      render: (role) => t.ofTotal(role.permissions.length, PERMISSIONS.length),
      sortValue: (role) => role.permissions.length,
    },
    {
      id: 'members',
      header: t.users,
      width: 100,
      align: 'right',
      render: (role) => membersOf(role).length,
      sortValue: (role) => membersOf(role).length,
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={roles.data}
      itemId={(role) => role.id}
      itemName={(role) => role.name}
      columns={columns}
      canManage
      newLabel={t.newRole}
      onRefresh={() => void roles.refetch()}
      empty={{ title: t.empty }}
      canEdit={(role) => !role.builtin}
      canDelete={(role) => !role.builtin}
      details={(role) => (
        <>
          <dl className="props">
            <dt>{t.role}</dt>
            <dd>{role.name}</dd>
            <dt>{t.kind}</dt>
            <dd>{role.builtin ? t.builtinLong : t.custom}</dd>
            <dt>{t.users}</dt>
            <dd>
              {membersOf(role)
                .map((user) => user.name)
                .join(', ') || t.nobody}
            </dd>
          </dl>
          <div className="inspector__section">{t.permissions}</div>
          <ul className="checklist">
            {PERMISSIONS.map((permission) => (
              <li key={permission} data-granted={role.permissions.includes(permission)}>
                {PERMISSION_LABELS[permission].label}
              </li>
            ))}
          </ul>
        </>
      )}
      dialog={({ item, close, saved }) => (
        <RoleDialog
          role={item}
          onClose={close}
          onSaved={async (role) => {
            await refresh();
            saved(role);
          }}
        />
      )}
      deleteText={(role) => t.deleteText(role.name)}
      onDelete={async (role) => {
        await api.users.roles[':id'].$delete({ param: { id: role.id } });
        await refresh();
      }}
    />
  );
}

function RoleDialog(props: {
  role: Role | undefined;
  onClose: () => void;
  onSaved: (role: Role) => void;
}) {
  const api = useApi();
  const { role } = props;

  const form = useFormDialog({
    initial: { name: role?.name ?? '', permissions: role?.permissions ?? [] } as RoleInput,
    schema: RoleInputSchema,
    save: (input) =>
      role
        ? data(api.users.roles[':id'].$put({ param: { id: role.id }, json: input }))
        : data(api.users.roles.$post({ json: input })),
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  const toggle = (permission: Permission, granted: boolean) =>
    set({
      permissions: granted
        ? [...draft.permissions, permission]
        : draft.permissions.filter((candidate) => candidate !== permission),
    });

  return (
    <FormDialog title={role ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
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
      <FormRow label={t.permissions} error={errors.permissions}>
        {() => (
          <div className="permission-list">
            {PERMISSIONS.map((permission) => (
              <label key={permission} className="permission-list__item">
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(permission)}
                  onChange={(event) => toggle(permission, event.target.checked)}
                />
                <span>
                  <strong>{PERMISSION_LABELS[permission].label}</strong>
                  <br />
                  {PERMISSION_LABELS[permission].description}
                </span>
              </label>
            ))}
          </div>
        )}
      </FormRow>
    </FormDialog>
  );
}
