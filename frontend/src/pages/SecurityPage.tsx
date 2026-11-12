import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '../lib/api';
import BankingLayout from '../components/BankingLayout';
import { useAuthStore } from '../store/auth';
export default function SecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      useAuthStore.getState().logout();
      queryClient.clear();
      navigate('/login');
    },
  });
  return (
    <BankingLayout
      title="Bảo mật"
      subtitle="Đổi mật khẩu sẽ đăng xuất tất cả các phiên đang hoạt động."
    >
      <form
        className="max-w-lg space-y-4 rounded-xl bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mutation.isPending) mutation.mutate();
        }}
      >
        <label className="block">
          Mật khẩu hiện tại
          <input
            className="mt-2 w-full rounded-lg border p-3"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="block">
          Mật khẩu mới
          <input
            className="mt-2 w-full rounded-lg border p-3"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <button
          disabled={mutation.isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        >
          Đổi mật khẩu
        </button>
        {mutation.isError && (
          <p role="alert" className="text-red-600">
            {getErrorMessage(mutation.error)}
          </p>
        )}
      </form>
    </BankingLayout>
  );
}
