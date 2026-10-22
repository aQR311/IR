# Appota IR & Equity Hub — Phase 0

Quản trị nhà đầu tư (tiềm năng → cổ đông → exit), Cap Table dạng sổ cái, ESOP, SAFE, kho tài liệu mã hoá và nhật ký kiểm toán.

Stack: Next.js 16 · Prisma 6 · PostgreSQL (Supabase) · Vercel · GitHub.

## Chạy trên máy dev

```bash
npm install
cp .env.example .env        # rồi sinh DATA_KEY, AUTH_PEPPER (lệnh có trong file); đặt ALLOW_DEV_LOGIN="true"
npm run db:local            # Postgres cục bộ (để cửa sổ này chạy), dữ liệu nằm ngoài OneDrive
npm run db:migrate          # tạo bảng + trigger bảo mật
npm run db:seed             # dữ liệu mẫu hư cấu
npm run dev                 # mặc định http://localhost:3000 — APP_URL phải khớp cổng
```

Kiểm tra: `npm run typecheck`, `npm run lint`, `npm test`.

## Đã có trong Phase 0

| Mảng | Nội dung |
|---|---|
| Đăng nhập | Lark OAuth (kiểm tra `tenant_key`), Google Workspace OIDC (kiểm tra `hd` + chữ ký id_token), OTP email cho người ngoài. Không có mật khẩu. Tài khoản phải được cấp trước; lần đầu gắn định danh SSO, sau đó phải khớp. |
| Phiên | Lưu ở DB (thu hồi được ngay), cookie chỉ chứa token ngẫu nhiên. Nội bộ: idle 60 phút / tối đa 10 giờ. Bên ngoài: 30 phút / 4 giờ, kèm hạn truy cập tài khoản. |
| Phân quyền | 10 vai trò + ghi đè quyền xem tiền theo từng người. IT (`SYS_ADMIN`) quản lý tài khoản nhưng không xem được dữ liệu vốn. Kiểm tra ở server cho mọi trang, action và route. |
| Nhà đầu tư | Vòng đời: Tiềm năng → … → Cổ đông → Exit một phần → Đã exit. Trạng thái cổ đông/exit do sổ cái tự cập nhật. Có đầu mối liên hệ, lịch sử tương tác, KYC. |
| Cap Table | Sổ cái chỉ ghi thêm; số dư và % luôn tính lại từ sổ cái. Có cơ sở / pha loãng hoàn toàn, theo lớp, theo nhóm, cổ đông lớn (ngưỡng cấu hình), tỷ lệ sở hữu nước ngoài. |
| Maker–checker | Giao dịch tạo ở dạng nháp; người ghi sổ phải khác người tạo. Kiểm tra số dư khi ghi sổ. Sai thì tạo bút toán đối ứng, không được sửa. |
| ESOP | Bể nhiều đợt, cấp quyền với cliff/vesting tháng–quý–năm, nghỉ việc thì thu hồi phần chưa vest, thực hiện quyền → giao dịch phát hành nháp. |
| SAFE | Ghi nhận cap, chiết khấu, lãi suất. Công thức chuyển đổi đã có và đã test (dùng ở phase Mô phỏng). |
| Tài liệu | Upload có kiểm tra chữ ký file, mã hoá AES-256-GCM trước khi lưu, tải qua route có kiểm tra quyền + audit + kiểm tra SHA-256. |
| Audit | Mọi thao tác nhạy cảm (đăng nhập, xem KYC, ghi sổ, xuất CSV, tải file, đổi quyền) đều ghi audit; chuỗi HMAC phát hiện được nếu bị sửa. |
| Cổng NĐT | `/portal`: nhà đầu tư chỉ thấy sở hữu và chứng từ của chính mình. |

## Các lớp bảo vệ

1. **Ngoài tầm app (trong DB):** trigger chặn sửa/xoá audit log; chặn sửa/xoá giao dịch đã ghi sổ; chặn INSERT thẳng dòng POSTED; bắt buộc maker ≠ checker; CHECK ràng buộc các bên của giao dịch. Đã thử tấn công trực tiếp bằng SQL: cả 6 kiểu đều bị chặn.
2. **Supabase:** bảng nằm ở schema `irhub` (không phải `public`) nên Data API không expose. Bật RLS không policy trên mọi bảng, thu hồi quyền của `anon` / `authenticated`. Trình duyệt không bao giờ cầm key Supabase.
3. **Mã hoá ở tầng app:** CCCD, tài khoản ngân hàng và toàn bộ file được mã hoá bằng khoá nằm trên Vercel, không nằm trong Supabase. Bản mã gắn với ngữ cảnh (AAD) nên không bê sang dòng khác được. Có `keyId` để xoay khoá.
4. **Xác thực bước cao:** xem KYC và xuất Cap Table cần đã đăng nhập trong 15 phút gần nhất.
5. **HTTP:** CSP chặt, `frame-ancestors 'none'`, HSTS, `no-store` cho mọi trang, server action có kiểm tra Origin. Lỗi đăng nhập chỉ hiển thị theo mã cố định (không phản chiếu chuỗi từ URL).
6. **Chống dò:** giới hạn 5 lần sai / email và 20 lần sai / IP trong 15 phút. OTP 6 số, 10 phút, tối đa 5 lần thử, chỉ dùng một lần. Phản hồi giống nhau dù email có tồn tại hay không.

## Go-live: thứ tự làm

1. **Supabase production** (Pro, Singapore) + **Supabase staging** (Free). Mỗi project lấy 2 chuỗi kết nối (xem mục Supabase bên dưới). Tạo bucket private `irhub-private` ở cả hai.
2. **Google OAuth** (Internal): redirect `https://<domain>/api/auth/google/callback`.
3. **Vercel**: import repo, region `sin1`. Khai biến môi trường cho **Production** (DB production) và **Preview** (DB staging), mỗi môi trường một bộ `DATA_KEY` / `AUTH_PEPPER` riêng. Giai đoạn đầu chỉ có người nội bộ thì đặt `MAIL_DRIVER=disabled`.
4. Deploy lần đầu: build tự chạy `prisma migrate deploy` để tạo bảng.
5. **Tạo admin đầu tiên** từ máy bạn, trỏ vào DB production bằng một file env riêng (không commit):
   ```powershell
   $env:DOTENV_CONFIG_PATH=".env.production.local"
   npm run bootstrap -- --email it@appota.com --name "Tên IT" --role SYS_ADMIN
   npm run bootstrap -- --email cfo@appota.com --name "Tên CFO" --role EXEC
   ```
   Lệnh chỉ chạy được khi vai trò đó chưa có ai. Các tài khoản khác tạo trong màn hình **Tài khoản**.
6. Đăng nhập bằng CEO/CFO (hoặc Pháp chế) → **Cấu hình vốn**: tạo lớp cổ phần và vòng gọi vốn.
7. **Nhập dữ liệu**: tải file mẫu → điền trong Excel → Lưu thành **CSV UTF-8** → Kiểm tra → Nhập. Nhập nhà đầu tư trước, giao dịch sau. Lô giao dịch phải được một người khác (Kế toán/CEO) bấm **Ghi sổ cả lô**.
8. Đối chiếu Cap Table với sổ cổ đông giấy / Excel cũ trước khi dùng chính thức.

**Quy trình sửa sau go-live:** sửa trên nhánh riêng → push → Vercel tạo link Preview (DB staging) → xem ổn thì merge vào `main` → tự deploy production. Migration chỉ thêm bảng/cột, không xoá, nên dữ liệu đã nhập không mất.

## Triển khai lên Supabase + Vercel + GitHub

### GitHub
- Repo **private** trong organization Appota, bắt buộc 2FA.
- Branch protection cho `main`: phải có PR + review, không force-push.
- Bật Secret scanning + Push protection, Dependabot, CodeQL.
- `.env*` đã nằm trong `.gitignore` (trừ `.env.example`).

### Supabase
1. Tạo project ở region **Singapore** (`ap-southeast-1`), gói **Pro** trở lên để có backup PITR.
2. Dashboard: bắt buộc 2FA, chỉ 1–2 owner.
3. Settings → API: **không** thêm schema `irhub` vào "Exposed schemas".
4. Storage: tạo bucket **private** `irhub-private`.
5. Lấy chuỗi kết nối:
   - `DATABASE_URL` = pooler (port 6543) + `?pgbouncer=true&schema=irhub`
   - `DIRECT_URL` = kết nối trực tiếp (port 5432) + `?schema=irhub`
6. Bảng tạo mới ở migration sau **phải** tự bật RLS (xem `20261022081245_security_hardening`).

### Vercel
1. Import repo GitHub. Vercel tự dùng script `vercel-build` (generate + `migrate deploy` + build), không cần sửa Build Command.
2. Function Region: `sin1` (cùng vùng Supabase).
3. Biến môi trường (đánh dấu **Sensitive**): theo `.env.example`. Production phải có `MAIL_DRIVER=resend` hoặc `disabled`, `STORAGE_DRIVER=supabase`, `APP_URL=https://…`, `ALLOW_DEV_LOGIN=false`. App tự từ chối khởi động nếu cấu hình production sai.
4. Bật Deployment Protection cho Preview; Preview dùng DB Supabase riêng, không dùng DB thật.
5. Bật WAF / rate limit cho `/login` và `/api/auth/*`.

### Lark & Google
- **Lark Open Platform:** tạo app nội bộ; redirect URL `https://<domain>/api/auth/lark/callback`; lấy `LARK_TENANT_KEY` của tenant Appota. Endpoint đang dùng: `accounts.larksuite.com/open-apis/authen/v1/authorize`, `open.larksuite.com/open-apis/authen/v2/oauth/token`, `/authen/v1/user_info`. Cần thử lại với app thật.
- **Google Cloud:** OAuth client loại "Web", consent screen **Internal**; redirect `https://<domain>/api/auth/google/callback`.

### Pháp lý dữ liệu
CCCD và tài khoản ngân hàng là dữ liệu cá nhân nhạy cảm, nay lưu ở Singapore → Pháp chế cần lập hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài theo Luật Bảo vệ dữ liệu cá nhân trước khi nhập dữ liệu thật.

## Chưa làm (các phase sau)
- P1: engine phê duyệt nhiều tầng (chờ ma trận duyệt), bảng điều phối thủ tục, mẫu văn bản, đợt kiểm toán, import ESOP / SAFE từ file, passkey cho NĐT, webhook Lark khi nhân sự nghỉ việc → thu hồi phiên.
- P2: Data Room có watermark, bản tin IR, lấy ý kiến cổ đông / biểu quyết, báo cáo quản trị.
- P3: đồng bộ KPI, mô phỏng vòng gọi vốn & pha loãng, ký số, AI.
