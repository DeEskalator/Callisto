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
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { PERMISSION_LABELS } from './permissions';
import { useRoles, useUsers } from './UsersView';

/** Roles bundle permissions; every user has exactly one role. */
export function RolesView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const users = useUsers();

  if (!roles.data || !users.data) {
    return (
      <ViewFrame title="Rollen">
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
      header: 'Rolle',
      width: 220,
      render: (role) => role.name,
      sortValue: (role) => role.name,
    },
    {
      id: 'kind',
      header: 'Art',
      width: 130,
      muted: true,
      render: (role) => (role.builtin ? 'Vorgegeben' : 'Eigene Rolle'),
      sortValue: (role) => role.builtin,
    },
    {
      id: 'permissions',
      header: 'Rechte',
      width: 110,
      align: 'right',
      render: (role) => `${role.permissions.length} von ${PERMISSIONS.length}`,
      sortValue: (role) => role.permissions.length,
    },
    {
      id: 'members',
      header: 'Benutzer',
      width: 100,
      align: 'right',
      render: (role) => membersOf(role).length,
      sortValue: (role) => membersOf(role).length,
    },
  ];

  return (
    <CollectionView
      title="Rollen"
      noun={['Rolle', 'Rollen']}
      items={roles.data}
      itemId={(role) => role.id}
      itemName={(role) => role.name}
      columns={columns}
      canManage
      newLabel="Neue Rolle …"
      onRefresh={() => void roles.refetch()}
      empty={{ title: 'Keine Rollen' }}
      canEdit={(role) => !role.builtin}
      canDelete={(role) => !role.builtin}
      details={(role) => (
        <>
          <dl className="props">
            <dt>Rolle</dt>
            <dd>{role.name}</dd>
            <dt>Art</dt>
            <dd>{role.builtin ? 'Vorgegeben, nicht änderbar' : 'Eigene Rolle'}</dd>
            <dt>Benutzer</dt>
            <dd>
              {membersOf(role)
                .map((user) => user.name)
                .join(', ') || 'Niemand'}
            </dd>
          </dl>
          <div className="inspector__section">Rechte</div>
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
      deleteText={(role) => <>Soll die Rolle „{role.name}“ gelöscht werden?</>}
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
    <FormDialog
      title={role ? 'Rolle bearbeiten' : 'Neue Rolle'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow label="Name" error={errors.name} hint="Zum Beispiel „Empfang“ oder „Auszubildende“.">
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
      <FormRow label="Rechte" error={errors.permissions}>
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
