import { type Role, UserCreateSchema, type UserProfile, UserStatusSchema } from '@callisto/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus } from 'lucide-react';
import { data, errorMessage, useApi } from '../../app/api';
import { queryKeys, useMe } from '../../app/queries';
import { formatTimestamp } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { CollectionView } from '../../shell/CollectionView';
import { ViewFrame } from '../../shell/ViewFrame';
import type { GridColumn } from '../../ui/DataGrid';
import { Checkbox, FormRow } from '../../ui/Form';
import { FormDialog, useFormDialog } from '../../ui/FormDialog';
import { QueryState } from '../../ui/QueryState';
import { useNotify } from '../../ui/Toast';

const t = localized({
  de: {
    invited: (email: string) => `Die Einladung wurde erneut an ${email} gesendet`,
    notInvited: 'Die Einladung wurde nicht gesendet',
    title: 'Benutzer',
    unknownRole: 'Unbekannte Rolle',
    name: 'Name',
    you: (name: string) => `${name} (Sie)`,
    email: 'E-Mail-Adresse',
    emailShort: 'E-Mail',
    role: 'Rolle',
    status: 'Status',
    active: 'Aktiv',
    disabled: 'Gesperrt',
    disabledLong: 'Gesperrt, Anmeldung nicht möglich',
    created: 'Angelegt',
    noun: ['Benutzerkonto', 'Benutzerkonten'] as [string, string],
    newUser: 'Neuer Benutzer …',
    empty: 'Keine Benutzerkonten',
    resend: 'Einladung erneut senden',
    deleteText: (name: string, email: string) =>
      `Soll das Benutzerkonto von ${name} (${email}) gelöscht werden? Die Person kann sich danach nicht mehr anmelden.`,
    editTitle: 'Benutzer bearbeiten',
    newTitle: 'Neuer Benutzer',
    emailFixed: 'Die Adresse ist der Anmeldename und kann nicht geändert werden.',
    emailInvite: 'An diese Adresse wird die Einladung mit einem vorläufigen Passwort gesendet.',
    ownRole: 'Die eigene Rolle kann nicht geändert werden.',
    disableLabel: 'Konto gesperrt: Anmeldung nicht möglich',
  },
  en: {
    invited: (email: string) => `The invitation was sent to ${email} again`,
    notInvited: 'The invitation was not sent',
    title: 'Users',
    unknownRole: 'Unknown role',
    name: 'Name',
    you: (name: string) => `${name} (you)`,
    email: 'Email address',
    emailShort: 'Email',
    role: 'Role',
    status: 'Status',
    active: 'Active',
    disabled: 'Suspended',
    disabledLong: 'Suspended, cannot sign in',
    created: 'Created',
    noun: ['User account', 'user accounts'] as [string, string],
    newUser: 'New user …',
    empty: 'No user accounts',
    resend: 'Send invitation again',
    deleteText: (name: string, email: string) =>
      `Delete the user account of ${name} (${email})? The person can no longer sign in afterwards.`,
    editTitle: 'Edit user',
    newTitle: 'New user',
    emailFixed: 'The address is the sign-in name and cannot be changed.',
    emailInvite: 'The invitation with a temporary password is sent to this address.',
    ownRole: 'You cannot change your own role.',
    disableLabel: 'Account suspended: cannot sign in',
  },
});

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
    onSuccess: (_response, user) => notify({ kind: 'success', title: t.invited(user.email) }),
    onError: (error) =>
      notify({
        kind: 'error',
        title: t.notInvited,
        text: errorMessage(error),
      }),
  });

  if (!users.data || !roles.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={users.data ? roles : users} />
      </ViewFrame>
    );
  }
  const roleName = (user: UserProfile) =>
    roles.data.find((role) => role.id === user.roleId)?.name ?? t.unknownRole;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });

  const columns: GridColumn<UserProfile>[] = [
    {
      id: 'name',
      header: t.name,
      width: 230,
      render: (user) => (user.id === me?.profile.id ? t.you(user.name) : user.name),
      sortValue: (user) => user.name,
    },
    {
      id: 'email',
      header: t.email,
      width: 270,
      render: (user) => user.email,
      sortValue: (user) => user.email,
    },
    { id: 'role', header: t.role, width: 180, render: roleName, sortValue: roleName },
    {
      id: 'status',
      header: t.status,
      width: 110,
      render: (user) =>
        user.status === 'active' ? (
          <span className="pill pill--success">{t.active}</span>
        ) : (
          <span className="pill pill--danger">{t.disabled}</span>
        ),
      sortValue: (user) => user.status,
    },
    {
      id: 'created',
      header: t.created,
      width: 160,
      muted: true,
      render: (user) => formatTimestamp(user.createdAt),
      sortValue: (user) => user.createdAt,
    },
  ];

  return (
    <CollectionView
      title={t.title}
      noun={t.noun}
      items={users.data}
      itemId={(user) => user.id}
      itemName={(user) => user.name}
      columns={columns}
      initialSort={{ columnId: 'name', descending: false }}
      canManage
      newLabel={t.newUser}
      onRefresh={() => void users.refetch()}
      empty={{ title: t.empty }}
      canDelete={(user) => user.id !== me?.profile.id}
      extraCommands={(selected) => [
        {
          id: 'invite',
          label: t.resend,
          icon: MailPlus,
          disabled: !selected,
          toolbar: false,
          run: () => selected && invite.mutate(selected),
        },
      ]}
      details={(user) => (
        <dl className="props">
          <dt>{t.name}</dt>
          <dd>{user.name}</dd>
          <dt>{t.emailShort}</dt>
          <dd>{user.email}</dd>
          <dt>{t.role}</dt>
          <dd>{roleName(user)}</dd>
          <dt>{t.status}</dt>
          <dd>{user.status === 'active' ? t.active : t.disabledLong}</dd>
          <dt>{t.created}</dt>
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
      deleteText={(user) => t.deleteText(user.name, user.email)}
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
    <FormDialog title={user ? t.editTitle : t.newTitle} form={form} onClose={props.onClose}>
      <FormRow label={t.email} error={errors.email} hint={user ? t.emailFixed : t.emailInvite}>
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
      <FormRow label={t.name} error={errors.name}>
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
      <FormRow label={t.role} error={errors.roleId} {...(props.isSelf ? { hint: t.ownRole } : {})}>
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
        <FormRow label={t.status}>
          {() => (
            <Checkbox
              label={t.disableLabel}
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
