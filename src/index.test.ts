import { describe, expect, it } from 'vitest';
import { METRICS_KIT_EXPRESS_PLACEHOLDER } from './express/index';

describe('scaffold', () => {
  it('exports the express entry point', () => {
    expect(METRICS_KIT_EXPRESS_PLACEHOLDER).toBe(true);
  });
});
