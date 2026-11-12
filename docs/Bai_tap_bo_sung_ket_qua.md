# Kết quả bài tập bổ sung Simple Banking App

Ngày kiểm tra: 12/11/2026. Giữ frontend React/Vite sẵn có của repository; các yêu cầu UI trong đề được triển khai trên frontend này.

Kết quả chạy cuối: **78 unit tests backend, 24 integration tests PostgreSQL và 6 frontend tests đều đạt**. Backend/frontend build thành công; ESLint backend không có error/warning, frontend lint đạt. Coverage lines: accounts 97,14%; transactions 96,15%; banking operations 99,45%; ledger 98,96%; transaction policy 100%.

## Đối chiếu các module

| Bài | Phần triển khai | Kiểm chứng |
| --- | --- | --- |
| 1.1 | `backend/scripts/concurrency-demo.cjs`: tái hiện read–calculate–write không atomic bằng 20 tác vụ cùng đọc số dư trước khi ghi | SQL PostgreSQL thật; kết quả và giải thích bên dưới |
| 1.2 | Transaction `READ COMMITTED`, khóa tài khoản bằng `pessimistic_write`, timeout khóa 5 giây và statement 15 giây | API thật: 20 yêu cầu rút tiền, 10 thành công, 10 bị từ chối, số dư 0 |
| 1.3 | `accounts.version`, cập nhật `WHERE id AND version`, tăng version, rollback/retry toàn bộ khi xung đột | Cùng kịch bản API với cấu hình optimistic; SQL benchmark so sánh throughput/latency |
| 1.4 | Khóa hoặc cập nhật tài khoản theo thứ tự ID; retry deadlock/serialization failure với tối đa 20 lần và backoff | 8 cặp chuyển khoản hai chiều, bảo toàn số dư; log `transaction.retry` và `transaction.retry.success` |
| 2.1 | Bảng `idempotency_keys`: key, actor, request hash, response JSON, mã HTTP, status và expiry; advisory lock theo key | 5 request đồng thời cùng key trả body giống nhau, chỉ một giao dịch; đổi payload/actor trả 409 |
| 2.2 | Key sinh khi mở form, khóa submit bằng ref ngay khi bấm, nút loading, timeout 10 giây; tự thử lại tối đa 3 lần với cùng key/payload | 6 frontend tests, gồm 5 lần submit liên tiếp, timeout và manual retry |
| 3.1 | `LedgerService`: transfer và reversal ghi một DEBIT/một CREDIT, cập nhật balance cache trong cùng DB transaction | Ledger unit tests; integration kiểm tra 2 entries, tổng khớp, chặn sửa/xóa bằng subscriber và DB trigger |
| 3.2 | Reversal là giao dịch mới tham chiếu giao dịch gốc; chỉ trạng thái gốc chuyển REVERSED | Admin hoàn tiền thành công, lần thứ hai bị 409; unique index trên original transaction |
| 3.3 | Audit log thủ công cho hành động nghiệp vụ; subscriber tự ghi thay đổi Account/User với before/after, actor, IP, user-agent và requestId | Freeze account có audit tự động trong cùng transaction; API audit chỉ dành cho ADMIN; lọc theo requestId |
| 3.4 | Soft delete User/Account, lịch sử hồ sơ và account settings | Query mặc định loại tài khoản đã xóa; email/phone cũ nằm trong user_history và account_history |
| 4.1 | CUSTOMER/TELLER/ADMIN; Guards + `@Roles`; kiểm tra quyền sở hữu ở service | CUSTOMER đọc/thao tác tài khoản khác trả 403; TELLER tạo hộ; chỉ ADMIN duyệt/hoàn tiền/xem audit |
| 4.2 | Access JWT 15 phút, refresh token ngẫu nhiên 7 ngày, chỉ lưu SHA-256 trong DB; rotation; tokenVersion | Logout, đổi mật khẩu, khóa user hoặc phát hiện refresh replay thu hồi phiên; access token cũ cũng bị từ chối |
| 4.3 | OTP 6 số, HMAC trong DB, hết hạn 5 phút, tối đa 5 lần sai; áp dụng từ đúng 10 triệu đồng | Chủ tài khoản xác nhận OTP, sau đó ADMIN duyệt; sai đủ 5 lần hoặc hết hạn chuyển FAILED |
| 4.4 | Nest throttler theo IP và user; 5 lần đăng nhập sai trong cửa sổ 1 phút khóa tạm 1 phút, dữ liệu lưu DB | HTTP 429 khi spam, kiểm tra khóa và reset cửa sổ đăng nhập |
| 5.1 | Hạn mức thường: 20 triệu/lần, 50 triệu/ngày; VIP: 100 triệu/lần, 200 triệu/ngày | Boundary unit tests; pending cũng giữ chỗ hạn mức; kiểm tra giao dịch chờ từ hôm trước được duyệt hôm nay |
| 5.2 | ACTIVE/FROZEN/CLOSED, đồng tiền, `balance - holdAmount`, tiền tính bằng bigint/decimal | Chặn tài khoản khóa, giữ tiền và khác currency; lưu FAILED cho lỗi nghiệp vụ và giữ nguyên số dư |
| 5.3 | State machine; cron tìm giao dịch INITIATED/PROCESSING/PENDING quá 5 phút và OTP hết hạn | Từ chối cạnh không hợp lệ; stale transaction không có ledger chuyển FAILED |
| 6.1 | Cron 23:59 giờ Việt Nam và API đối soát thủ công; bảng reconciliation_reports | SQL cùng snapshot so sánh cache/ledger, gồm account đã soft-delete; phát hiện tài khoản cố ý sửa balance |
| 6.2 | Flag từ giao dịch thứ 6/phút hoặc số tiền lớn hơn 5 lần trung bình 30 ngày; ADMIN review | Giao dịch vẫn hoàn thành khi gắn cờ; approve/reject review có audit, không tự thay đổi số dư |
| 6.3 | JSON request log + AsyncLocalStorage requestId; `/health` thực sự truy vấn PostgreSQL | Đã tắt/bật container PostgreSQL riêng: health lần lượt 200 → 503 → 200 |
| 7.1 | Jest với repository/service mocks, kiểm tra tiền và các nhánh lỗi; coverage threshold cho các service cốt lõi | Các service account, transaction, policy và ledger đạt trên 96% lines; threshold tối thiểu 80% trong package.json |
| 7.2 | Integration test Supertest + Promise.all trên PostgreSQL riêng; workflow GitHub Actions | Hai chế độ khóa, gửi trùng, chuyển hai chiều và hạn mức |
| 7.3 | Inject lỗi khi đã ghi DEBIT nhưng chưa ghi CREDIT | Không có debit mồ côi, không đổi balance hai bên, không lưu transaction dở dang |

## Cách hoạt động

`BankingOperationsService` xử lý tạo giao dịch, idempotency, OTP, duyệt và kiểm tra nghiệp vụ. `TransactionsService` cung cấp lịch sử và hoàn tiền. `LedgerService` ghi sổ và cache số dư. Toàn bộ thay đổi tiền, ledger, trạng thái và kết quả idempotency cùng commit hoặc rollback.

Luồng bình thường: `INITIATED → PROCESSING → COMPLETED`. Từ đúng 10.000.000đ: `INITIATED → PENDING_OTP → PENDING_APPROVAL → PROCESSING → COMPLETED`. Lỗi nghiệp vụ hoặc admin từ chối chuyển FAILED. Chỉ COMPLETED được hoàn tiền sang REVERSED. Trạng thái PENDING cũ vẫn được hỗ trợ cho dữ liệu trước khi bổ sung bài tập.

Lỗi như thiếu số dư được lưu FAILED, cùng response lỗi để replay idempotent. Lỗi hạ tầng bất ngờ rollback toàn bộ lần xử lý; client có thể gửi lại cùng key. Các field tài chính gốc của giao dịch và ledger không được sửa để khắc phục lỗi: hoàn tiền dùng giao dịch đối ứng mới.

Hạn mức ngày dùng giờ Việt Nam. Giao dịch đã hoàn tất tính theo `completedAt`; giao dịch đang chờ tính theo ngày khởi tạo để giữ chỗ. Khi admin duyệt, hệ thống kiểm tra lại trạng thái, currency, tiền đang giữ, số dư và hạn mức ngày hiện tại. Hoàn tiền không tự khôi phục hạn mức đã dùng.

Key idempotency có mốc expiry 24 giờ để phục vụ lưu trữ, nhưng hiện giữ response lâu dài; key đã dùng không được tái sử dụng để tạo một lần chuyển tiền khác. Replay trả đúng snapshot response lúc tạo; xem trạng thái mới nhất bằng `GET /transactions/:id`.

Nếu crash trong transaction, PostgreSQL tự rollback, nên không có tiền cần hoàn bù. Cron đánh dấu FAILED cho bản ghi cũ chưa ghi sổ. Nếu gặp dữ liệu bất thường có ledger đã commit nhưng còn PROCESSING, hệ thống gắn cờ review và log ERROR để tránh tự cộng tiền lần hai.

## Tái hiện race condition và so sánh khóa

Chạy `npm run test:concurrency` trong backend với DB kiểm thử riêng. Script tạo bảng tạm theo PID trong database `_test`, chạy xong xóa đúng bảng đó. Nó không thay đổi bảng tài khoản ứng dụng.

Một lần chạy trên máy này:

| Chế độ | Request thành công / từ chối | Số dư cuối | Latency trung bình | Request/giây |
| --- | --- | --- | --- | --- |
| Không khóa | 20 / 0 | 900.000đ | 57,11 ms | 287,05 |
| Pessimistic | 10 / 10 | 0đ | 35,40 ms | 386,36 |
| Optimistic | 10 / 10 | 0đ | 77,47 ms | 171,15 |

Bản không khóa cho cả 20 tác vụ đọc số dư 1 triệu trước khi ghi; mỗi tác vụ đều ghi lại 900.000đ. Hệ thống báo đã rút 2 triệu nhưng balance chỉ giảm 100.000đ: lost update. Với quy tắc không thấu chi, kết quả đúng là 10 lần thành công, 10 lần thiếu tiền và balance bằng 0; không dùng -1 triệu làm kết quả mong đợi của bản đã sửa.

Đây là microbenchmark SQL 20 tác vụ trên cùng một tài khoản, không phải kết quả tải production. Chi phí mở pool và số lần retry ảnh hưởng số đo. Pessimistic hợp với tài khoản có tranh chấp cao; optimistic phù hợp hơn khi xung đột ít. Có thể đổi `BANKING_LOCK_MODE=pessimistic` hoặc `optimistic` trong backend/.env rồi khởi động lại backend.

## Chạy và demo

Xem README ở thư mục gốc để khởi động PostgreSQL, backend, frontend và seed. `.env` hiện có được giữ nguyên; nếu cấu hình DB khác mẫu, sử dụng cấu hình hiện tại của bạn. App mặc định dùng cổng DB 5432, backend 3000, frontend 5173.

Các màn hình:

- `/transfer`: chuyển khoản; TELLER/ADMIN có thể nhập tài khoản nguồn của khách hàng.
- `/cash`: CUSTOMER rút tiền; TELLER/ADMIN được nạp tiền và thao tác hộ khách hàng.
- `/transactions`: lịch sử, có link chi tiết từng giao dịch và xác nhận OTP.
- `/security`: đổi mật khẩu và đăng xuất toàn bộ phiên.
- `/admin/module-3`: user/account, giao dịch, audit và history đã có trước đó.
- `/admin/operations`: duyệt/từ chối giao dịch lớn, review cảnh báo, chạy/xem đối soát, đổi trạng thái/hạng tài khoản.

Demo giao dịch lớn với seed mới:

1. Đăng nhập `an@bank.test`, chuyển 10.000.000đ tới `9000000002`.
2. Mở link chi tiết giao dịch. Ở terminal backend đọc `.local/otp-outbox/<transactionId>.json` để lấy OTP demo.
3. Xác nhận OTP bằng tài khoản An. Balance chưa đổi khi đang chờ duyệt.
4. Đăng nhập `admin@bank.test` trên trình duyệt/phiên khác, mở **Duyệt & đối soát**, bấm Duyệt.
5. Xem số dư, lịch sử, 2 ledger entries và chạy đối soát. Admin có thể hoàn tiền từ trang quản trị; lần hoàn thứ hai bị từ chối.

Mật khẩu các tài khoản seed: `Test@123`. OTP dùng mailbox file cục bộ để demo, không trả trong response và không ghi vào application log. Chưa cấu hình SMS/email thật. Nạp/rút tiền mặt và opening balance có một bút toán tài khoản khách hàng; chuyển khoản và hoàn tiền có đủ hai bút toán đối ứng.

## Kiểm thử và môi trường

Backend unit tests chạy không cần DB. `npm run test:cov -- --runInBand` kiểm tra threshold cho account, transaction, banking operations và ledger; coverage toàn bộ repository còn bao gồm auth, controllers, seed và wiring nên thấp hơn coverage của các service này. Frontend dùng Vitest/Testing Library và jsdom.

```powershell
docker compose -f docker-compose.test.yml up -d --wait
cd backend
npm ci
npm run lint
npm run build
npm run test:cov -- --runInBand
npm run test:e2e -- --runInBand --silent
npm run test:concurrency
```

```powershell
cd frontend
npm ci
npm run lint
npm test
npm run build
```

E2E mặc định dùng `banking_test` tại `127.0.0.1:55432`, user/password `banking_test`. Có thể đổi bằng `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USER`, `E2E_DB_PASSWORD`, `E2E_DB_NAME`. Suite từ chối tên DB không kết thúc `_test`, và sẽ TRUNCATE dữ liệu trong DB kiểm thử. OTP integration test nằm trong thư mục temp của hệ điều hành, không chung mailbox demo.

Workflow `.github/workflows/ci.yml` dựng PostgreSQL riêng và chạy build, unit coverage, integration, concurrency demo cùng các kiểm tra frontend. Đã kiểm tra chạy cục bộ; workflow sẽ chạy trên GitHub khi push.

Thiết lập hiện tại phục vụ bài tập/dev: schema sync bật mặc định, rate-limit cache trong một process, OTP dùng mailbox cục bộ. Nếu triển khai nhiều instance cần cấu hình shared throttler storage và vận hành migration/schema riêng khi tắt `DB_SYNCHRONIZE`.

Tham khảo API thư viện khi triển khai: [NestJS throttler](https://docs.nestjs.com/security/rate-limiting), [NestJS cron/timezone](https://docs.nestjs.com/techniques/task-scheduling), [TypeORM subscriber](https://typeorm.io/docs/advanced-topics/listeners-and-subscribers/).
