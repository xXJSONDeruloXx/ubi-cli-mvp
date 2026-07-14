function isUbisoftEnvironmentVariable(key: string): boolean {
  return key.toUpperCase().startsWith('UBI_');
}

export function sanitizedChildEnvironment(
  extra: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!isUbisoftEnvironmentVariable(key)) {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!isUbisoftEnvironmentVariable(key)) {
      environment[key] = value;
    }
  }
  return environment;
}
