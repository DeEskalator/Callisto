import { type Role, UserCreateSchema, type UserProfile, UserStatusSchema } from '@callisto/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus } from 'lucide-react';
import { data, errorMessage, useApi } from '../../app/api';
import { queryKeys, useMe } from '../../app/queries';
import { formatTimestamp } from '../../lib/format';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';

const UserFormSchema = UserCreateSchema.extend({ status: UserStatusSchema });

export function useUsers() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.users, queryFn: () => data(api.users.users.$get()) });
}

export function useRoles() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.roles, queryFn: () => data(api.users.roles.$get()) });
}

/** The people who may sign in, and what role each of them has. */
export function UsersView() {
  const api = useApi();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const users = useUsers();
  const roles = useRoles();
  const me = useMe().data;

  const invite = useMutation({
    mutationFn: (user: UserProfile) =>
      api.users.users[':id'].invitation.$post({ param: { id: user.id } }),
    onSuccess: (_response, user) =>
      notify({ kind: 'success', title: `Die Einladung wurde erneut an ${user.email} gesendet` }),
    onError: (error) =>
      notify({
        kind: 'error',
        title: 'Die Einladung wurde nicht gesendet',
        text: errorMessage(error),
      }),
  });

  if (!users.data || !roles.data) {
    return (
      <ViewFrame title="Benutzer">
        <QueryState query={users.data ? roles : users} />
      </ViewFrame>
    );
  }
  const roleName = (user: UserProfile) =>
    roles.data.find((role) => role.id === user.roleId)?.name ?? 'Unbekannte Rolle';
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });

  const columns: GridColumn<UserProfile>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 230,
      render: (user) => (user.id === me?.profile.id ? `${user.name} (Sie)` : user.name),
      sortValue: (user) => user.name,
    },
    {
      id: 'email',
      header: 'E-Mail-Adresse',
      width: 270,
      render: (user) => user.email,
      sortValue: (user) => user.email,
    },
    { id: 'role', header: 'Rolle', width: 180, render: roleName, sortValue: roleName },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      render: (user) =>
        user.status === 'active' ? (
          <span className="pill pill--success">Aktiv</span>
        ) : (
          <span className="pill pill--danger">Gesperrt</span>
        ),
      sortValue: (user) => user.status,
    },
    {
      id: 'created',
      header: 'Angelegt',
      width: 160,
      muted: true,
      render: (user) => formatTimestamp(user.createdAt),
      sortValue: (user) => user.createdAt,
    },
  ];

  return (
    <CollectionView
      title="Benutzer"
      noun={['Benutzerkonto', 'Benutzerkonten']}
      items={users.data}
      itemId={(user) => user.id}
      itemName={(user) => user.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage
      newLabel="Neuer Benutzer …"
      onRefresh={() => void users.refetch()}
      empty={{ title: 'Keine Benutzerkonten' }}
      canDelete={(user) => user.id !== me?.profile.id}
      extraCommands={(selected) => [
        {
          id: 'invite',
          label: 'Einladung erneut senden',
          icon: MailPlus,
          disabled: !selected,
          toolbar: false,
          run: () => selected && invite.mutate(selected),
        },
      ]}
      details={(user) => (
        <dl className="props">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>E-Mail</dt>
          <dd>{user.email}</dd>
          <dt>Rolle</dt>
          <dd>{roleName(user)}</dd>
          <dt>Status</dt>
          <dd>{user.status === 'active' ? 'Aktiv' : 'Gesperrt, Anmeldung nicht möglich'}</dd>
          <dt>Angelegt</dt>
          <dd>{formatTimestamp(user.createdAt)}</dd>
        </dl>
      )}
      dialog={({ item, close, saved }) => (
        <UserDialog
          user={item}
          roles={roles.data}
          isSelf={item?.id === me?.profile.id}
          onClose={close}
          onSaved={saved}
        />
      )}
      deleteText={(user) => (
        <>
          Soll das Benutzerkonto von {user.name} ({user.email}) gelöscht werden? Die Person kann
          sich danach nicht mehr anmelden.
        </>
      )}
      onDelete={async (user) => {
        await api.users.users[':id'].$delete({ param: { id: user.id } });
        await refresh();
      }}
    />
  );
}

function UserDialog(props: {
  user: UserProfile | undefined;
  roles: Role[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (user: UserProfile) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { user, roles } = props;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });

  const form = useFormDialog({
    initial: {
      email: user?.email ?? '',
      name: user?.name ?? '',
      roleId: user?.roleId ?? roles.find((role) => role.id === 'staff')?.id ?? roles[0]?.id ?? '',
      status: user?.status ?? ('active' as const),
    },
    schema: UserFormSchema,
    save: async ({ email, name, roleId, status }) => {
      // The address is the sign-in name: it is set when the account is created and kept after.
      const saved = await (user
        ? data(
            api.users.users[':id'].$patch({
              param: { id: user.id },
              json: { name, roleId, status },
            }),
          )
        : data(api.users.users.$post({ json: { email, name, roleId } })));
      await refresh();
      return saved;
    },
    onSaved: props.onSaved,
  });
  const { draft, errors, set } = form;

  return (
    <FormDialog
      title={user ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}
      form={form}
      onClose={props.onClose}
    >
      <FormRow
        label="E-Mail-Adresse"
        error={errors.email}
        hint={
          user
            ? 'Die Adresse ist der Anmeldename und kann nicht geändert werden.'
            : 'An diese Adresse wird die Einladung mit einem vorläufigen Passwort gesendet.'
        }
      >
        {(id) => (
          <input
            id={id}
            type="email"
            className="input"
            value={draft.email}
            disabled={Boolean(user)}
            aria-invalid={Boolean(errors.email)}
            onChange={(event) => set({ email: event.target.value })}
            // biome-ignore lint/a11y/noAutofocus: the first field of a dialog takes the focus, as in any desktop dialog
            autoFocus={!user}
          />
        )}
      </FormRow>
      <FormRow label="Name" error={errors.name}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={draft.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => set({ name: event.target.value })}
          />
        )}
      </FormRow>
      <FormRow
        label="Rolle"
        error={errors.roleId}
        {...(props.isSelf ? { hint: 'Die eigene Rolle kann nicht geändert werden.' } : {})}
      >
        {(id) => (
          <select
            id={id}
            className="select"
            value={draft.roleId}
            disabled={props.isSelf}
            onChange={(event) => set({ roleId: event.target.value })}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        )}
      </FormRow>
      {user && (
        <FormRow label="Status">
          {() => (
            <Checkbox
              label="Konto gesperrt: Anmeldung nicht möglich"
              checked={draft.status === 'disabled'}
              disabled={props.isSelf}
              onChange={(disabled) => set({ status: disabled ? 'disabled' : 'active' })}
            />
          )}
        </FormRow>
      )}
    </FormDialog>
  );
}
