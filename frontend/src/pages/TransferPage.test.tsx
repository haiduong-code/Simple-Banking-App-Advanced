import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { getMyAccount } from '../api/accounts';
import { transferMoney } from '../api/transactions';
import { useAuthStore } from '../store/auth';
import type { TransferResult } from '../types/transactions';
import TransferPage from './TransferPage';
vi.mock('../api/accounts', () => ({ getMyAccount: vi.fn() }));
vi.mock('../api/transactions', () => ({ transferMoney: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(getMyAccount).mockResolvedValue({
    id: 'source',
    accountNumber: '9000000001',
    balance: '1000000.00',
    availableBalance: '900000.00',
    currency: 'VND',
    createdAt: new Date().toISOString(),
  });
  useAuthStore.setState({
    user: {
      id: 'owner',
      role: 'customer',
      email: 'owner@bank.test',
      fullName: 'Owner',
      status: 'active',
      createdAt: '',
    },
  });
});
function form() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <TransferPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function fill() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Xác nhận chuyển khoản',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByPlaceholderText('Nhập 10 chữ số'), {
    target: { value: '9000000002' },
  });
  fireEvent.change(screen.getByPlaceholderText('0'), {
    target: { value: '100' },
  });
}
describe('Transfer form submission safety', () => {
  it('submits once when a slow request receives five rapid submit events', async () => {
    let finish!: (result: TransferResult) => void;
    vi.mocked(transferMoney).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    form();
    await fill();
    const target = screen
      .getByRole('button', { name: 'Xác nhận chuyển khoản' })
      .closest('form')!;
    for (let i = 0; i < 5; i++) fireEvent.submit(target);
    await waitFor(() => expect(transferMoney).toHaveBeenCalledTimes(1));
    finish({
      id: 'tx',
      amount: '100.00',
      status: 'completed',
      toAccountNumber: '9000000002',
    } as TransferResult);
    await screen.findByText('Chuyển khoản thành công');
  });
  it('retains the idempotency key for manual retry after an uncertain network result', async () => {
    vi.mocked(transferMoney)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        id: 'tx',
        amount: '100.00',
        status: 'pending_otp',
      } as TransferResult);
    form();
    await fill();
    fireEvent.click(
      screen.getByRole('button', { name: 'Xác nhận chuyển khoản' }),
    );
    await screen.findByText('Không thể thực hiện chuyển khoản');
    fireEvent.click(
      screen.getByRole('button', { name: 'Xác nhận chuyển khoản' }),
    );
    await screen.findByText('Giao dịch đang chờ xác nhận');
    expect(vi.mocked(transferMoney).mock.calls[0][1]).toBe(
      vi.mocked(transferMoney).mock.calls[1][1],
    );
  });
  it('uses available funds after holds during client validation', async () => {
    form();
    await fill();
    fireEvent.change(screen.getByPlaceholderText('0'), {
      target: { value: '950000' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Xác nhận chuyển khoản' }),
    );
    await screen.findByText('Số dư khả dụng không đủ');
    expect(transferMoney).not.toHaveBeenCalled();
  });
});
