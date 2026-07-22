import { describe, it, expect } from 'vitest';
import { REGION } from '@sabeel/shared';
import { pingPayload } from '../../src';

describe('pingPayload', () => {
  it('reports the region the function is deployed to', () => {
    // Also proves the private @sabeel/shared workspace import resolves from
    // functions/ — the thing esbuild has to inline for Cloud Build to succeed.
    expect(pingPayload()).toEqual({ ok: true, region: REGION });
  });
});
