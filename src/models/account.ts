export interface AccountIdentity {
  userId: string;
  username: string;
  nameOnPlatform: string;
  email?: string;
  country?: string;
  dateOfBirth?: string;
  source: 'live' | 'session';
}
