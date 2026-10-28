import { beforeEach, expect, it, vi } from 'vitest';
import { Host } from './client';
import { HostCallError, type Transport } from './transport';
const fake = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('../platform', () => ({ platform: () => ({ confirm: fake.confirm }) }));
vi.mock('../i18n', () => ({ tz: (text: string) => text }));
beforeEach(() => { vi.resetAllMocks(); });
it('retries a budget warning once with the same source and a request-scoped override', async () => {
  const request = vi.fn().mockRejectedValueOnce(new HostCallError('open', 'memory_budget', 'owned budget warning'))
    .mockResolvedValueOnce({ result: { session: 'owned' }, payload: new Uint8Array() });
  fake.confirm.mockResolvedValue(true);
  const host = new Host({ request } as unknown as Transport);
  await expect(host.open('E:/owned.dng', { grain_active: false })).resolves.toMatchObject({ session: 'owned' });
  expect(fake.confirm).toHaveBeenCalledOnce();
  expect(request.mock.calls[1]![1]).toEqual({ path: 'E:/owned.dng', params: { grain_active: false }, memory_override: true });
});
it('keeps refusal when the user declines the budget warning', async () => {
  const request = vi.fn().mockRejectedValue(new HostCallError('open', 'memory_budget', 'owned budget warning'));
  fake.confirm.mockResolvedValue(false);
  const host = new Host({ request } as unknown as Transport);
  await expect(host.open('E:/owned.dng', {})).rejects.toMatchObject({ code: 'memory_budget' });
  expect(request).toHaveBeenCalledOnce();
});
