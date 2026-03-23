import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';

async function run(command: string, args: string[]): Promise<string> {
  const result = await execa(command, args, {
    env: {
      ...process.env
    }
  });

  return result.stdout;
}

describe('cli smoke test', () => {
  beforeAll(async () => {
    await execa('npm', ['run', 'build']);
  }, 120_000);

  it('runs doctor in json mode', async () => {
    const stdout = await run('node', ['dist/index.js', 'doctor', '--json']);
    const parsed = JSON.parse(stdout) as {
      appName: string;
      nodeVersion: string;
    };

    expect(parsed.appName).toBe('ubi-cli-mvp');
    expect(parsed.nodeVersion.startsWith('v')).toBe(true);
  }, 120_000);
});
