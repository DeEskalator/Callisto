import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

export class UserExistsError extends Error {}

/**
 * The sign-in side of user management. Accounts and credentials live in Cognito; names, roles and
 * the practice a user belongs to live in the table.
 */
export interface UserDirectory {
  /** Creates the account and e-mails an invitation with a temporary password. @returns the user id */
  createUser(email: string, name: string): Promise<string>;
  /** The id of the account with this e-mail address, if there is one. */
  findUserId(email: string): Promise<string | undefined>;
  resendInvitation(email: string): Promise<void>;
  /** Disabling also ends all sessions of the user. */
  setEnabled(userId: string, enabled: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

const subOf = (attributes: AttributeType[] | undefined) =>
  attributes?.find((attribute) => attribute.Name === 'sub')?.Value;

const hasName = (error: unknown, name: string) => error instanceof Error && error.name === name;

export class CognitoUserDirectory implements UserDirectory {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
  ) {}

  async createUser(email: string, name: string): Promise<string> {
    try {
      const result = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: name },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      const userId = subOf(result.User?.Attributes);
      if (!userId) {
        throw new Error('Cognito created a user without a sub attribute');
      }
      return userId;
    } catch (error) {
      if (hasName(error, 'UsernameExistsException')) {
        throw new UserExistsError(email);
      }
      throw error;
    }
  }

  async findUserId(email: string): Promise<string | undefined> {
    try {
      const result = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }),
      );
      return subOf(result.UserAttributes);
    } catch (error) {
      if (hasName(error, 'UserNotFoundException')) {
        return undefined;
      }
      throw error;
    }
  }

  async resendInvitation(email: string): Promise<void> {
    await this.client.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    const target = { UserPoolId: this.userPoolId, Username: userId };
    if (enabled) {
      await this.client.send(new AdminEnableUserCommand(target));
    } else {
      await this.client.send(new AdminDisableUserCommand(target));
      await this.client.send(new AdminUserGlobalSignOutCommand(target));
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: userId }),
      );
    } catch (error) {
      if (!hasName(error, 'UserNotFoundException')) {
        throw error;
      }
    }
  }
}
