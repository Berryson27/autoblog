# PicPost 입력/출력 흐름 분석 및 로컬 적용 방향

## 목적

`C:\test\picpost_t`의 이미지/텍스트 입력 및 출력 구조를 확인하고, 현재 `C:\autoclick`에 새 기능을 로컬 기준으로 만든다고 가정했을 때 참고할 구조를 정리한다.

실제 구현 수정은 하지 않는다.

## 분석 대상

- `C:\test\picpost_t\src\features\newpost`
- `C:\test\picpost_t\src\features\my-postings`
- `C:\test\picpost_t\src\components\organisms\PostDetailContent.tsx`
- `C:\test\picpost_t\src\components\organisms\PostDetailModal.tsx`

## PicPost의 핵심 구조

PicPost는 Next.js + Firebase 기반이다.

입력은 클라이언트에서 이미지와 글 생성 옵션을 모은 뒤, 이미지를 Firebase Storage에 업로드하고 Firestore에 생성 작업 상태를 저장한다. 출력은 Firestore의 생성 결과와 Storage 이미지 URL을 다시 읽어서 상세 화면에 표시한다.

현재 `autoclick`에 그대로 옮기면 안 되는 부분:

- Firebase Auth
- Firestore 저장
- Firebase Storage 업로드
- Cloud Functions 호출
- 서버 백그라운드 생성 상태 관리

로컬 앱에 가져올 만한 부분:

- 이미지 선택/정렬/캡션 구조
- 텍스트 입력 모델
- 이미지와 텍스트를 순서 기반 블록으로 다루는 방식
- 생성 결과를 HTML 또는 블록 목록으로 조립하는 방식

## 이미지 입력 흐름

PicPost의 진입점은 `NewPostImageUploader.tsx`다.

흐름:

1. 사용자가 파일 선택 또는 드래그 앤 드롭으로 이미지 입력
2. 파일 개수 제한 확인
3. 중복 파일 확인
4. 빈 파일, 용량 초과, MIME 타입 불일치 확인
5. HEIC 등 미지원 포맷 감지 또는 JPEG 변환
6. 썸네일용 이미지 생성
7. 본문용 이미지 압축
8. `newPostInputStore.inputs.images`에 이미지 배열 저장
9. 이미지 에디터 모달에서 순서, 캡션, 설정 수정

PicPost 이미지 데이터의 핵심 필드:

- `id`: 이미지 식별자
- `url`: UI 표시용 URL
- `thumbnailUrl`: 썸네일 URL
- `file`: 원본 File
- `processedImage.blob`: 생성/업로드에 쓸 압축 이미지
- `order`: 출력 순서
- `alt`: 대체 텍스트
- `caption`: 이미지 설명
- `skipAIGeneration`: AI 생성 제외 여부

로컬 적용 시에는 Firebase URL 대신 로컬 파일 경로 또는 로컬 Blob/Buffer를 쓰면 된다.

## 텍스트 입력 흐름

PicPost의 텍스트 입력은 `newPostInputStore.inputs`에 모인다.

핵심 입력값:

- `topic`: 주제
- `title`: 제목
- `lengthProfile`: 글 길이 유형
- `proText`: 전문가 모드 상세 지시
- `blogger.description`: 작성자/말투 설정
- `blogger.customTone`: 문체
- `blogger.targetAudience`: 대상 독자
- `seo.keyword`: 키워드
- `seo.notes`: SEO 요청사항
- `storeInfo.name`: 업체/가게명
- `storeInfo.summary`: 업체 설명
- `images`: 이미지 배열

현재 `autoclick`의 단순 입력 구조와 비교하면, PicPost는 텍스트를 본문 하나로 받는 게 아니라 “생성 지시 데이터”로 받는다.

로컬 기준으로 새로 만든다면 둘 중 하나를 선택해야 한다.

고치기 전:

- 현재처럼 제목, 본문 블록, 태그만 입력
- 구현이 단순함
- 자동 생성/재가공에는 약함

고치면:

- 주제, 대상 독자, 말투, SEO, 이미지 캡션을 분리 입력
- 나중에 AI 생성 또는 템플릿 생성 붙이기 쉬움
- UI와 데이터 구조가 커짐

## 생성/저장 흐름

PicPost의 생성 흐름은 `generationPipeline.ts`가 조율한다.

흐름:

1. 현재 입력값과 이미지 배열 읽기
2. 이미 압축된 이미지와 새로 압축해야 하는 이미지 분리
3. 이미지 업로드
4. Firestore에 `newPosts/{postId}` 문서 생성
5. Cloud Function 호출
6. 서버가 AI 응답을 만들고 Firestore 상태를 `completed` 또는 `error`로 갱신
7. My Postings에서 결과를 조회

로컬 적용 시에는 이 흐름을 다음처럼 줄이는 게 맞다.

1. 로컬 입력값 읽기
2. 이미지 파일 경로 검증
3. 이미지 순서와 캡션 정리
4. 로컬 draft 객체 생성
5. 네이버 에디터에 순서대로 삽입

Firebase식 “업로드 후 URL 기반 출력”은 로컬 자동화 앱에는 과하다.

## 출력 흐름

PicPost 출력은 `my-postings`와 공통 `PostDetailModal/PostDetailContent`가 담당한다.

핵심 방식:

- Firestore에서 저장된 post 문서 로드
- 이미지 배열을 `order` 기준으로 정렬
- AI 응답 안의 이미지 placeholder를 실제 이미지 URL로 치환
- 최종 HTML을 `dangerouslySetInnerHTML`로 표시
- 복사, 수정, 발행 상태 변경 기능 제공

이미지 치환 흐름:

- AI 응답에 `image_1`, `image_2` 또는 이미지 표시 placeholder가 들어 있음
- `useEnhancedAIResponse`와 `ContentParser`가 이미지 배열과 매칭
- 실제 URL을 가진 이미지 태그로 바꿔 출력

로컬 적용 시에는 HTML 출력보다 블록 출력이 더 안전하다.

추천 로컬 출력 모델:

- `text` 블록: 본문 텍스트
- `image` 블록: 로컬 이미지 경로 + 캡션
- `tags` 블록: 태그 문자열

이 모델은 현재 `autoclick`의 네이버 입력 방식과 잘 맞는다.

## 로컬 앱에 가져올 설계

추천 구조:

- `draftInput`: 사용자가 입력한 원본 값
- `draftBlocks`: 네이버에 삽입할 순서형 블록
- `imageAssets`: 로컬 이미지 파일 정보
- `draftPreview`: 삽입 전 미리보기용 데이터

로컬 이미지 데이터:

- `id`
- `path`
- `name`
- `mimeType`
- `order`
- `caption`
- `enabled`

로컬 텍스트 데이터:

- `title`
- `blogId`
- `blocks`
- `tags`
- 선택 확장값: `topic`, `tone`, `targetAudience`, `seoKeyword`

## 현재 autoclick 기준 판단

지금 `autoclick`은 네이버 글쓰기 자동 입력 도구다.

PicPost처럼 Firebase 기반 생성 시스템을 붙이는 건 방향이 아니다. 대신 PicPost의 “입력 모델”만 참고해서 로컬 draft 구조를 조금 더 명확히 만드는 게 맞다.

권장 개선:

1. 이미지 블록에 캡션 필드 추가
2. 이미지 순서 변경 기능 추가
3. 본문 블록과 이미지 블록을 하나의 `draftBlocks`로 통합 유지
4. 네이버 삽입 전 미리보기 영역 추가
5. 로컬 파일 검증을 `imageAssetService`로 분리

비권장:

- Firestore 비슷한 저장 구조 만들기
- Firebase Storage 같은 업로드 단계를 로컬 앱에 흉내 내기
- AI 응답 placeholder 치환 구조를 그대로 가져오기
- HTML 기반 출력 모델로 바꾸기

## 결론

PicPost의 핵심은 “이미지 배열 + 텍스트 생성 입력 + 생성 결과 HTML 출력”이다.

`autoclick`에 맞는 핵심은 그중 “이미지 배열 + 순서형 텍스트/이미지 블록”까지만 가져오는 것이다.

현재 구조에서 다음 단계로 가장 적당한 개선은 Firebase식 파이프라인이 아니라 로컬 draft 모델 정리다.

