import { describe, expect, it } from 'vitest';
import {
  dedupeLibraryItems,
  propagateKnownMetadataByTitle
} from '../src/services/library-service';
import type { LibraryItem } from '../src/models/library';

describe('library normalization helpers', () => {
  it('propagates known metadata to duplicate unknown entries of the same title when only one product id is known', () => {
    const items: LibraryItem[] = [
      {
        title: "Assassin's Creed® Unity",
        spaceId: 'known-space',
        productId: 720,
        appId: 'known-app',
        productType: 'Game',
        source: 'graphql'
      },
      {
        title: "Assassin's Creed® Unity",
        spaceId: 'unknown-space',
        source: 'graphql'
      }
    ];

    const propagated = propagateKnownMetadataByTitle(items);
    expect(propagated[1]).toMatchObject({
      productId: 720,
      appId: 'known-app',
      productType: 'Game'
    });
  });

  it('dedupes entries by canonical product id and tracks variant counts', () => {
    const items: LibraryItem[] = [
      {
        title: "Assassin's Creed® Unity",
        spaceId: 'space-a',
        productId: 720,
        source: 'graphql'
      },
      {
        title: "Assassin's Creed® Unity",
        spaceId: 'space-b',
        productId: 720,
        source: 'graphql'
      },
      {
        title: 'Far Cry® 3',
        spaceId: 'space-c',
        productId: 46,
        source: 'graphql'
      }
    ];

    const deduped = dedupeLibraryItems(items);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({
      title: "Assassin's Creed® Unity",
      variantCount: 2,
      variantSpaceIds: ['space-a', 'space-b']
    });
  });

  it('does not propagate when multiple known product ids share the same title', () => {
    const items: LibraryItem[] = [
      {
        title: 'For Honor',
        spaceId: 'space-a',
        productId: 569,
        source: 'graphql'
      },
      {
        title: 'For Honor',
        spaceId: 'space-b',
        productId: 2916,
        source: 'graphql'
      },
      {
        title: 'For Honor',
        spaceId: 'space-c',
        source: 'graphql'
      }
    ];

    const propagated = propagateKnownMetadataByTitle(items);
    expect(propagated[2]?.productId).toBeUndefined();
  });
});
