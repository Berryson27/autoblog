# 05. 메인 프로세스 · 서버 · 라이선스 (`main.js`, `app.js`, `models/`)

## main.js — Electron 진입점
1. **`decryptEnvFile()`**: `resources/.env.enc` 를 **AES-256-CBC**로 복호화해 환경변수(`MONGODB_URI`, `DB_NAME`, OAuth 등) 주입.
   - 키는 `process.env.ENCRYPTION_KEY` 없으면 **소스에 하드코딩된 기본키** 사용 → 배포본만 있으면 누구나 복호화 가능한 구조(보안 약점).
   - 복호화 실패 시 `app.quit()` — env 없으면 앱 자체가 안 뜸.
2. `require('./app')` 로 같은 프로세스에서 **Express 서버 기동**.
3. `initializeAppStructure()`: 최초 실행 시 `userData`에 `99.data`, `public/images` 등 폴더/기본 배너 복사.
4. `createWindow()`: 1400x950 `BrowserWindow` → `http://localhost:3005` 로드.
   - `nodeIntegration:false`, `contextIsolation:true`, `preload.js` 사용 (보안 기본값은 양호).
   - `aistudio.google.com` 만 외부 브라우저로 열도록 필터.

## app.js — Express 서버 (포트 3005)
- 정적 UI(`public/*.html`) + REST API 다수.
- **Google OAuth** (`/auth/google`, `/auth/google/callback`) 로 사용자 인증.
- 주요 API:
  - `/run-program` (POST): `choice`로 작업 트리거 — `1`=포스팅, `2`=크롤링, `3`=AI.
  - `/stop-program` (POST): 실행 중 인스턴스의 `stop()` 호출.
  - `/search-products`, `/search-category-products`: 쿠팡 상품 검색.
  - `/api/save-keys`, `/api/prompt`, `/api/post-settings`, `/save-post-wait`: 설정 저장.
  - `/get-version`, `/get-latest-version`, `/extend-paid-period`: 버전/유료기간 관리.
- **라이선스/차단 검사**: `/run-program` 진입 시 `User` 조회 → `status === 'block'` 이고 유료기간(`paidExpiryDate`)이 지났으면 403 거부.
- `runningPrograms` 객체로 작업별 실행상태/인스턴스 관리(중복 실행 방지, 중단 지원).

## models/ — MongoDB(mongoose) 스키마
| 모델 | 용도 |
|------|------|
| `user.js` | 사용자 계정(이메일/상태/유료만료일/loginIp 등) |
| `ad.js` | 광고 데이터 |
| `blockedUser.js` | 차단된 blog-id 목록 |
| `postdata.js` | 발행 이력 |
| `Version.js` | 앱 버전 정보 |

## 데이터/시크릿 자산 (resources/)
| 파일 | 내용 |
|------|------|
| `.env.enc` | 암호화된 DB 접속정보·키 (복호화 키가 코드에 노출) |
| `blog_posts.db` / `blogposts.db` | 로컬 SQLite (포스트 데이터) |
| `elevate.exe` | electron-builder 권한 상승 헬퍼 |

## 보안/운영 메모
- 복호화 키 하드코딩 → MongoDB 자격증명·API 정책 노출 위험.
- 모든 사용자 인증·차단·유료검사가 **중앙 MongoDB 1곳**에 의존 → 서버/네트워크 끊기면 동작 불가.
- 봇 탐지 회피 + 자동 포스팅은 쿠팡·네이버 약관 위반 소지(계정 정지 위험).
