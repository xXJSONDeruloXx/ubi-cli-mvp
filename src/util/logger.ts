export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
  level: LogLevel;
}

const levelOrder: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function shouldLog(
  current: LogLevel,
  desired: Exclude<LogLevel, 'silent'>
): boolean {
  if (current === 'silent') {
    return false;
  }

  return levelOrder[desired] >= levelOrder[current];
}

function writeLine(
  level: Exclude<LogLevel, 'silent'>,
  scope: string,
  message: string,
  fields?: Record<string, unknown>
): void {
  const payload = {
    time: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(fields ?? {})
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

export function createLogger(level: LogLevel, scope = 'app'): Logger {
  return {
    level,
    debug(message, fields) {
      if (shouldLog(level, 'debug')) {
        writeLine('debug', scope, message, fields);
      }
    },
    info(message, fields) {
      if (shouldLog(level, 'info')) {
        writeLine('info', scope, message, fields);
      }
    },
    warn(message, fields) {
      if (shouldLog(level, 'warn')) {
        writeLine('warn', scope, message, fields);
      }
    },
    error(message, fields) {
      if (shouldLog(level, 'error')) {
        writeLine('error', scope, message, fields);
      }
    },
    child(childScope) {
      return createLogger(level, `${scope}:${childScope}`);
    }
  };
}
