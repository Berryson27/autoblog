const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { getImageMimeType } = require('./imageAssetService');

const MODEL_NAME = 'gemini-3.1-flash-lite';
const MAX_IMAGES = 30;

function createGenerationService({ fetchImpl = globalThis.fetch, apiKey = resolveApiKey() } = {}) {
  const jobs = new Map();

  async function generatePost(payload) {
    const generationId = crypto.randomUUID();
    const job = {
      generationId,
      status: 'processing',
      aiResponse: '',
      error: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.set(generationId, job);

    runGeneration(job, payload, { fetchImpl, apiKey }).catch((error) => {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
    });

    return { generationId, status: job.status };
  }

  async function getGenerationResult(generationId) {
    const job = jobs.get(generationId);
    if (!job) throw new Error('생성 요청을 찾을 수 없습니다.');
    return { ...job };
  }

  return { generatePost, getGenerationResult };
}

async function runGeneration(job, payload, { fetchImpl, apiKey }) {
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY 환경변수가 필요합니다.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch를 사용할 수 없습니다.');

  const images = normalizeImages(payload.images);
  if (images.length === 0) throw new Error('이미지가 1장 이상 필요합니다.');

  const prompt = buildPrompt(payload.planning || {}, images);
  const imageParts = await createImageParts(images);
  const aiResponse = await callGemini({ fetchImpl, apiKey, prompt, imageParts });

  job.status = 'completed';
  job.aiResponse = aiResponse;
  job.updatedAt = new Date().toISOString();
}

function normalizeImages(images) {
  return [...(images || [])]
    .filter((image) => image && image.path && image.enabled !== false)
    .slice(0, MAX_IMAGES)
    .map((image, index) => ({
      id: image.id || image.path,
      path: image.path,
      name: image.name || image.path,
      mimeType: image.mimeType || getImageMimeType(image.path),
      order: index,
      caption: image.caption || ''
    }));
}

async function createImageParts(images) {
  const parts = [];
  for (const image of images) {
    const data = await fs.readFile(image.path);
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: data.toString('base64')
      }
    });
  }
  return parts;
}

function buildPrompt(planning, images) {
  const imageGuide = images
    .map((image, index) => {
      const caption = image.caption ? ` 설명: ${image.caption}` : '';
      return `- image_${index + 1}: ${image.name}${caption}`;
    })
    .join('\n');

  return [
    '너는 한국어 네이버 블로그 포스팅 작성자다.',
    '이미지와 사용자의 기획값을 바탕으로 자연스러운 블로그 초안을 작성해라.',
    '',
    '너는 단순히 글을 나열하는 사람이 아니라, 문장마다 "역할"을 판단해 알맞은 표현을 고르는 편집자다.',
    '',
    '출력 형식 규칙:',
    '- 제목은 첫 줄에 Markdown H2(## 제목)로 쓴다. 제목에는 SEO 키워드를 자연스럽게 포함한다.',
    '- 이미지를 넣을 위치에는 반드시 <img src="image_1"> 형식을 쓴다. image_1, image_2 번호는 아래 이미지 순서를 그대로 따른다.',
    '- 각 이미지는 본문 흐름에 맞춰 한 번씩 자연스럽게 배치한다.',
    '- 본문 흐름(소주제)이 시작되는 자리에는 "### 소제목" 형식으로 짧은 소제목(명사구 한 줄)을 붙인다. 도입·마무리에는 붙이지 않아도 된다.',
    '- 핵심 문장을 강조할 때만 그 줄에 단독으로 "[QUOTE] 문장"을 쓴다(네이버 인용구로 변환됨). 스타일을 바꾸려면 [QUOTE2]~[QUOTE6]을 쓴다.',
    '- 구분선("---")은 글 전체에서 0~2개만, 도입↔본론↔마무리처럼 "큰 흐름"이 바뀔 때만 쓴다. 이미지마다·문단마다·섹션마다 넣지 않는다(남발 금지).',
    '- 마지막 줄에 태그를 쉼표로 구분해 한 줄로 적는다.',
    '',
    '편집 원칙 (단순 삽입이 아니라 "편집된 글"을 만든다):',
    '1. 구조: 도입 1~2문단 → 본문 2~4개 흐름(각 흐름은 "### 소제목"으로 시작) → 마무리 1문단. 각 문단은 2~4문장으로 짧게 끊는다.',
    '2. 인용구는 그 부분의 "핵심/감정의 정점 한 문장"에만 쓴다. 평범한 설명문은 인용구로 만들지 않는다.',
    '   - 사용량: 글 전체 2~4개, 한 흐름에 0~1개. 인용구를 연속으로 두 개 붙이지 않는다.',
    '   - 스타일은 역할에 맞게 1~2종만 일관되게 고른다: [QUOTE2] 라인=깔끔한 핵심 강조, [QUOTE3] 말풍선=후기·대화체, [QUOTE5] 포스트잇=꿀팁·메모, [QUOTE]=범용.',
    '3. 리듬: 본문 → (이미지) → 본문 → (가끔 인용구)처럼 형태를 번갈아 배치해 단조롭지 않게 한다.',
    '4. 절제: 강조는 적을수록 강하다. 모든 문단을 강조하거나 인용구를 남발하지 않는다.',
    '5. 곁다리 정보(주의·출처·팁)는 본문보다 짧고 가볍게 덧붙인다.',
    '',
    '내용 원칙:',
    '- 이미지에 실제로 보이는 것에 근거해 묘사한다.',
    '- 확인되지 않은 사실, 가격, 영업시간, 연락처는 단정하지 않는다.',
    '',
    '기획값:',
    `- 글쓴이 설정: ${planning.writerProfile || '맛집 블로거'}`,
    `- 말투: ${planning.tone || '친근하고 정중하게'}`,
    `- 타깃 독자: ${planning.targetAudience || '블로그 방문자'}`,
    `- 주제: ${planning.topic || planning.storeInfo || '방문 후기'}`,
    `- 업체명/장소/상품: ${planning.storeInfo || '없음'}`,
    `- SEO 키워드: ${planning.seoKeyword || '없음'}`,
    `- 요청사항: ${planning.seoNotes || '없음'}`,
    '',
    '이미지 목록:',
    imageGuide
  ].join('\n');
}

async function callGemini({ fetchImpl, apiKey, prompt, imageParts }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL_NAME)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            ...imageParts
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 1,
        topP: 1,
        maxOutputTokens: 8192
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toUserFacingGeminiError(body?.error?.message, response.status));
  }

  const text = (body.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();

  if (!text) throw new Error('생성 결과가 비어 있습니다.');
  return text;
}

function toUserFacingGeminiError(message, status) {
  const rawMessage = String(message || '');
  if (/prepayment credits are depleted|billing|prepay/i.test(rawMessage)) {
    return 'Gemini API 크레딧이 소진되었습니다. AI Studio에서 결제/크레딧을 충전하거나 사용 가능한 다른 API 키로 교체해야 합니다.';
  }
  return rawMessage || `Gemini 요청 실패 (${status})`;
}

function resolveApiKey() {
  return (
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    readEnvFileValue('GOOGLE_GENAI_API_KEY') ||
    readEnvFileValue('GEMINI_API_KEY') ||
    readEnvFileValue('GOOGLE_API_KEY') ||
    ''
  );
}

function readEnvFileValue(key) {
  const envPath = path.join(process.cwd(), '.env');
  if (!fsSync.existsSync(envPath)) return '';

  const content = fsSync.readFileSync(envPath, 'utf8');
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));

  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

module.exports = {
  MODEL_NAME,
  buildPrompt,
  createGenerationService,
  normalizeImages,
  resolveApiKey,
  toUserFacingGeminiError
};
