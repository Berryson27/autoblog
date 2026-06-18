# 📦 `cousting Setup 2.0.2.exe` 설치 파일 분석 보고서

> 작성일: 2026-06-07
> 분석 방식: EXE 실행 없이 정적 추출(unpack)
> 추출 도구: `7zr.exe` (Docker 번들, v26.00)

---

## 1. 요약 (Executive Summary)

| 항목 | 내용 |
|------|------|
| 파일명 | `cousting Setup 2.0.2.exe` |
| 크기 | 95,558,656 바이트 (약 92 MiB) |
| 설치 프로그램 종류 | **NSIS (Nullsoft) 인스톨러** — `electron-builder`로 생성 |
| 내부 압축 형식 | 7z (LZMA2 + BCJ2), 6,879개 파일 / 1,273개 폴더 (해제 시 약 307 MB) |
| 애플리케이션 유형 | **Electron 데스크톱 앱** (Node.js + Chromium) |
| 앱 이름 / 버전 | `cousting` (쿠스팅) v2.0.2 |
| 제작자 | "AI개발좌" |
| 핵심 기능 | **쿠팡 상품 크롤링 → Gemini AI 글 생성 → 네이버 블로그 자동 포스팅** (제휴마케팅 자동화 툴) |

---

## 2. 설치 파일 구조 분석

### 2.1 인스톨러 판별
파일 헤더에서 `Nullsoft`, `NSIS` 마커가 확인됨 → NSIS 기반 설치 파일.
electron-builder가 생성하는 전형적인 NSIS 포맷이며, 본체는 7z 블록으로 압축되어 있어 `7z x` 로 그대로 해제 가능했습니다.

### 2.2 최상위 추출 결과 (`extracted_cousting\`)
Electron 런타임 + 앱 본체가 들어있는 표준 구성입니다.

| 파일/폴더 | 크기 | 설명 |
|-----------|------|------|
| `cousting.exe` | 155.8 MB | Electron 메인 실행 파일 (Chromium 포함) |
| `resources\` | — | **앱 소스 + 데이터 (핵심)** |
| `locales\` | — | Chromium 언어팩 |
| `*.dll` (ffmpeg, libGLESv2, vulkan-1, vk_swiftshader 등) | — | Chromium/그래픽 런타임 |
| `icudtl.dat`, `*.pak`, `*.bin` | — | Chromium 리소스/스냅샷 |
| `LICENSES.chromium.html`, `LICENSE.electron.txt` | — | 라이선스 |

→ 즉, **순수 Electron 앱**이며 별도 서비스/드라이버 설치는 없습니다.

---

## 3. 애플리케이션 본체 (`resources\`)

### 3.1 `resources\` 직속 파일

| 파일 | 크기 | 설명 |
|------|------|------|
| `app\` | — | 실제 Node.js 앱 소스 (아래 상세) |
| `.env.enc` | 1,921 B | **AES-256-CBC로 암호화된 환경변수 파일** (API 키·DB 접속정보 추정) |
| `blog_posts.db` | 335 KB | SQLite DB (블로그 포스트 데이터) |
| `blogposts.db` | 12 KB | SQLite DB (보조) |
| `elevate.exe` | 107 KB | 권한 상승 헬퍼 (electron-builder 표준 동봉) |
| `99.data\`, `public\` | — | 런타임 데이터/이미지 디렉터리 |

### 3.2 `resources\app\` 소스 구조

```
app/
├── main.js          ← Electron 메인 프로세스 (진입점)
├── app.js           ← Express 서버 (포트 3005, 내부 웹 UI/API)
├── preload.js       ← 렌더러 브릿지
├── package.json     ← 앱 메타/의존성
├── icon.ico
├── models/          ← MongoDB(mongoose) 스키마
│   ├── user.js, ad.js, blockedUser.js, postdata.js, Version.js
└── src/             ← 핵심 비즈니스 로직
    ├── 0.api_save_json.js   (11KB)  쿠팡 상품 API 검색·저장
    ├── 0.new_save_json.js   (3.5KB)
    ├── 1.crawling.js        (21KB)  쿠팡 크롤러 (Puppeteer)
    ├── 2.AI.gemini.js       (28KB)  Gemini AI 블로그 글 생성
    ├── 3.posting.js         (52KB)  네이버 블로그 자동 포스팅
    ├── 9.ads_youtube.js     (9KB)   유튜브 광고 관련
    ├── 99.open_chrome.js            크롬 실행 헬퍼
    ├── db.js                        MongoDB 연결
    ├── droppost.js, postmanagement.js, up_postdata.js
    ├── yesmylord.js                 (라우트 모듈)
    ├── log.html / log.js            실시간 로그 뷰어
    └── start_ad.js, output.json
```

---

## 4. 동작 방식 (코드 기반 추정)

소스를 정적으로 읽어 파악한 전체 파이프라인:

1. **앱 시작 (`main.js`)**
   - `.env.enc` 파일을 **AES-256-CBC로 복호화**하여 환경변수(`MONGODB_URI`, API 키 등)를 메모리에 로드합니다. 복호화 실패 시 앱을 즉시 종료합니다.
   - 내부적으로 `app.js`(Express 서버, 포트 3005)를 띄워 웹 UI/API를 제공합니다.
   - Google OAuth (`google-auth-library`)로 사용자 인증 처리.

2. **상품 수집 (`0.api_save_json.js`, `1.crawling.js`)**
   - 쿠팡 상품을 API 검색 + Puppeteer 크롤링으로 수집합니다.
   - Puppeteer는 시스템에 설치된 Chrome(`C:\Program Files\Google\Chrome\...`)을 직접 구동하며, `--disable-web-security`, `--disable-blink-features=AutomationControlled` 등 **봇 탐지 회피 옵션**과 stealth 플러그인을 사용합니다.

3. **AI 글 생성 (`2.AI.gemini.js`)**
   - Google Gemini(`@google/generative-ai`)로 상품 리뷰 블로그 글을 자동 생성합니다.
   - `prompt.json` 프롬프트와 상품 데이터를 조합하며, 기본 프롬프트는 "상품 리뷰 전문 블로거" 역할입니다.
   - `sharp`로 이미지 가공.

4. **블로그 포스팅 (`3.posting.js`)**
   - `NaverBlogAutoPost` 클래스가 Puppeteer로 **네이버 블로그에 자동 게시**합니다.
   - 게시 이력을 MongoDB(`PostData`: googleAccount, postTime, ipAddress, usertype[paid/free] 등)에 기록합니다.

5. **데이터 저장**
   - 원격: MongoDB (mongoose) — 사용자/광고/포스팅 데이터
   - 로컬: SQLite (`blog_posts.db`) + JSON 파일(`99.data/`)

---

## 5. 주요 기술 스택 (`package.json` 의존성)

| 분류 | 패키지 |
|------|--------|
| 데스크톱 | electron, electron-shortcut |
| 웹/서버 | express, express-session, multer |
| 브라우저 자동화 | puppeteer, puppeteer-extra, **puppeteer-extra-plugin-stealth**, random-useragent |
| AI | @google/generative-ai, openai |
| DB | mongoose, mongodb, sqlite3 |
| 클라우드/인증 | @google-cloud/storage, google-auth-library |
| 파싱/유틸 | cheerio, csv-*, xml2js, fast-xml-parser, sharp, axios, request |

---

## 6. 보안 관점 메모

> ⚠️ 연습/분석 목적의 참고용 메모입니다.

- **`.env.enc` (1.9KB)**: AES-256-CBC로 암호화된 시크릿 파일. `main.js`에 **복호화 키가 평문으로 하드코딩**되어 있고 IV는 파일 앞에 동봉(`iv:ciphertext` 형식)되어 있습니다. 즉, 배포된 앱만 있으면 누구나 복호화가 기술적으로 가능한 구조입니다 → MongoDB 접속정보·API 키 노출 위험. (본 분석에서는 시크릿을 실제로 복호화/추출하지 않았습니다.)
- **봇 탐지 회피**: stealth 플러그인 + `--disable-web-security` 사용. 쿠팡/네이버의 자동화 정책 및 이용약관 위반 소지가 있습니다.
- 로컬 SQLite DB(`blog_posts.db`)에 과거 포스팅 데이터가 남아 있을 수 있습니다.

---

## 7. 산출물 위치

- 추출된 전체 파일: `C:\Users\User\OneDrive\Desktop\DM\extracted_cousting\`
- 핵심 소스: `extracted_cousting\resources\app\src\`
- 본 보고서: `C:\Users\User\OneDrive\Desktop\DM\cousting_분석보고서.md`

---

## 8. 재현 방법 (참고)

```powershell
# NSIS/electron-builder exe는 7-Zip으로 그대로 해제 가능
7z x "cousting Setup 2.0.2.exe" -o"extracted_cousting" -y
```
