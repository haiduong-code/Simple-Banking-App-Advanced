## 1. Các use case đã xử lý

### Use case 1: Chuyển khoản ghi sổ kép

Người dùng chuyển tiền từ tài khoản A sang tài khoản B.

Kết quả cần đạt:

- Giao dịch được tạo trong bảng `transactions`.
- Tạo 2 bút toán trong `ledger_entries`:
  - `DEBIT` tài khoản gửi.
  - `CREDIT` tài khoản nhận.
- `accounts.balance` vẫn được cập nhật như cached balance để UI đọc nhanh.
- Ledger là nguồn dữ liệu dùng để đối soát.

#### Cách hệ thống xử lý

1. Hai tài khoản được khóa bằng `pessimistic_write` theo cùng thứ tự ID để chống race condition và giảm nguy cơ deadlock.
2. Giao dịch được tạo với trạng thái `pending`. Hệ thống kiểm tra số dư nguồn, giới hạn số dư đích và tính số dư sau giao dịch bằng minor units/`bigint`.
3. `LedgerService.recordTransfer()` cập nhật cached balance và ghi hai bút toán cùng số tiền:
   - `DEBIT` cho tài khoản nguồn;
   - `CREDIT` cho tài khoản đích.
4. `TransactionStateService` chuyển trạng thái `pending -> completed`; audit log được ghi trong cùng transaction nếu luồng có yêu cầu audit.
5. Nếu bất kỳ bước nào lỗi, PostgreSQL rollback toàn bộ: không đổi balance, không có ledger dở dang và transaction không hoàn tất.
6. Backend trả transaction đã hoàn tất; React Query làm mới số dư và lịch sử giao dịch.

File cần show:

- `backend/src/ledger/entities/ledger-entry.entity.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/transactions/entities/transaction.entity.ts`
- `frontend/src/pages/TransferPage.tsx`
- `frontend/src/pages/TransactionHistoryPage.tsx`

> Trước Module 3, transfer chủ yếu update trực tiếp balance. Sau khi refactor, mỗi transfer được xử lý trong một DB transaction: tạo transaction pending, ghi ledger debit/credit, cập nhật cached balance, rồi chuyển status sang completed. Nếu có lỗi giữa chừng thì rollback toàn bộ.

### Use case 2: Seed/backfill ledger cho số dư ban đầu

Khi seed dữ liệu mẫu, tài khoản có balance ban đầu cần có ledger để không bị lệch đối soát.

Kết quả cần đạt:

- Account seed có balance > 0 sẽ có transaction `opening_balance`.
- Tạo ledger `CREDIT` tương ứng cho account đó.
- Chạy seed nhiều lần không tạo trùng opening ledger.

#### Cách hệ thống xử lý

1. File seed tạo hoặc tìm user và account mẫu theo dữ liệu cố định để có thể chạy lặp lại.
2. Với account có số dư ban đầu lớn hơn 0, seed kiểm tra `LedgerService.hasEntriesForAccount()` hoặc kiểm tra opening entry tương ứng.
3. Nếu ledger đã tồn tại, seed bỏ qua để tránh cộng số dư khởi tạo lần thứ hai.
4. Nếu chưa có, seed mở transaction, tạo transaction loại `opening_balance` với trạng thái hoàn tất và số tiền bằng balance ban đầu.
5. Hệ thống ghi một ledger entry `CREDIT` cho account; `balanceAfter` bằng đúng số dư khởi tạo.
6. Transaction, ledger entry và cached balance phải khớp nhau trước khi commit.
7. Nếu tạo transaction hoặc ledger lỗi, toàn bộ phần backfill của account đó bị rollback, tránh trạng thái có balance nhưng không có ledger tương ứng.

File cần show:

- `backend/src/database/seed.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/entities/transaction.entity.ts`

Demo trên máy:

1. Chạy:

```powershell
cd backend
npm run seed
```

2. Mở DB kiểm tra:
   - `transactions.type = opening_balance`;
   - `ledger_entries.type = credit`;
   - `ledger_entries.balance_after` khớp `accounts.balance`.

Cách nói high level:

> Vì dữ liệu seed đặt số dư ban đầu, hệ thống cần backfill ledger bằng opening balance. Đây là giao dịch khởi tạo demo, giúp balance cache và ledger không lệch ngay từ đầu.

---

### Use case 3: Chặn sửa/xóa ledger ở tầng application

Ledger phải append-only, không được sửa/xóa bút toán đã ghi.

Kết quả cần đạt:

- Không có controller update/delete ledger.
- `LedgerService` chỉ expose method đọc và ghi append-only.
- Có test kiểm tra service không có method update/delete/remove.

#### Cách hệ thống xử lý

1. `LedgerService` giữ `Repository<LedgerEntry>` ở phạm vi `private`, không trả repository trực tiếp cho controller hoặc service khác.
2. Public API chỉ cho phép đọc hoặc append: tính balance, kiểm tra entry tồn tại, tạo entry, ghi transfer và ghi reversal.
3. Module không cung cấp controller hoặc endpoint `PUT`, `PATCH`, `DELETE` cho ledger.
4. Khi cần sửa sai, hệ thống không update dòng cũ mà tạo giao dịch mới và bút toán đảo chiều bằng `recordReversal()`.
5. Các thao tác ghi ledger bắt buộc nhận `EntityManager`, bảo đảm entry được ghi cùng transaction nghiệp vụ.
6. Test kiểm tra service không expose các method như `update`, `delete`, `remove`, `softDelete` và kiểm tra mỗi transfer/reversal tạo đủ cặp debit-credit.
7. Có thể tăng bảo vệ ở database bằng quyền chỉ `SELECT/INSERT` cho bảng ledger và unique constraint cho tổ hợp account/transaction/type.

File cần show:

- `backend/src/ledger/ledger.service.ts`
- `backend/src/ledger/ledger.module.ts`
- `backend/src/ledger/ledger.service.spec.ts`

Demo trên máy:

1. Mở `LedgerService`, chỉ ra các method public:
   - `getAccountLedgerBalance`
   - `createEntry`
   - `recordTransfer`
   - `recordReversal`
2. Mở test append-only.
3. Chạy:

```powershell
cd backend
npm test -- --runInBand
```

Cách nói high level:

> Với ledger, nguyên tắc là không sửa lịch sử dòng tiền. Code không tạo API update/delete ledger, repository không export bừa bãi, service chỉ cho ghi thêm bút toán mới.

---

### Use case 4: Transaction State Machine

Transaction không được đổi status tùy tiện.

Kết quả cần đạt:

- Status chuẩn:
  - `pending`
  - `completed`
  - `failed`
  - `reversed`
- Chỉ cho phép transition hợp lệ:
  - `pending -> completed`
  - `pending -> failed`
  - `completed -> reversed`
- Không cho `failed -> completed`, `reversed -> completed`, hoặc complete nhiều lần.

#### Cách hệ thống xử lý

1. Transaction mới bắt đầu ở trạng thái `pending`.
2. Mọi thay đổi status phải đi qua `TransactionStateService.transition()`, không set trực tiếp rải rác trong các service.
3. Service kiểm tra bảng `ALLOWED_TRANSITIONS`:
   - `pending -> completed` khi nghiệp vụ thành công;
   - `pending -> failed` khi kết thúc thất bại theo luồng có lưu trạng thái;
   - `completed -> reversed` sau khi reversal hoàn tất.
4. Nếu transition không nằm trong bảng, hệ thống trả `409 Conflict` và không lưu thay đổi.
5. Khi chuyển sang `completed`, service ghi `completedAt`; khi chuyển sang `reversed`, ghi `reversedAt`.
6. Việc đổi trạng thái dùng repository lấy từ `EntityManager`, vì vậy status rollback cùng balance, ledger và audit nếu nghiệp vụ lỗi.
7. Trạng thái `failed` và `reversed` là trạng thái cuối; muốn thử lại phải tạo transaction mới thay vì sửa lịch sử cũ.

File cần show:

- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/transactions/transaction-state.service.ts`
- `backend/src/transactions/transaction-state.service.spec.ts`
- `backend/src/transactions/transactions.service.ts`
- `frontend/src/types/transactions.ts`

Demo trên máy:

1. Mở transaction entity để show enum status.
2. Mở `TransactionStateService` để show rule transition.
3. Chạy test state machine:

```powershell
cd backend
npm test -- --runInBand transaction-state
```

Cách nói high level:

> Thay vì set status trực tiếp nhiều nơi, em tách state machine service. Service này kiểm soát transaction được chuyển trạng thái nào, tránh trạng thái sai nghiệp vụ như reversed quay lại completed.

---

### Use case 5: Reversal / hoàn tiền

Khi cần hoàn tiền, hệ thống không xóa/sửa giao dịch gốc.

Kết quả cần đạt:

- Tạo transaction mới type `reversal`.
- Ghi ledger đảo ngược:
  - debit tài khoản đã nhận tiền ban đầu;
  - credit tài khoản gửi tiền ban đầu.
- Transaction gốc chuyển status sang `reversed`.
- Không cho reversal hai lần cho cùng giao dịch gốc.

#### Cách hệ thống xử lý

1. Client gọi `POST /transactions/:id/reverse`, gửi lý do hoàn tiền; backend lấy người thao tác từ JWT và validate UUID cùng DTO.
2. Service mở DB transaction và khóa transaction gốc bằng `pessimistic_write` để ngăn hai request hoàn cùng một giao dịch.
3. Hệ thống kiểm tra transaction gốc tồn tại, là giao dịch được phép hoàn, đang `completed`, chưa có reversal và có đủ thông tin tài khoản nguồn/đích.
4. Hai account của giao dịch gốc được khóa theo thứ tự ID. Tài khoản nhận ban đầu phải còn đủ tiền để trả lại.
5. Service tạo một transaction mới loại `reversal`, trạng thái `pending`, chiều tiền đảo ngược và liên kết bằng `originalTransactionId`.
6. `LedgerService.recordReversal()`:
   - trừ tiền tài khoản nhận ban đầu và ghi `DEBIT`;
   - cộng lại tiền cho tài khoản gửi ban đầu và ghi `CREDIT`;
   - cập nhật cached balance;
   - kiểm tra debit và credit bằng nhau.
7. State machine chuyển reversal `pending -> completed`, rồi chuyển transaction gốc `completed -> reversed`.
8. Audit log ghi người thực hiện, lý do, transaction gốc, transaction reversal và dữ liệu trước/sau trong cùng DB transaction.
9. Nếu tài khoản nhận ban đầu không đủ tiền, đã reversal trước đó hoặc có lỗi ghi ledger, toàn bộ thao tác rollback.
10. API trả cả transaction gốc đã `reversed` và transaction reversal mới `completed`; frontend làm mới lịch sử.

File cần show:

- `backend/src/transactions/dto/reverse-transaction.dto.ts`
- `backend/src/transactions/transactions.controller.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `frontend/src/pages/TransactionHistoryPage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/transactions.ts`

Demo trên máy:

1. Login user hoặc admin.
2. Vào **Lịch sử giao dịch**.
3. Chọn transaction `completed`, bấm **Hoàn tiền/Reversal**.
4. Nhập lý do hoàn tiền.
5. Kiểm tra UI:
   - transaction gốc thành `reversed`;
   - có transaction mới type `reversal`.
6. Kiểm tra DB:
   - bảng `transactions`;
   - bảng `ledger_entries`;
   - bảng `audit_logs`.

Cách nói high level:

> Reversal được thiết kế theo hướng bất biến dữ liệu. Giao dịch gốc vẫn giữ nguyên amount/from/to, chỉ đổi status sang reversed. Tiền được trả lại bằng một transaction mới và một cặp ledger debit/credit đảo chiều.

---

### Use case 6: Audit Log

Các thao tác nhạy cảm phải ghi lại ai làm, làm gì, trước/sau như thế nào.

Kết quả cần đạt:

- Ghi log cho:
  - login thành công/thất bại;
  - register;
  - transfer completed;
  - reversal completed;
  - mark original transaction reversed;
  - soft delete user/account;
  - update user profile/status.
- Audit log có:
  - actor;
  - action;
  - entity/entityId;
  - beforeData/afterData;
  - IP/user-agent;
  - createdAt.
- Admin mới xem được audit logs.
- Không log password, token, secret.

#### Cách hệ thống xử lý

1. Tại các điểm nghiệp vụ nhạy cảm, service xác định `action`, `actorId`, loại entity, entity ID, dữ liệu trước/sau và request context.
2. IP và user-agent được lấy từ request context; hành động hệ thống có thể để `actorId = null`.
3. Với thao tác độc lập như login, service gọi `AuditService.log()`; với transfer, reversal, update hoặc soft delete cần tính nguyên tử, service gọi `logInTransaction(..., manager)`.
4. `AuditService` chọn repository từ `EntityManager` nếu có, để audit log commit/rollback cùng nghiệp vụ chính.
5. Trước khi lưu, `sanitizeData()` loại các key nhạy cảm như password, passwordHash, token, JWT, secret và OTP khỏi `beforeData/afterData`.
6. Audit log được append vào bảng `audit_logs`; không có luồng cập nhật hoặc xóa log qua API thông thường.
7. Endpoint tra cứu nhận `AuditLogQueryDto`, dựng điều kiện theo actor/action/entity/entityId, sắp xếp mới nhất trước và phân trang.
8. Controller tra cứu được bảo vệ bằng JWT và role admin; frontend admin gửi bộ lọc rồi hiển thị before/after.
9. Nếu nghiệp vụ chính rollback, log được ghi bằng `logInTransaction` cũng rollback, tránh ghi nhận một hành động “thành công” khi dữ liệu thật không đổi.

File cần show:

- `backend/src/audit/entities/audit-log.entity.ts`
- `backend/src/audit/audit.service.ts`
- `backend/src/audit/audit.controller.ts`
- `backend/src/audit/audit-request-context.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/audit.ts`

Demo trên máy:

1. Login admin.
2. Vào **Admin Module 3**.
3. Mở tab **Audit Log**.
4. Thực hiện một thao tác như reversal hoặc khóa user.
5. Quay lại audit log, filter theo:
   - `entity = Transaction`
   - hoặc `action = transaction.reversal.completed`
6. Show before/after data.

Cách nói high level:

> Audit log được ghi ở service ngay trong luồng nghiệp vụ. Những thao tác cần atomic thì dùng `logInTransaction` để audit log rollback cùng nghiệp vụ nếu có lỗi.

---

### Use case 7: Soft Delete User/Account

Xóa user/account nhưng không mất dữ liệu lịch sử.

Kết quả cần đạt:

- User/account có `deleted_at`.
- Không dùng hard delete.
- Query mặc định không lấy bản ghi đã xóa.
- Admin có thể xem cả bản ghi đã xóa khi bật include deleted.
- Soft delete ghi audit log và history.

#### Cách hệ thống xử lý

1. Admin gửi yêu cầu xóa; backend xác thực JWT và role trước khi vào service.
2. Service tìm user/account đang hoạt động, lấy snapshot dữ liệu trước khi thay đổi và kiểm tra các ràng buộc nghiệp vụ.
3. Thay vì `DELETE`, TypeORM soft delete đặt `deletedAt`/`deleted_at` bằng thời điểm hiện tại.
4. Với user có account liên quan, service xử lý theo chính sách dự án: soft delete đồng bộ, khóa account hoặc từ chối nếu còn điều kiện chưa thỏa.
5. Service ghi history với `beforeData` và `afterData`, đồng thời ghi audit log gồm actor và hành động soft delete.
6. Tất cả thay đổi liên quan được thực hiện trong một DB transaction để tránh user đã xóa nhưng history/audit chưa được ghi.
7. Query thông thường không dùng `withDeleted`, nên bản ghi đã xóa không xuất hiện trong luồng active.
8. API admin có tùy chọn include deleted để truy vấn bằng `withDeleted` và hiển thị `deletedAt`.
9. Dữ liệu transaction, ledger, audit và history vẫn tham chiếu được vì bản ghi không bị xóa vật lý.

File cần show:

- `backend/src/users/entities/user.entity.ts`
- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/users/users.service.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/admin/admin.controller.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/admin.ts`

Demo trên máy:

1. Login admin.
2. Vào **Admin Module 3** tab **User & Account**.
3. Chọn một account hoặc user, bấm xóa.
4. Bật **Kể cả đã xóa** để thấy bản ghi vẫn còn nhưng có `deletedAt`.
5. Kiểm tra DB:
   - `users.deleted_at`;
   - `accounts.deleted_at`;
   - `audit_logs`;
   - `user_history`;
   - `account_history`.

Cách nói high level:

> Vì transaction, ledger và audit cần giữ lịch sử, em không hard delete user/account. Khi xóa thì chỉ set `deletedAt`, các luồng active sẽ không lấy bản ghi đó nữa.

---

### Use case 8: Versioning / History

Thay đổi thông tin nhạy cảm cần lưu phiên bản trước/sau.

Kết quả cần đạt:

- Có bảng `user_history` cho email/fullName/status/deletedAt.
- Có bảng `account_history` cho accountNumber/balance/currency/deletedAt.
- Update profile/status/soft delete đều ghi `beforeData` và `afterData`.
- Không lưu password hash trong history.
- Có API xem history.

#### Cách hệ thống xử lý

1. Khi update profile, status, account hoặc soft delete, service đọc bản ghi hiện tại và tạo snapshot `beforeData` chỉ gồm các field được phép lưu lịch sử.
2. Backend validate DTO, kiểm tra quyền và các ràng buộc như email/account number không trùng.
3. Service cập nhật entity chính rồi tạo snapshot `afterData`.
4. Một dòng mới được append vào `user_history` hoặc `account_history`, gắn entity ID, action/change type, actor và thời gian.
5. Password hash, token và các dữ liệu bí mật không được đưa vào history.
6. Update entity, history và audit log chạy trong cùng transaction; nếu ghi history thất bại thì cập nhật chính cũng rollback.
7. API history truy vấn theo entity ID, sắp xếp `createdAt DESC` và có thể phân trang.
8. Frontend hiển thị từng phiên bản before/after để người dùng hoặc admin theo dõi quá trình thay đổi mà không sửa bản ghi lịch sử cũ.

File cần show:

- `backend/src/users/entities/user-history.entity.ts`
- `backend/src/accounts/entities/account-history.entity.ts`
- `backend/src/users/users.controller.ts`
- `backend/src/users/users.service.ts`
- `backend/src/accounts/accounts.controller.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/users.ts`
- `frontend/src/api/accounts.ts`

Demo trên máy:

1. Login user.
2. Vào **Hồ sơ**.
3. Đổi fullName hoặc email.
4. Xem phần **History hồ sơ** để thấy before/after.
5. Login admin.
6. Vào **Admin Module 3** tab **Account History**.
7. Nhập accountId đã soft delete hoặc account có history để xem before/after.

Cách nói high level:

> History khác audit log ở chỗ nó bám vào từng entity để xem các phiên bản dữ liệu của entity đó. Audit trả lời câu hỏi ai làm gì, còn history trả lời dữ liệu này đã thay đổi như thế nào.

---

### Use case 9: Frontend demo cho toàn bộ Module 3

Frontend được bổ sung để mentor có thể test nhanh các nghiệp vụ Module 3.

Kết quả cần đạt:

- User thường:
  - dashboard;
  - transfer;
  - transaction history;
  - reversal;
  - update profile;
  - xem user history.
- Admin:
  - xem users/accounts;
  - khóa/mở user;
  - soft delete user/account;
  - xem transactions;
  - reversal;
  - xem audit logs;
  - xem account history.

#### Cách hệ thống xử lý

1. `App.tsx` khai báo route user và admin; `ProtectedRoute` kiểm tra trạng thái đăng nhập và role để điều hướng giao diện.
2. Axios interceptor tự gắn Bearer JWT; các file `api/*.ts` tách riêng request transfer, reversal, audit, admin và history.
3. React Query dùng `query` cho dashboard/history/audit và `mutation` cho transfer, reversal, update, soft delete.
4. Sau mutation thành công, frontend invalidate các query liên quan như balance, transactions, users, accounts, audit logs và history.
5. Các trang hiển thị trạng thái `pending`, `completed`, `failed`, `reversed` và type `transfer`, `reversal`, `opening_balance` theo dữ liệu backend.
6. Nút thao tác chỉ hiện khi UI đánh giá đủ điều kiện, ví dụ chỉ cho bấm reversal với transaction `completed`; backend vẫn kiểm tra lại toàn bộ điều kiện.
7. Trang admin gom các API users/accounts/transactions/audit/history thành các tab và hỗ trợ filter, phân trang, include deleted.
8. Nếu API trả `401`, `403`, `409` hoặc lỗi validation, frontend hiển thị thông báo phù hợp và không tự suy đoán kết quả nghiệp vụ.
9. ProtectedRoute chỉ bảo vệ trải nghiệm frontend; quyền thật vẫn được kiểm soát bằng guard và role ở backend.

File cần show:

- `frontend/src/App.tsx`
- `frontend/src/components/BankingLayout.tsx`
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/TransferPage.tsx`
- `frontend/src/pages/TransactionHistoryPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/admin.ts`
- `frontend/src/api/audit.ts`
- `frontend/src/api/users.ts`
- `frontend/src/api/accounts.ts`
- `frontend/src/api/transactions.ts`

Demo trên máy:

1. Login user thường để demo transfer/profile/history.
2. Login admin để demo Admin Module 3.
3. Show route guard:
   - user thường không vào được `/admin/module-3`;
   - backend vẫn là nơi bảo vệ quyền thật bằng guard.

Cách nói high level:

> Frontend không thay đổi nghiệp vụ lõi, chỉ gọi các API đã làm ở backend để demo đầy đủ Module 3. Các thao tác admin được gom vào một console để dễ trình bày.

---

## 2. Thứ tự trình bày đề xuất

### Bước 1: Nói tổng quan Module 3

Mở file:

- `module_3.md`
- `filettmd3.md`

Nói:

> Module 3 xử lý 4 nhóm chính: double-entry ledger, transaction state machine/reversal, audit log, soft delete/versioning.

---

### Bước 2: Show data model

Mở file theo thứ tự:

1. `backend/src/ledger/entities/ledger-entry.entity.ts`
2. `backend/src/transactions/entities/transaction.entity.ts`
3. `backend/src/audit/entities/audit-log.entity.ts`
4. `backend/src/users/entities/user-history.entity.ts`
5. `backend/src/accounts/entities/account-history.entity.ts`
6. `backend/src/users/entities/user.entity.ts`
7. `backend/src/accounts/entities/account.entity.ts`

Nói:

> Đây là các bảng mới/cột mới phục vụ Module 3: ledger để ghi dòng tiền, transaction status để quản lý trạng thái, audit log để ghi hành vi, history để lưu before/after, deletedAt để soft delete.

---

### Bước 3: Show transfer dùng ledger

Mở file:

1. `backend/src/transactions/transactions.service.ts`
2. `backend/src/ledger/ledger.service.ts`
3. `frontend/src/pages/TransferPage.tsx`

Demo:

1. Login user.
2. Chuyển khoản.
3. Kiểm tra lịch sử giao dịch.
4. Kiểm tra DB `ledger_entries`.

---

### Bước 4: Show state machine và reversal

Mở file:

1. `backend/src/transactions/transaction-state.service.ts`
2. `backend/src/transactions/transactions.controller.ts`
3. `backend/src/transactions/transactions.service.ts`
4. `frontend/src/pages/TransactionHistoryPage.tsx`

Demo:

1. Chọn giao dịch completed.
2. Bấm hoàn tiền.
3. Kiểm tra transaction gốc thành reversed.
4. Kiểm tra transaction reversal mới.

---

### Bước 5: Show audit log

Mở file:

1. `backend/src/audit/audit.service.ts`
2. `backend/src/audit/audit.controller.ts`
3. `backend/src/audit/audit-request-context.ts`
4. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. Login admin.
2. Mở Admin Module 3.
3. Vào tab Audit Log.
4. Filter action/entity.
5. Show before/after.

---

### Bước 6: Show soft delete

Mở file:

1. `backend/src/admin/admin.controller.ts`
2. `backend/src/admin/admin.service.ts`
3. `backend/src/users/users.service.ts`
4. `backend/src/accounts/accounts.service.ts`
5. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. Login admin.
2. Soft delete account hoặc user.
3. Bật include deleted.
4. Show `deletedAt`.
5. Show audit/history liên quan.

---

### Bước 7: Show versioning/history

Mở file:

1. `backend/src/users/users.controller.ts`
2. `backend/src/users/users.service.ts`
3. `backend/src/accounts/accounts.controller.ts`
4. `backend/src/accounts/accounts.service.ts`
5. `frontend/src/pages/ProfilePage.tsx`
6. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. User đổi fullName/email.
2. Xem history hồ sơ.
3. Admin xem account history.

---

### Bước 8: Show test/build

Chạy:

```powershell
cd backend
npm test -- --runInBand
npm run build

cd ..\frontend
npm run build
npm run lint
```

File test nên show nếu mentor hỏi:

- `backend/src/ledger/ledger.service.spec.ts`
- `backend/src/transactions/transaction-state.service.spec.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `backend/src/users/users.service.spec.ts`
- `backend/src/accounts/accounts.service.spec.ts`
- `backend/src/admin/admin.service.spec.ts`
- `backend/src/auth/guards/roles.guard.spec.ts`

---

## 3. Checklist demo nhanh trên máy

### Demo user thường

1. Login `an@bank.test`.
2. Dashboard: show số dư.
3. Transfer: chuyển tiền cho user khác.
4. Transaction history:
   - status completed;
   - có thể bấm hoàn tiền.
5. Profile:
   - đổi fullName/email;
   - xem user history.

### Demo admin

1. Login `admin@bank.test`.
2. Vào Admin Module 3.
3. Tab User & Account:
   - filter user;
   - khóa/mở user;
   - soft delete account/user;
   - bật include deleted.
4. Tab Transactions:
   - filter status/type;
   - tạo reversal.
5. Tab Audit Log:
   - xem log thao tác vừa làm.
6. Tab Account History:
   - nhập accountId;
   - xem before/after.

### Demo DB

Các bảng nên mở:

- `accounts`
- `transactions`
- `ledger_entries`
- `audit_logs`
- `user_history`
- `account_history`
- `users`

Query gợi ý:

```sql
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;
SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 20;
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
SELECT * FROM user_history ORDER BY created_at DESC LIMIT 20;
SELECT * FROM account_history ORDER BY created_at DESC LIMIT 20;
```

---

## 4. Câu kết luận

> Module 3 giúp hệ thống không chỉ thực hiện giao dịch, mà còn chứng minh được dòng tiền đã đi như thế nào, ai đã thao tác, dữ liệu trước/sau ra sao, và vẫn giữ lịch sử khi hoàn tiền hoặc xóa mềm. Các phần quan trọng đều được xử lý bằng transaction, ledger append-only, state machine, audit log và history/versionin

# Kịch bản thuyết trình Module 3

## Mục tiêu trình bày

Module 3 tập trung vào **Audit Trail & Chống sửa đổi dữ liệu dòng tiền**.

Tài khoản demo sau khi chạy seed:

- Admin: `admin@bank.test` / `Test@123`
- User: `an@bank.test`, `binh@bank.test`, `chi@bank.test` / `Test@123`

Lệnh chuẩn bị:

```powershell
cd backend
npm run seed
npm run start:dev

cd ..\frontend
npm run dev
```

URL demo frontend:

```text
http://localhost:5173
```

---

## 1. Các use case đã xử lý

### Use case 1: Chuyển khoản ghi sổ kép

Người dùng chuyển tiền từ tài khoản A sang tài khoản B.

Kết quả cần đạt:

- Giao dịch được tạo trong bảng `transactions`.
- Tạo 2 bút toán trong `ledger_entries`:
  - `DEBIT` tài khoản gửi.
  - `CREDIT` tài khoản nhận.
- `accounts.balance` vẫn được cập nhật như cached balance để UI đọc nhanh.
- Ledger là nguồn dữ liệu dùng để đối soát.

File cần show:

- `backend/src/ledger/entities/ledger-entry.entity.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/transactions/entities/transaction.entity.ts`
- `frontend/src/pages/TransferPage.tsx`
- `frontend/src/pages/TransactionHistoryPage.tsx`

Demo trên máy:

1. Login user `an@bank.test`.
2. Vào màn **Chuyển khoản**.
3. Chuyển tiền sang tài khoản user khác.
4. Vào **Lịch sử giao dịch** để thấy transaction status `completed`.
5. Mở DB kiểm tra:
   - bảng `transactions`;
   - bảng `ledger_entries`;
   - số dư ở `accounts`.

Cách nói high level:

> Trước Module 3, transfer chủ yếu update trực tiếp balance. Sau khi refactor, mỗi transfer được xử lý trong một DB transaction: tạo transaction pending, ghi ledger debit/credit, cập nhật cached balance, rồi chuyển status sang completed. Nếu có lỗi giữa chừng thì rollback toàn bộ.

---

### Use case 2: Seed/backfill ledger cho số dư ban đầu

Khi seed dữ liệu mẫu, tài khoản có balance ban đầu cần có ledger để không bị lệch đối soát.

Kết quả cần đạt:

- Account seed có balance > 0 sẽ có transaction `opening_balance`.
- Tạo ledger `CREDIT` tương ứng cho account đó.
- Chạy seed nhiều lần không tạo trùng opening ledger.

File cần show:

- `backend/src/database/seed.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/entities/transaction.entity.ts`

Demo trên máy:

1. Chạy:

```powershell
cd backend
npm run seed
```

2. Mở DB kiểm tra:
   - `transactions.type = opening_balance`;
   - `ledger_entries.type = credit`;
   - `ledger_entries.balance_after` khớp `accounts.balance`.

Cách nói high level:

> Vì dữ liệu seed đặt số dư ban đầu, hệ thống cần backfill ledger bằng opening balance. Đây là giao dịch khởi tạo demo, giúp balance cache và ledger không lệch ngay từ đầu.

---

### Use case 3: Chặn sửa/xóa ledger ở tầng application

Ledger phải append-only, không được sửa/xóa bút toán đã ghi.

Kết quả cần đạt:

- Không có controller update/delete ledger.
- `LedgerService` chỉ expose method đọc và ghi append-only.
- Có test kiểm tra service không có method update/delete/remove.

File cần show:

- `backend/src/ledger/ledger.service.ts`
- `backend/src/ledger/ledger.module.ts`
- `backend/src/ledger/ledger.service.spec.ts`

Demo trên máy:

1. Mở `LedgerService`, chỉ ra các method public:
   - `getAccountLedgerBalance`
   - `createEntry`
   - `recordTransfer`
   - `recordReversal`
2. Mở test append-only.
3. Chạy:

```powershell
cd backend
npm test -- --runInBand
```

Cách nói high level:

> Với ledger, nguyên tắc là không sửa lịch sử dòng tiền. Code không tạo API update/delete ledger, repository không export bừa bãi, service chỉ cho ghi thêm bút toán mới.

---

### Use case 4: Transaction State Machine

Transaction không được đổi status tùy tiện.

Kết quả cần đạt:

- Status chuẩn:
  - `pending`
  - `completed`
  - `failed`
  - `reversed`
- Chỉ cho phép transition hợp lệ:
  - `pending -> completed`
  - `pending -> failed`
  - `completed -> reversed`
- Không cho `failed -> completed`, `reversed -> completed`, hoặc complete nhiều lần.

File cần show:

- `backend/src/transactions/entities/transaction.entity.ts`
- `backend/src/transactions/transaction-state.service.ts`
- `backend/src/transactions/transaction-state.service.spec.ts`
- `backend/src/transactions/transactions.service.ts`
- `frontend/src/types/transactions.ts`

Demo trên máy:

1. Mở transaction entity để show enum status.
2. Mở `TransactionStateService` để show rule transition.
3. Chạy test state machine:

```powershell
cd backend
npm test -- --runInBand transaction-state
```

Cách nói high level:

> Thay vì set status trực tiếp nhiều nơi, em tách state machine service. Service này kiểm soát transaction được chuyển trạng thái nào, tránh trạng thái sai nghiệp vụ như reversed quay lại completed.

---

### Use case 5: Reversal / hoàn tiền

Khi cần hoàn tiền, hệ thống không xóa/sửa giao dịch gốc.

Kết quả cần đạt:

- Tạo transaction mới type `reversal`.
- Ghi ledger đảo ngược:
  - debit tài khoản đã nhận tiền ban đầu;
  - credit tài khoản gửi tiền ban đầu.
- Transaction gốc chuyển status sang `reversed`.
- Không cho reversal hai lần cho cùng giao dịch gốc.

File cần show:

- `backend/src/transactions/dto/reverse-transaction.dto.ts`
- `backend/src/transactions/transactions.controller.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/ledger/ledger.service.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `frontend/src/pages/TransactionHistoryPage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/transactions.ts`

Demo trên máy:

1. Login user hoặc admin.
2. Vào **Lịch sử giao dịch**.
3. Chọn transaction `completed`, bấm **Hoàn tiền/Reversal**.
4. Nhập lý do hoàn tiền.
5. Kiểm tra UI:
   - transaction gốc thành `reversed`;
   - có transaction mới type `reversal`.
6. Kiểm tra DB:
   - bảng `transactions`;
   - bảng `ledger_entries`;
   - bảng `audit_logs`.

Cách nói high level:

> Reversal được thiết kế theo hướng bất biến dữ liệu. Giao dịch gốc vẫn giữ nguyên amount/from/to, chỉ đổi status sang reversed. Tiền được trả lại bằng một transaction mới và một cặp ledger debit/credit đảo chiều.

---

### Use case 6: Audit Log

Các thao tác nhạy cảm phải ghi lại ai làm, làm gì, trước/sau như thế nào.

Kết quả cần đạt:

- Ghi log cho:
  - login thành công/thất bại;
  - register;
  - transfer completed;
  - reversal completed;
  - mark original transaction reversed;
  - soft delete user/account;
  - update user profile/status.
- Audit log có:
  - actor;
  - action;
  - entity/entityId;
  - beforeData/afterData;
  - IP/user-agent;
  - createdAt.
- Admin mới xem được audit logs.
- Không log password, token, secret.

File cần show:

- `backend/src/audit/entities/audit-log.entity.ts`
- `backend/src/audit/audit.service.ts`
- `backend/src/audit/audit.controller.ts`
- `backend/src/audit/audit-request-context.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/transactions/transactions.service.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/audit.ts`

Demo trên máy:

1. Login admin.
2. Vào **Admin Module 3**.
3. Mở tab **Audit Log**.
4. Thực hiện một thao tác như reversal hoặc khóa user.
5. Quay lại audit log, filter theo:
   - `entity = Transaction`
   - hoặc `action = transaction.reversal.completed`
6. Show before/after data.

Cách nói high level:

> Audit log được ghi ở service ngay trong luồng nghiệp vụ. Những thao tác cần atomic thì dùng `logInTransaction` để audit log rollback cùng nghiệp vụ nếu có lỗi.

---

### Use case 7: Soft Delete User/Account

Xóa user/account nhưng không mất dữ liệu lịch sử.

Kết quả cần đạt:

- User/account có `deleted_at`.
- Không dùng hard delete.
- Query mặc định không lấy bản ghi đã xóa.
- Admin có thể xem cả bản ghi đã xóa khi bật include deleted.
- Soft delete ghi audit log và history.

File cần show:

- `backend/src/users/entities/user.entity.ts`
- `backend/src/accounts/entities/account.entity.ts`
- `backend/src/users/users.service.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/admin/admin.controller.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/admin.ts`

Demo trên máy:

1. Login admin.
2. Vào **Admin Module 3** tab **User & Account**.
3. Chọn một account hoặc user, bấm xóa.
4. Bật **Kể cả đã xóa** để thấy bản ghi vẫn còn nhưng có `deletedAt`.
5. Kiểm tra DB:
   - `users.deleted_at`;
   - `accounts.deleted_at`;
   - `audit_logs`;
   - `user_history`;
   - `account_history`.

Cách nói high level:

> Vì transaction, ledger và audit cần giữ lịch sử, em không hard delete user/account. Khi xóa thì chỉ set `deletedAt`, các luồng active sẽ không lấy bản ghi đó nữa.

---

### Use case 8: Versioning / History

Thay đổi thông tin nhạy cảm cần lưu phiên bản trước/sau.

Kết quả cần đạt:

- Có bảng `user_history` cho email/fullName/status/deletedAt.
- Có bảng `account_history` cho accountNumber/balance/currency/deletedAt.
- Update profile/status/soft delete đều ghi `beforeData` và `afterData`.
- Không lưu password hash trong history.
- Có API xem history.

File cần show:

- `backend/src/users/entities/user-history.entity.ts`
- `backend/src/accounts/entities/account-history.entity.ts`
- `backend/src/users/users.controller.ts`
- `backend/src/users/users.service.ts`
- `backend/src/accounts/accounts.controller.ts`
- `backend/src/accounts/accounts.service.ts`
- `backend/src/admin/admin.service.ts`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/users.ts`
- `frontend/src/api/accounts.ts`

Demo trên máy:

1. Login user.
2. Vào **Hồ sơ**.
3. Đổi fullName hoặc email.
4. Xem phần **History hồ sơ** để thấy before/after.
5. Login admin.
6. Vào **Admin Module 3** tab **Account History**.
7. Nhập accountId đã soft delete hoặc account có history để xem before/after.

Cách nói high level:

> History khác audit log ở chỗ nó bám vào từng entity để xem các phiên bản dữ liệu của entity đó. Audit trả lời câu hỏi ai làm gì, còn history trả lời dữ liệu này đã thay đổi như thế nào.

---

### Use case 9: Frontend demo cho toàn bộ Module 3

Frontend được bổ sung để mentor có thể test nhanh các nghiệp vụ Module 3.

Kết quả cần đạt:

- User thường:
  - dashboard;
  - transfer;
  - transaction history;
  - reversal;
  - update profile;
  - xem user history.
- Admin:
  - xem users/accounts;
  - khóa/mở user;
  - soft delete user/account;
  - xem transactions;
  - reversal;
  - xem audit logs;
  - xem account history.

File cần show:

- `frontend/src/App.tsx`
- `frontend/src/components/BankingLayout.tsx`
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/TransferPage.tsx`
- `frontend/src/pages/TransactionHistoryPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/AdminModule3Page.tsx`
- `frontend/src/api/admin.ts`
- `frontend/src/api/audit.ts`
- `frontend/src/api/users.ts`
- `frontend/src/api/accounts.ts`
- `frontend/src/api/transactions.ts`

Demo trên máy:

1. Login user thường để demo transfer/profile/history.
2. Login admin để demo Admin Module 3.
3. Show route guard:
   - user thường không vào được `/admin/module-3`;
   - backend vẫn là nơi bảo vệ quyền thật bằng guard.

Cách nói high level:

> Frontend không thay đổi nghiệp vụ lõi, chỉ gọi các API đã làm ở backend để demo đầy đủ Module 3. Các thao tác admin được gom vào một console để dễ trình bày.

---

## 2. Thứ tự trình bày đề xuất

### Bước 1: Nói tổng quan Module 3

Mở file:

- `module_3.md`
- `filettmd3.md`

Nói:

> Module 3 xử lý 4 nhóm chính: double-entry ledger, transaction state machine/reversal, audit log, soft delete/versioning.

---

### Bước 2: Show data model

Mở file theo thứ tự:

1. `backend/src/ledger/entities/ledger-entry.entity.ts`
2. `backend/src/transactions/entities/transaction.entity.ts`
3. `backend/src/audit/entities/audit-log.entity.ts`
4. `backend/src/users/entities/user-history.entity.ts`
5. `backend/src/accounts/entities/account-history.entity.ts`
6. `backend/src/users/entities/user.entity.ts`
7. `backend/src/accounts/entities/account.entity.ts`

Nói:

> Đây là các bảng mới/cột mới phục vụ Module 3: ledger để ghi dòng tiền, transaction status để quản lý trạng thái, audit log để ghi hành vi, history để lưu before/after, deletedAt để soft delete.

---

### Bước 3: Show transfer dùng ledger

Mở file:

1. `backend/src/transactions/transactions.service.ts`
2. `backend/src/ledger/ledger.service.ts`
3. `frontend/src/pages/TransferPage.tsx`

Demo:

1. Login user.
2. Chuyển khoản.
3. Kiểm tra lịch sử giao dịch.
4. Kiểm tra DB `ledger_entries`.

---

### Bước 4: Show state machine và reversal

Mở file:

1. `backend/src/transactions/transaction-state.service.ts`
2. `backend/src/transactions/transactions.controller.ts`
3. `backend/src/transactions/transactions.service.ts`
4. `frontend/src/pages/TransactionHistoryPage.tsx`

Demo:

1. Chọn giao dịch completed.
2. Bấm hoàn tiền.
3. Kiểm tra transaction gốc thành reversed.
4. Kiểm tra transaction reversal mới.

---

### Bước 5: Show audit log

Mở file:

1. `backend/src/audit/audit.service.ts`
2. `backend/src/audit/audit.controller.ts`
3. `backend/src/audit/audit-request-context.ts`
4. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. Login admin.
2. Mở Admin Module 3.
3. Vào tab Audit Log.
4. Filter action/entity.
5. Show before/after.

---

### Bước 6: Show soft delete

Mở file:

1. `backend/src/admin/admin.controller.ts`
2. `backend/src/admin/admin.service.ts`
3. `backend/src/users/users.service.ts`
4. `backend/src/accounts/accounts.service.ts`
5. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. Login admin.
2. Soft delete account hoặc user.
3. Bật include deleted.
4. Show `deletedAt`.
5. Show audit/history liên quan.

---

### Bước 7: Show versioning/history

Mở file:

1. `backend/src/users/users.controller.ts`
2. `backend/src/users/users.service.ts`
3. `backend/src/accounts/accounts.controller.ts`
4. `backend/src/accounts/accounts.service.ts`
5. `frontend/src/pages/ProfilePage.tsx`
6. `frontend/src/pages/AdminModule3Page.tsx`

Demo:

1. User đổi fullName/email.
2. Xem history hồ sơ.
3. Admin xem account history.

---

### Bước 8: Show test/build

Chạy:

```powershell
cd backend
npm test -- --runInBand
npm run build

cd ..\frontend
npm run build
npm run lint
```

File test nên show nếu mentor hỏi:

- `backend/src/ledger/ledger.service.spec.ts`
- `backend/src/transactions/transaction-state.service.spec.ts`
- `backend/src/transactions/transactions.service.spec.ts`
- `backend/src/users/users.service.spec.ts`
- `backend/src/accounts/accounts.service.spec.ts`
- `backend/src/admin/admin.service.spec.ts`
- `backend/src/auth/guards/roles.guard.spec.ts`

---

## 3. Checklist demo nhanh trên máy

### Demo user thường

1. Login `an@bank.test`.
2. Dashboard: show số dư.
3. Transfer: chuyển tiền cho user khác.
4. Transaction history:
   - status completed;
   - có thể bấm hoàn tiền.
5. Profile:
   - đổi fullName/email;
   - xem user history.

### Demo admin

1. Login `admin@bank.test`.
2. Vào Admin Module 3.
3. Tab User & Account:
   - filter user;
   - khóa/mở user;
   - soft delete account/user;
   - bật include deleted.
4. Tab Transactions:
   - filter status/type;
   - tạo reversal.
5. Tab Audit Log:
   - xem log thao tác vừa làm.
6. Tab Account History:
   - nhập accountId;
   - xem before/after.

### Demo DB

Các bảng nên mở:

- `accounts`
- `transactions`
- `ledger_entries`
- `audit_logs`
- `user_history`
- `account_history`
- `users`

Query gợi ý:

```sql
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;
SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 20;
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
SELECT * FROM user_history ORDER BY created_at DESC LIMIT 20;
SELECT * FROM account_history ORDER BY created_at DESC LIMIT 20;
```

---

## 4. Câu kết luận

> Module 3 giúp hệ thống không chỉ thực hiện giao dịch, mà còn chứng minh được dòng tiền đã đi như thế nào, ai đã thao tác, dữ liệu trước/sau ra sao, và vẫn giữ lịch sử khi hoàn tiền hoặc xóa mềm. Các phần quan trọng đều được xử lý bằng transaction, ledger append-only, state machine, audit log và history/versioning.
