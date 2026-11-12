import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import api from '../lib/api';
import { postMoney } from './transactions';

vi.mock('../lib/api', () => ({ default: { post: vi.fn() } }));
afterEach(() => vi.useRealTimers());
describe('Safe money request retry', () => {
  it('reuses the same key and payload after network timeouts', async () => {
    vi.useFakeTimers();
    vi.mocked(api.post)
      .mockRejectedValueOnce(new AxiosError('timeout', 'ECONNABORTED'))
      .mockResolvedValueOnce({ data: { id: 'one-transaction' } });
    const payload = { amount: '100', toAccountNumber: '9000000002' };
    const result = postMoney('/transactions/transfer', payload, 'stable-key');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ id: 'one-transaction' });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.post).mock.calls[0]).toEqual(
      vi.mocked(api.post).mock.calls[1],
    );
  });
  it('does not retry a business rejection', async () => {
    const failure = new AxiosError(
      'insufficient funds',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      { status: 400 } as never,
    );
    vi.mocked(api.post).mockRejectedValue(failure);
    await expect(
      postMoney('/transactions/withdraw', { amount: '100' }, 'key'),
    ).rejects.toBe(failure);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('bounds automatic retries to three attempts', async () => {
    vi.useFakeTimers();
    const failure = new AxiosError('network', 'ERR_NETWORK');
    vi.mocked(api.post).mockRejectedValue(failure);
    const rejected = expect(
      postMoney('/transactions/transfer', { amount: '100' }, 'key'),
    ).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await rejected;
    expect(api.post).toHaveBeenCalledTimes(3);
  });
});
