import process from 'node:process';
import prompts from 'prompts';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import type { AccountIdentity } from '../models/account';
import { UserFacingError } from '../util/errors';
import type { CliContext } from './context';

function readStringField(record: unknown, key: string): string | undefined {
  if (typeof record !== 'object' || record === null) {
    return undefined;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

async function promptForCredentials(
  seedEmail?: string
): Promise<{ email: string; password: string }> {
  const answers: unknown = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Ubisoft email',
      initial: seedEmail,
      validate: (value: string) =>
        value.length > 3 ? true : 'Email is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Ubisoft password',
      validate: (value: string) =>
        value.length > 0 ? true : 'Password is required'
    }
  ]);

  const email = readStringField(answers, 'email');
  const password = readStringField(answers, 'password');

  if (!email || !password) {
    throw new UserFacingError('Login cancelled.');
  }

  return {
    email,
    password
  };
}

async function promptForTwoFactorCode(): Promise<string> {
  const answers: unknown = await prompts({
    type: 'text',
    name: 'code',
    message: 'Ubisoft 2FA code',
    validate: (value: string) =>
      value.trim().length > 0 ? true : 'Code is required'
  });

  const code = readStringField(answers, 'code');

  if (!code) {
    throw new UserFacingError('2FA verification cancelled.');
  }

  return code.trim();
}

function emitIdentity(identity: AccountIdentity, asJson?: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `userId: ${identity.userId}`,
      `username: ${identity.username}`,
      `nameOnPlatform: ${identity.nameOnPlatform}`,
      `email: ${identity.email ?? '(unknown)'}`,
      `source: ${identity.source}`
    ].join('\n') + '\n'
  );
}

export function registerAuthCommands(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('login')
    .description('Log in to Ubisoft Connect using the public session API')
    .option('--email <email>', 'Ubisoft account email')
    .option('--password-stdin', 'Read the Ubisoft password from stdin')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        email?: string;
        passwordStdin?: boolean;
        json?: boolean;
      }) => {
        const context = await makeContext();
        const auth = new AuthService(
          context.paths,
          context.config,
          context.logger.child('auth')
        );

        let email = options.email ?? process.env.UBI_EMAIL;
        let password = process.env.UBI_PASSWORD;

        if (options.passwordStdin) {
          password = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            process.stdin.on('data', (chunk) =>
              chunks.push(Buffer.from(chunk))
            );
            process.stdin.on('end', () =>
              resolve(Buffer.concat(chunks).toString('utf8').trim())
            );
            process.stdin.on('error', reject);
          });
        }

        if (!email || !password) {
          const prompted = await promptForCredentials(email);
          email = prompted.email;
          password = prompted.password;
        }

        const login = await auth.loginWithPassword(email, password);

        if (login.kind === '2fa-required') {
          const code =
            process.env.UBI_2FA_CODE ?? (await promptForTwoFactorCode());
          const completed = await auth.completeTwoFactor(
            login.ticket,
            code,
            email
          );

          if (options.json) {
            process.stdout.write(
              `${JSON.stringify(completed.session, null, 2)}\n`
            );
            return;
          }

          process.stdout.write(
            `Logged in as ${completed.session.nameOnPlatform ?? completed.session.userId}.\n`
          );
          return;
        }

        if (options.json) {
          process.stdout.write(`${JSON.stringify(login.session, null, 2)}\n`);
          return;
        }

        process.stdout.write(
          `Logged in as ${login.session.nameOnPlatform ?? login.session.userId}.\n`
        );
      }
    );

  program
    .command('logout')
    .description('Remove the locally stored Ubisoft session')
    .action(async () => {
      const context = await makeContext();
      const auth = new AuthService(
        context.paths,
        context.config,
        context.logger.child('auth')
      );
      await auth.logout();
      process.stdout.write('Logged out.\n');
    });

  program
    .command('me')
    .description('Show the authenticated Ubisoft account identity')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const context = await makeContext();
      const auth = new AuthService(
        context.paths,
        context.config,
        context.logger.child('auth')
      );
      const identity = await auth.getIdentity();
      emitIdentity(identity, options.json);
    });
}
