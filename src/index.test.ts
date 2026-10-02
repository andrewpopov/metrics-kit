import { describe, expect, it } from 'vitest';
import { httpMetrics } from './express/index';

describe('scaffold', () => {
  it('exports the express entry point', () => {
    expect(typeof httpMetrics).toBe('function');
  });
});
