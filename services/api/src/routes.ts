/**
 * Which function serves which first path segment below `/v1`, including all sub-paths.
 *
 * API Gateway is configured from this table, and the local development server dispatches by it,
 * so a route can never exist in one place and be missing in the other.
 */
export const API_ROUTES = {
  config: 'admin',
  status: 'admin',
  settings: 'admin',
  'opening-hours': 'admin',
  closures: 'admin',
  presets: 'admin',
  categories: 'admin',
  'slot-templates': 'admin',
  slots: 'admin',
  audit: 'admin',
  'test-sessions': 'admin',
  calls: 'calls',
  inquiries: 'calls',
  me: 'users',
  users: 'users',
  roles: 'users',
} as const;

export type ApiFunctionName = (typeof API_ROUTES)[keyof typeof API_ROUTES];
