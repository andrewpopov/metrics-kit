import { describe, expect, it } from 'vitest';
import { METRICS_KIT_PLACEHOLDER } from './index';
import { METRICS_KIT_EXPRESS_PLACEHOLDER } from './express/index';

describe('scaffold', () => {
  it('exports both entry points', () => {
    expect(METRICS_KIT_PLACEHOLDER).toBe(true);
    expect(METRICS_KIT_EXPRESS_PLACEHOLDER).toBe(true);
  });
});
