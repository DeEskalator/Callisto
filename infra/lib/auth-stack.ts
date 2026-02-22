import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { DeploymentConfig } from './config';

export interface AuthStackProps extends StackProps {
  config: DeploymentConfig;
}

/** Path in the web app that receives the authorization code after sign-in. */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** Identifier of the API as an OAuth resource server; the prefix of its scopes. */
const API_IDENTIFIER = 'callisto-api';

/**
 * Sign-in for the practice team. Credentials never touch our code: users sign in on Cognito's
 * managed login page and the web app only receives tokens (authorization code flow with PKCE).
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  /** OAuth scope an access token needs to call the app API, e.g. `callisto-api/app`. */
  readonly apiScope: string;
  /** Base URL of the managed login pages. */
  readonly loginBaseUrl: string;
  private readonly loginDomain: cognito.UserPoolDomain;
  private readonly resourceServer: cognito.UserPoolResourceServer;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const appUrl = config.domain ? `https://${config.domain.appHost}` : undefined;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `callisto-${config.stage}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      // Accounts are created by an administrator in the web app, never by the users themselves.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Ihr Zugang zum Telefonassistenten',
        emailBody: [
          'Guten Tag,',
          `für Sie wurde ein Zugang zum Telefonassistenten der ${config.practice.name} eingerichtet.`,
          'Benutzername: {username}<br>Vorläufiges Passwort: {####}',
          `Bei der ersten Anmeldung${appUrl ? ` unter ${appUrl}` : ''} vergeben Sie ein eigenes Passwort und richten die Zwei-Faktor-Anmeldung mit einer Authenticator-App ein.`,
        ].join('<br><br>'),
      },
      deletionProtection: config.production,
      removalPolicy: config.production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.loginDomain = this.userPool.addDomain('LoginDomain', {
      cognitoDomain: { domainPrefix: `callisto-${config.stage}-${Aws.ACCOUNT_ID}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    this.loginBaseUrl = this.loginDomain.baseUrl();

    const appScope = new cognito.ResourceServerScope({
      scopeName: 'app',
      scopeDescription: 'Zugriff der Weboberfläche auf die Callisto-API',
    });
    this.resourceServer = this.userPool.addResourceServer('ApiResourceServer', {
      identifier: API_IDENTIFIER,
      scopes: [appScope],
    });
    // Spelled out instead of derived from the resource, so other stacks get a plain string.
    this.apiScope = `${API_IDENTIFIER}/${appScope.scopeName}`;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'LoginBaseUrl', { value: this.loginBaseUrl });
  }

  /**
   * Registers the web app as a client of the user pool. It is created by the stack that knows
   * where the app is served from, because the login only redirects to addresses listed here.
   */
  addWebClient(scope: Construct, origins: string[]): cognito.UserPoolClient {
    const client = new cognito.UserPoolClient(scope, 'WebClient', {
      userPool: this.userPool,
      userPoolClientName: 'web',
      // A browser app cannot keep a secret; PKCE takes its place.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.custom(this.apiScope),
        ],
        callbackUrls: origins.map((origin) => origin + AUTH_CALLBACK_PATH),
        logoutUrls: origins.map((origin) => `${origin}/`),
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      // One working day: after that the team signs in again.
      refreshTokenValidity: Duration.hours(12),
    });
    // The client refers to the scope by name, so the dependency has to be stated.
    client.node.addDependency(this.resourceServer);

    // The new managed login only renders once a style is assigned to the app client.
    const branding = new cognito.CfnManagedLoginBranding(scope, 'LoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    branding.node.addDependency(this.loginDomain);
    return client;
  }
}
