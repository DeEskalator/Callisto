import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common';

/**
 * Everything a user can be allowed to do. Reading the practice configuration needs no permission
 * beyond being signed in, because every screen depends on it.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'calls.view',
  'transcripts.view',
  'inquiries.manage',
  'schedule.manage',
  'settings.manage',
  'users.manage',
  'testmode.use',
  'audit.view',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export const RoleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(PermissionSchema).max(PERMISSIONS.length),
});
export const RoleSchema = RoleInputSchema.extend({
  id: IdSchema,
  /** Built-in roles are created by the system and cannot be edited or deleted. */
  builtin: z.boolean(),
});
export type RoleInput = z.infer<typeof RoleInputSchema>;
export type Role = z.infer<typeof RoleSchema>;

export const ADMIN_ROLE_ID = 'admin';

export const BUILTIN_ROLES: Role[] = [
  { id: ADMIN_ROLE_ID, name: 'Administration', permissions: [...PERMISSIONS], builtin: true },
  {
    id: 'staff',
    name: 'Praxisteam',
    permissions: [
      'dashboard.view',
      'calls.view',
      'transcripts.view',
      'inquiries.manage',
      'schedule.manage',
    ],
    builtin: true,
  },
  {
    id: 'readonly',
    name: 'Nur lesen',
    permissions: ['dashboard.view', 'calls.view'],
    builtin: true,
  },
];

export const UserStatusSchema = z.enum(['active', 'disabled']);

export const UserProfileSchema = z.object({
  /** The Cognito `sub` of the user. */
  id: IdSchema,
  practiceId: IdSchema,
  email: z.email(),
  name: z.string().trim().min(1).max(120),
  roleId: IdSchema,
  status: UserStatusSchema,
  createdAt: TimestampSchema,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserCreateSchema = z.object({
  email: z.email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  roleId: IdSchema,
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const UserUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    roleId: IdSchema,
    status: UserStatusSchema,
  })
  .partial();
export type UserUpdate = z.infer<typeof UserUpdateSchema>;
