# Simple-Banking-App-Advanced

Ứng dụng ngân hàng nội bộ: NestJS + PostgreSQL, frontend React/TypeScript/Vite.

Đã bổ sung các module concurrency, idempotency, ledger/audit, phân quyền, OTP, quản lý phiên đăng nhập, hạn mức, đối soát và kiểm thử. Xem [báo cáo và hướng dẫn demo](docs/Bai_tap_bo_sung_ket_qua.md).

## Chạy ứng dụng

```powershell
docker compose up -d
cd backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run seed
npm run start:dev
```

Mở terminal khác:

```powershell
cd frontend
npm ci
npm run dev
```

Frontend: `http://localhost:5173`; Swagger: `http://localhost:3000/api`; health: `http://localhost:3000/health`.

Seed có `admin@bank.test`, `teller@bank.test`, `an@bank.test`, `binh@bank.test`, `chi@bank.test`; mật khẩu demo chung `Test@123`. Seed ghi `opening_balance` vào ledger và giữ nguyên số dư đã phát sinh khi chạy lại.

OTP demo được gửi vào file cục bộ `backend/.local/otp-outbox/<transactionId>.json`; xem báo cáo để chạy luồng OTP và duyệt giao dịch lớn. Chưa tích hợp SMS/email.

## Kiểm thử

```powershell
docker compose -f docker-compose.test.yml up -d --wait
cd backend
npm run lint
npm run test:cov -- --runInBand
npm run test:e2e -- --runInBand --silent
npm run test:concurrency
```

```powershell
cd frontend
npm run lint
npm test
npm run build
```

Integration test chỉ dùng database riêng `banking_test` tại cổng `55432`, tách khỏi database ứng dụng ở cổng `5432`. Có workflow CI trong `.github/workflows/ci.yml`.
