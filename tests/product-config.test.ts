import { describe, expect, it } from 'vitest';
import { ProductService } from '../src/services/product-service';

const configuration = `version: 2.0
root:
  name: l1
  installer:
    publisher: Ubisoft
    help_url: https://support.ubi.com
  uplay:
    achievements_sync_id: ACU
localizations:
  default:
    l1: Assassin's Creed® Unity
`;

describe('product config summary', () => {
  it('resolves localized root names and fallback game code values', () => {
    const service = new ProductService({} as never, {} as never);
    const summary = (
      service as unknown as {
        getConfigSummary: (raw: string) => {
          rootName?: string;
          publisher?: string;
          helpUrl?: string;
          gameCode?: string;
          configurationVersion?: number;
        };
      }
    ).getConfigSummary(configuration);

    expect(summary).toEqual({
      rootName: "Assassin's Creed® Unity",
      publisher: 'Ubisoft',
      helpUrl: 'https://support.ubi.com',
      gameCode: 'ACU',
      configurationVersion: 2
    });
  });
});
