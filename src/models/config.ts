export interface RuntimeConfig {
  appName: string;
  servicesAppId: string;
  browserAppId: string;
  genomeId: string;
  requestedPlatformType: 'uplay';
  httpTimeoutMs: number;
  httpRetryCount: number;
}

export interface AppPaths {
  configDir: string;
  cacheDir: string;
  dataDir: string;
  logDir: string;
  debugDir: string;
  sessionFile: string;
  configFile: string;
}
