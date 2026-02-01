import { type UserDirectory, UserExistsError } from '../users/directory';

/** Stands in for Cognito in tests and in the local development server. */
export class MemoryUserDirectory implements UserDirectory {
  readonly accounts = new Map<string, { id: string; enabled: boolean }>();
  readonly invitations: string[] = [];
  private nextId = 1;

  async createUser(email: string) {
    if (this.accounts.has(email)) {
      throw new UserExistsError(email);
    }
    const id = `account-${this.nextId++}`;
    this.accounts.set(email, { id, enabled: true });
    this.invitations.push(email);
    return id;
  }

  async findUserId(email: string) {
    return this.accounts.get(email)?.id;
  }

  async resendInvitation(email: string) {
    this.invitations.push(email);
  }

  async setEnabled(userId: string, enabled: boolean) {
    for (const account of this.accounts.values()) {
      if (account.id === userId) {
        account.enabled = enabled;
      }
    }
  }

  async deleteUser(userId: string) {
    for (const [email, account] of this.accounts) {
      if (account.id === userId) {
        this.accounts.delete(email);
      }
    }
  }
}

/** The bindings the Lambda adapter passes to the app, as API Gateway's authorizer would fill them. */
export function signedInAs(userId: string | undefined) {
  return {
    event: { requestContext: { authorizer: userId ? { claims: { sub: userId } } : undefined } },
    lambdaContext: {},
  };
}
