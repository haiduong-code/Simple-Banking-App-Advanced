**BỘ BÀI TẬP BỔ SUNG**

**Simple Banking App — Nghiệp vụ ngân hàng nâng cao**

*Stack: NestJS (backend) + Next.js (frontend) \| Đối tượng: Thực tập sinh đã nắm CRUD cơ bản*

# 1. Bối cảnh & Mục tiêu

Các bạn thực tập sinh đã hoàn thành phiên bản cơ bản của Simple Banking App (đăng ký/đăng nhập, tạo tài khoản, nạp/rút tiền, chuyển khoản, xem lịch sử giao dịch). Bộ bài tập này mở rộng thêm các bài toán nghiệp vụ mà một ứng dụng ngân hàng thực tế bắt buộc phải xử lý, nhưng thường bị bỏ qua ở phiên bản CRUD cơ bản:

- Toàn vẹn dữ liệu khi nhiều giao dịch xảy ra đồng thời (concurrency).

- Chống gửi trùng lặp giao dịch (idempotency).

- Chống sửa đổi / xóa dữ liệu giao dịch đã phát sinh (immutability, audit trail).

- Phân quyền và bảo mật giao dịch.

- Validate nghiệp vụ chặt chẽ hơn (hạn mức, trạng thái tài khoản, trạng thái giao dịch).

- Đối soát số liệu và giám sát bất thường.

- Kiểm thử các kịch bản khó (concurrency, rollback).

Mỗi bài đều có: mục tiêu nghiệp vụ, yêu cầu kỹ thuật, và tiêu chí đánh giá / test case gợi ý để bạn có thể chấm chéo hoặc để thực tập sinh tự kiểm tra.

# 2. Module 1 — Toàn vẹn giao dịch & Chống Race Condition

Đây là lỗi kinh điển nhất trong bài toán ngân hàng: hai request rút/chuyển tiền cùng lúc trên cùng một tài khoản có thể khiến số dư bị tính sai (lost update) nếu không xử lý concurrency đúng cách.

### 1.1. Tái hiện lỗi Race Condition

**Mục tiêu nghiệp vụ:** Chứng minh được rằng nếu không xử lý concurrency, số dư tài khoản sẽ bị sai khi có nhiều request rút tiền cùng lúc.

**Yêu cầu kỹ thuật:**

- Viết script (dùng Promise.all hoặc autocannon/k6) bắn 20 request rút tiền 100.000đ đồng thời vào 1 tài khoản có số dư 1.000.000đ.

- Chạy trên bản code hiện tại (chưa có lock) và ghi lại số dư cuối cùng thực tế.

**Tiêu chí đánh giá / test case gợi ý:**

- Số dư cuối cùng sai khác so với số dư kỳ vọng (1.000.000 - 20×100.000 = -1.000.000, hoặc bị âm mà hệ thống không chặn).

- Viết báo cáo ngắn giải thích tại sao xảy ra (đọc số dư — tính toán — ghi số dư không atomic).

### 1.2. Pessimistic Locking (SELECT ... FOR UPDATE)

**Mục tiêu nghiệp vụ:** Đảm bảo tại một thời điểm chỉ một transaction được thao tác lên số dư của một tài khoản.

**Yêu cầu kỹ thuật:**

- Dùng transaction của TypeORM/Prisma, lock row tài khoản bằng SELECT ... FOR UPDATE trước khi đọc/ghi số dư.

- Đảm bảo toàn bộ thao tác đọc số dư → kiểm tra → trừ/cộng tiền → ghi lại nằm trong 1 transaction DB.

**Tiêu chí đánh giá / test case gợi ý:**

- Chạy lại kịch bản 20 request đồng thời ở bài 1.1: số dư cuối cùng phải chính xác tuyệt đối.

- Không có request nào bị treo quá thời gian timeout hợp lý (đo thời gian xử lý trung bình).

***Gợi ý:** Với Prisma dùng \$transaction + queryRaw SELECT FOR UPDATE (Prisma chưa hỗ trợ native); với TypeORM dùng QueryRunner + setLock('pessimistic_write').*

### 1.3. Optimistic Locking (version column)

**Mục tiêu nghiệp vụ:** Xử lý concurrency bằng version thay vì khóa row, phù hợp khi tỷ lệ xung đột thấp.

**Yêu cầu kỹ thuật:**

- Thêm cột version (hoặc updatedAt) vào bảng account.

- Khi update số dư, thêm điều kiện WHERE version = :oldVersion, đồng thời tăng version lên 1.

- Nếu update trả về 0 dòng bị ảnh hưởng → coi là xung đột, retry lại toàn bộ thao tác (đọc lại số dư mới nhất) tối đa N lần.

**Tiêu chí đánh giá / test case gợi ý:**

- Test tương tự 1.1: kết quả số dư chính xác.

- So sánh throughput (số request/giây) giữa pessimistic locking và optimistic locking, viết nhận xét khi nào nên dùng loại nào.

### 1.4. Xử lý Deadlock khi chuyển khoản hai chiều

**Mục tiêu nghiệp vụ:** Tránh deadlock khi A chuyển tiền cho B và B chuyển tiền cho A xảy ra cùng lúc (hai transaction lock 2 row theo thứ tự ngược nhau).

**Yêu cầu kỹ thuật:**

- Viết logic chuyển khoản luôn lock các tài khoản theo thứ tự cố định (ví dụ theo accountId tăng dần), không lock theo thứ tự sender → receiver.

- Bắn đồng thời 2 giao dịch A→B và B→A nhiều lần liên tiếp để kiểm tra.

**Tiêu chí đánh giá / test case gợi ý:**

- Không xảy ra deadlock (hoặc nếu có, có cơ chế bắt lỗi + retry tự động, không làm crash service).

- Log lại số lần deadlock xảy ra (nếu có) và số lần retry thành công.

# 3. Module 2 — Idempotency: Chống Trùng Lặp Giao Dịch

Trong thực tế, client có thể gửi trùng request do timeout, mất mạng, người dùng bấm nút 2 lần... Hệ thống ngân hàng phải đảm bảo cùng một yêu cầu không bị thực hiện 2 lần.

### 2.1. Idempotency Key cho API chuyển khoản

**Mục tiêu nghiệp vụ:** Đảm bảo cùng một request chuyển khoản (cùng Idempotency-Key) chỉ được xử lý một lần dù client gửi lại nhiều lần.

**Yêu cầu kỹ thuật:**

- Client gửi kèm header Idempotency-Key (UUID do client sinh ra) khi gọi API tạo giao dịch.

- Backend lưu bảng idempotency_keys (key, request_hash, response, status, expired_at).

- Nếu key đã tồn tại và request giống hệt → trả lại kết quả cũ (không xử lý lại). Nếu key tồn tại nhưng payload khác → trả lỗi 409 Conflict.

**Tiêu chí đánh giá / test case gợi ý:**

- Gửi 5 lần cùng 1 request với cùng Idempotency-Key → chỉ có 1 giao dịch được tạo trong DB, cả 5 response đều giống nhau.

- Gửi lại với cùng key nhưng payload khác → trả về lỗi rõ ràng, không tạo giao dịch mới.

### 2.2. Retry an toàn phía Frontend (Next.js)

**Mục tiêu nghiệp vụ:** Xử lý tình huống mất mạng/timeout khi người dùng bấm nút chuyển tiền, tránh double-submit từ UI.

**Yêu cầu kỹ thuật:**

- Sinh Idempotency-Key ở frontend ngay khi mở form giao dịch (không sinh lại khi retry).

- Disable nút submit ngay sau khi bấm, hiển thị trạng thái loading; nếu request timeout, tự động retry với cùng key.

**Tiêu chí đánh giá / test case gợi ý:**

- Người dùng bấm nút liên tục 5 lần khi mạng chậm → chỉ 1 giao dịch được ghi nhận.

- Test bằng cách throttle network (Chrome DevTools) để giả lập timeout và retry.

# 4. Module 3 — Audit Trail & Chống Sửa Đổi Dữ Liệu

Một trong những yêu cầu quan trọng nhất của hệ thống tài chính: dữ liệu giao dịch phải bất biến (immutable) và mọi thay đổi phải có dấu vết (audit trail) để phục vụ đối soát, thanh tra, và điều tra gian lận.

### 3.1. Chuyển sang mô hình Sổ cái kép (Double-entry Ledger)

**Mục tiêu nghiệp vụ:** Thay vì chỉ lưu 1 cột balance trên bảng account rồi update trực tiếp, chuyển sang mô hình ghi sổ kép: mọi biến động đều là các bút toán (ledger entries) không thể sửa/xóa, số dư được tính (hoặc cache) từ tổng các bút toán.

**Yêu cầu kỹ thuật:**

- Tạo bảng ledger_entries: id, account_id, transaction_id, type (DEBIT/CREDIT), amount, balance_after, created_at.

- Mỗi giao dịch chuyển khoản sinh ra ít nhất 2 bút toán (ghi nợ tài khoản gửi, ghi có tài khoản nhận), tổng debit = tổng credit.

- Bảng ledger_entries chỉ INSERT, không cho phép UPDATE/DELETE (chặn ở tầng application + có thể chặn thêm ở DB bằng trigger hoặc revoke quyền UPDATE/DELETE).

**Tiêu chí đánh giá / test case gợi ý:**

- Thử gọi thẳng UPDATE/DELETE vào bảng ledger_entries qua API hoặc qua service layer → bị từ chối.

- Tổng balance tính từ ledger_entries của 1 tài khoản phải khớp với balance hiển thị.

***Gợi ý:** Đây là bài quan trọng nhất của module — nên làm kỹ trước khi qua bài 3.2, 3.3.*

### 3.2. Transaction State Machine thay vì sửa trực tiếp

**Mục tiêu nghiệp vụ:** Khi giao dịch cần 'hủy' hoặc 'hoàn tiền', không được sửa/xóa bản ghi cũ mà phải tạo bút toán đảo ngược (reversal entry).

**Yêu cầu kỹ thuật:**

- Định nghĩa trạng thái giao dịch: PENDING → COMPLETED / FAILED; COMPLETED → REVERSED.

- Khi hoàn tiền một giao dịch COMPLETED, tạo một giao dịch mới loại REVERSAL tham chiếu đến giao dịch gốc (original_transaction_id), không update giao dịch gốc.

**Tiêu chí đánh giá / test case gợi ý:**

- Sau khi hoàn tiền, giao dịch gốc vẫn còn nguyên trong lịch sử với trạng thái REVERSED, kèm link tới giao dịch hoàn tiền.

- Không thể hoàn tiền 2 lần cho cùng 1 giao dịch gốc.

### 3.3. Audit Log cho thao tác nhạy cảm

**Mục tiêu nghiệp vụ:** Ghi lại đầy đủ 'ai đã làm gì, khi nào' cho các thao tác quan trọng (đăng nhập, đổi mật khẩu, khóa tài khoản, tạo/duyệt giao dịch lớn...).

**Yêu cầu kỹ thuật:**

- Tạo bảng audit_logs: id, actor_id, action, entity, entity_id, ip_address, user_agent, before_data (JSON), after_data (JSON), created_at.

- Dùng NestJS Interceptor hoặc Subscriber (TypeORM) để tự động ghi log cho các entity quan trọng, tránh phải gọi thủ công ở từng service.

**Tiêu chí đánh giá / test case gợi ý:**

- Mọi thao tác cập nhật trạng thái tài khoản (khóa/mở khóa) đều có bản ghi audit log tương ứng, có before/after rõ ràng.

- API xem audit log chỉ dành cho role admin (kiểm tra bằng test phân quyền).

### 3.4. Soft Delete & Versioning cho Account

**Mục tiêu nghiệp vụ:** Không xóa cứng (hard delete) dữ liệu tài khoản/khách hàng; giữ lịch sử thay đổi thông tin.

**Yêu cầu kỹ thuật:**

- Thêm cột deleted_at cho account/user, các query mặc định phải loại trừ bản ghi đã soft-delete.

- Khi khách hàng cập nhật thông tin nhạy cảm (email, số điện thoại), lưu lại phiên bản cũ vào bảng account_history trước khi ghi đè.

**Tiêu chí đánh giá / test case gợi ý:**

- Xóa một tài khoản → dữ liệu vẫn còn trong DB (deleted_at khác null), không xuất hiện trong danh sách tài khoản active.

- Xem lại account_history thấy đầy đủ các lần thay đổi thông tin trước đó.

# 5. Module 4 — Bảo mật & Phân quyền

### 4.1. Phân quyền theo vai trò (RBAC)

**Mục tiêu nghiệp vụ:** Phân biệt rõ quyền hạn giữa CUSTOMER, TELLER (giao dịch viên), ADMIN.

**Yêu cầu kỹ thuật:**

- Dùng NestJS Guards + Decorators (@Roles(), RolesGuard) để bảo vệ endpoint theo role.

- CUSTOMER chỉ thao tác trên tài khoản của chính mình; TELLER có thể tạo giao dịch hộ khách nhưng không được duyệt giao dịch giá trị lớn; ADMIN quản lý toàn bộ + xem audit log.

**Tiêu chí đánh giá / test case gợi ý:**

- Viết test: CUSTOMER gọi API xem tài khoản người khác → bị từ chối 403.

- TELLER gọi API duyệt giao dịch lớn (vượt hạn mức) → bị từ chối, phải có ADMIN duyệt.

### 4.2. JWT Access + Refresh Token, thu hồi token

**Mục tiêu nghiệp vụ:** Quản lý phiên đăng nhập an toàn hơn, cho phép đăng xuất thực sự (thu hồi token) thay vì chỉ xóa token ở client.

**Yêu cầu kỹ thuật:**

- Access token thời gian sống ngắn (ví dụ 15 phút), refresh token dài hơn, lưu refresh token (hash) trong DB kèm thiết bị/IP.

- API logout / đổi mật khẩu / phát hiện bất thường → thu hồi (revoke) toàn bộ refresh token của user.

**Tiêu chí đánh giá / test case gợi ý:**

- Sau khi logout, refresh token cũ không thể dùng để lấy access token mới.

- Đổi mật khẩu xong, các phiên đăng nhập cũ trên thiết bị khác đều bị đăng xuất.

### 4.3. Xác thực 2 lớp (OTP) cho giao dịch giá trị lớn

**Mục tiêu nghiệp vụ:** Giao dịch vượt một ngưỡng nhất định phải xác nhận thêm bằng OTP trước khi thực thi.

**Yêu cầu kỹ thuật:**

- Định nghĩa ngưỡng (ví dụ \> 10.000.000đ) yêu cầu OTP; sinh OTP 6 số, hết hạn sau 5 phút, giới hạn số lần nhập sai.

- Giao dịch ở trạng thái PENDING_OTP cho tới khi xác thực đúng OTP mới chuyển sang PROCESSING.

**Tiêu chí đánh giá / test case gợi ý:**

- Giao dịch dưới ngưỡng không yêu cầu OTP, đúng ngưỡng trở lên bắt buộc phải có OTP hợp lệ mới hoàn tất.

- Nhập sai OTP quá số lần cho phép → giao dịch bị hủy (FAILED), không thử lại được OTP cũ.

### 4.4. Rate Limiting & chống spam giao dịch

**Mục tiêu nghiệp vụ:** Chặn hành vi tấn công brute-force đăng nhập hoặc spam tạo giao dịch liên tục.

**Yêu cầu kỹ thuật:**

- Dùng @nestjs/throttler giới hạn số request/phút cho API login và API tạo giao dịch, theo IP và theo user.

- Khóa tạm thời tài khoản sau N lần đăng nhập sai liên tiếp trong khoảng thời gian ngắn.

**Tiêu chí đánh giá / test case gợi ý:**

- Gửi quá số lượng request cho phép → nhận HTTP 429 Too Many Requests.

- Đăng nhập sai 5 lần liên tiếp trong 1 phút → tài khoản bị khóa tạm thời, có thông báo rõ ràng.

# 6. Module 5 — Validation nghiệp vụ nâng cao

### 5.1. Hạn mức giao dịch theo ngày/lần

**Mục tiêu nghiệp vụ:** Kiểm soát số tiền tối đa được rút/chuyển trong 1 lần và trong 1 ngày.

**Yêu cầu kỹ thuật:**

- Cấu hình hạn mức theo loại tài khoản (ví dụ tài khoản thường: 50 triệu/ngày, VIP: 200 triệu/ngày).

- Tính tổng giá trị giao dịch trong ngày (theo giờ Việt Nam) trước khi cho phép giao dịch mới.

**Tiêu chí đánh giá / test case gợi ý:**

- Giao dịch vượt hạn mức 1 lần → từ chối ngay với thông báo rõ ràng.

- Tổng nhiều giao dịch nhỏ trong ngày vượt hạn mức ngày → giao dịch cuối cùng bị từ chối dù bản thân nó nhỏ.

### 5.2. Kiểm tra trạng thái tài khoản & số dư

**Mục tiêu nghiệp vụ:** Đảm bảo không thực hiện giao dịch trên tài khoản không hợp lệ hoặc không đủ điều kiện.

**Yêu cầu kỹ thuật:**

- Thêm trạng thái tài khoản: ACTIVE, FROZEN (đóng băng), CLOSED. Chỉ ACTIVE mới được giao dịch.

- Chặn giao dịch nếu 2 tài khoản khác loại tiền tệ (nếu hệ thống hỗ trợ đa tiền tệ) mà chưa quy đổi.

- Không cho phép số dư âm sau giao dịch (trừ trường hợp có hạn mức thấu chi được cấu hình riêng).

**Tiêu chí đánh giá / test case gợi ý:**

- Chuyển khoản từ/đến tài khoản FROZEN hoặc CLOSED → bị từ chối với mã lỗi rõ ràng.

- Rút tiền vượt số dư khả dụng (balance - hold amount) → bị từ chối, có transaction log ghi nhận là FAILED (không phải im lặng bỏ qua).

### 5.3. Transaction State Machine đầy đủ

**Mục tiêu nghiệp vụ:** Mô hình hóa vòng đời giao dịch rõ ràng, tránh các trạng thái 'lửng lơ' khi lỗi giữa chừng.

**Yêu cầu kỹ thuật:**

- Định nghĩa đầy đủ state machine: INITIATED → PENDING_OTP (nếu cần) → PROCESSING → COMPLETED \| FAILED; COMPLETED → REVERSED.

- Đảm bảo chuyển trạng thái chỉ được thực hiện theo đúng các cạnh hợp lệ (dùng thư viện state machine hoặc tự validate transition).

**Tiêu chí đánh giá / test case gợi ý:**

- Cố tình gọi API chuyển trạng thái không hợp lệ (ví dụ FAILED → COMPLETED) → bị từ chối.

- Nếu server crash giữa chừng lúc đang PROCESSING, có cơ chế (cron job hoặc check khi truy vấn) phát hiện giao dịch bị 'treo' quá lâu để đánh dấu FAILED và hoàn tiền nếu cần.

# 7. Module 6 — Đối soát & Giám sát

### 6.1. Job đối soát cuối ngày (Reconciliation)

**Mục tiêu nghiệp vụ:** Đảm bảo tổng số dư sổ cái luôn khớp, phát hiện sớm sai lệch dữ liệu.

**Yêu cầu kỹ thuật:**

- Viết cron job (NestJS @Cron) chạy cuối ngày: so sánh balance lưu ở bảng account với balance tính từ tổng ledger_entries.

- Nếu có sai lệch, ghi vào bảng reconciliation_reports và gửi cảnh báo (log ở mức ERROR, hoặc gửi email/webhook).

**Tiêu chí đánh giá / test case gợi ý:**

- Chủ động tạo 1 tình huống sai lệch giả (sửa thẳng balance trong DB không qua ledger) → job phát hiện và báo cáo đúng tài khoản bị lệch.

- Khi không có sai lệch, báo cáo trả về rỗng/OK.

### 6.2. Phát hiện bất thường cơ bản (Fraud Detection)

**Mục tiêu nghiệp vụ:** Cảnh báo sớm các hành vi giao dịch bất thường để con người xem xét thêm, không cần AI phức tạp.

**Yêu cầu kỹ thuật:**

- Quy tắc đơn giản: \>5 giao dịch trong 1 phút từ cùng 1 tài khoản, hoặc giao dịch có giá trị gấp nhiều lần trung bình 30 ngày gần nhất, hoặc đăng nhập từ 2 vị trí địa lý cách xa nhau trong thời gian ngắn.

- Khi phát hiện, đánh dấu giao dịch/tài khoản cần review (flag), không tự động chặn hoàn toàn (tránh chặn nhầm khách hàng thật).

**Tiêu chí đánh giá / test case gợi ý:**

- Bắn nhiều giao dịch liên tiếp giả lập → hệ thống gắn cờ 'cần review' đúng như quy tắc.

- API admin xem danh sách giao dịch bị gắn cờ, có thể duyệt (approve) hoặc từ chối (reject).

### 6.3. Structured Logging & Health Check

**Mục tiêu nghiệp vụ:** Chuẩn hóa log để dễ tra cứu khi có sự cố, và có endpoint kiểm tra sức khỏe hệ thống.

**Yêu cầu kỹ thuật:**

- Log dạng JSON có traceId/requestId xuyên suốt 1 request (dùng middleware sinh requestId, truyền qua context).

- Endpoint /health kiểm tra kết nối DB, Redis (nếu có), thời gian phản hồi.

**Tiêu chí đánh giá / test case gợi ý:**

- Một giao dịch lỗi có thể trace lại toàn bộ log liên quan chỉ bằng 1 requestId.

- /health trả về 200 khi hệ thống khỏe mạnh, 503 khi DB mất kết nối (test bằng cách tắt DB tạm thời).

# 8. Module 7 — Kiểm thử các kịch bản khó

### 7.1. Unit test cho logic tính số dư & validation

**Mục tiêu nghiệp vụ:** Đảm bảo các quy tắc nghiệp vụ (hạn mức, số dư âm, trạng thái tài khoản) được test riêng biệt, không phụ thuộc DB thật.

**Yêu cầu kỹ thuật:**

- Dùng Jest, mock repository/service, test các trường hợp biên: số dư = 0, số dư âm, đúng bằng hạn mức, vượt hạn mức 1đ.

**Tiêu chí đánh giá / test case gợi ý:**

- Coverage cho các service nghiệp vụ chính (transaction, account) đạt tối thiểu 80%.

- Có test case cho mọi nhánh lỗi nghiệp vụ (không chỉ happy path).

### 7.2. Integration test giả lập concurrency

**Mục tiêu nghiệp vụ:** Kiểm chứng tự động (không phải chỉ test tay) rằng cơ chế lock ở Module 1 hoạt động đúng.

**Yêu cầu kỹ thuật:**

- Viết test dùng Promise.all bắn N request đồng thời vào API thật (test DB riêng, không dùng DB production), assert số dư cuối cùng chính xác tuyệt đối.

- Có thể dùng thêm k6 hoặc autocannon để đo throughput/latency khi có lock so với không có lock.

**Tiêu chí đánh giá / test case gợi ý:**

- Test chạy được trong CI (không flaky — chạy lại nhiều lần vẫn cho kết quả đúng).

### 7.3. Test rollback khi giao dịch lỗi giữa chừng

**Mục tiêu nghiệp vụ:** Đảm bảo không có trạng thái dữ liệu 'nửa vời' khi có lỗi bất ngờ (ví dụ mất kết nối DB giữa 2 bước ghi sổ).

**Yêu cầu kỹ thuật:**

- Giả lập lỗi (throw exception) ngay sau bước ghi nợ tài khoản A, trước khi ghi có tài khoản B, bên trong cùng 1 transaction.

- Assert rằng sau khi rollback, tài khoản A KHÔNG bị trừ tiền (transaction toàn vẹn, không có ledger entry nào được ghi).

**Tiêu chí đánh giá / test case gợi ý:**

- Không tồn tại ledger entry 'mồ côi' (chỉ có DEBIT mà không có CREDIT tương ứng) sau khi test.

# 9. Gợi ý lộ trình thực hiện

Với thực tập sinh đã nắm CRUD cơ bản, có thể triển khai theo thứ tự sau (khoảng 1 tuần cho mỗi module, có thể làm song song nếu có nhiều bạn):

- Tuần 1: Module 1 (Concurrency) — đây là nền tảng, nên làm trước tiên và làm kỹ.

- Tuần 2: Module 3 (Ledger & Audit Trail) — thay đổi mô hình dữ liệu cốt lõi, nên làm sớm trước khi thêm tính năng khác.

- Tuần 3: Module 2 (Idempotency) + Module 5 (Validation nâng cao).

- Tuần 4: Module 4 (Bảo mật & Phân quyền).

- Tuần 5: Module 6 (Đối soát & Giám sát) + Module 7 (Testing) — làm song song xuyên suốt các module trước, không nên để tới cuối mới viết test.

Lưu ý: Module 1 và Module 3 nên coi là bắt buộc / ưu tiên cao nhất vì đây là hai vấn đề nền tảng của mọi hệ thống ngân hàng thật; các module còn lại có thể chọn lọc theo thời gian thực tập còn lại.
