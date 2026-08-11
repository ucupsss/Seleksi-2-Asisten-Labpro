export interface RelyingAppConfig {
  appKey: string;
  appName: string;
  authBaseUrl: string;
  webHomeUrl: string;
  clientId: string;
  redirectUri: string;
  localSessionCookieName: string;
  internalSecret: string;
  localSessionTtlMinutes: number;
  pendingLoginTtlMinutes: number;
  allowedWebOrigins: string[];
}
