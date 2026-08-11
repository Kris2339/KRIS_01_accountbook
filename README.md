# 우리집 가계부

두 사람이 휴대폰에서 함께 사용하는 PWA 가계부입니다. 정적 화면과 API는 Cloudflare Worker에서, 데이터는 Cloudflare D1에서 관리합니다. Supabase는 더 이상 사용하지 않습니다.

## 데이터 보호 원칙

- 모든 변경은 먼저 브라우저 `localStorage`에 저장되어 오프라인에서도 남습니다.
- D1에는 거래를 건별 행으로 저장하고 삭제된 거래도 soft-delete 상태로 보존합니다.
- 저장 버전이 다르면 HTTP 409로 중단하여 다른 기기의 변경을 조용히 덮어쓰지 않습니다.
- 서버 데이터가 로컬 데이터를 대체하기 전, 서로 다른 로컬 거래는 최대 3개의 복구 사본으로 보관합니다.
- D1 Time Travel과 JSON 내보내기를 함께 사용합니다.
- 6자리 공유 번호는 Worker 비밀 변수에만 보관하고, 로그인 세션은 서명된 `HttpOnly` 쿠키로 유지합니다.
- 같은 네트워크에서 10분 안에 5회 실패하면 10분 동안 로그인을 차단합니다.

## 로컬 개발

```powershell
wrangler d1 migrations apply hkaccount-production --local
wrangler dev --local
```

로컬 개발용 `.dev.vars`:

```text
LOCAL_DEV=true
```

## 운영 전 필수 항목

1. `wrangler.jsonc`의 D1 바인딩을 확인합니다.
2. `migrations/0001_initial.sql`을 운영 D1에 적용합니다.
3. Worker 비밀 변수 `APP_PIN`과 충분히 긴 무작위 `SESSION_SECRET`을 설정합니다.
4. 두 휴대폰에서 기존 데이터를 각각 내보낸 뒤 기준 파일을 정해 최초 동기화합니다.

자세한 복구 및 운영 절차는 `OPERATIONS.md`를 참고하세요.
