const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const {
  buildPrompt,
  createGenerationService,
  normalizeImages,
  toUserFacingGeminiError
} = require('../src/main/services/generationService');

test('generation prompt includes planning values and image placeholders', () => {
  const prompt = buildPrompt({
    writerProfile: '맛집 블로거',
    tone: '친근하게',
    targetAudience: '가족 외식 독자',
    topic: '대게 후기',
    storeInfo: '인천 대게집',
    seoKeyword: '인천 대게 맛집',
    seoNotes: '가격은 단정하지 말 것'
  }, [
    { name: 'crab.png', caption: '대게 한 상' }
  ]);

  assert.match(prompt, /맛집 블로거/);
  assert.match(prompt, /친근하게/);
  assert.match(prompt, /image_1/);
  assert.match(prompt, /<img src="image_1">/);
});

test('generation service creates a background job and stores generated text', async () => {
  const imagePath = path.join(os.tmpdir(), `autoclick-generation-${Date.now()}.png`);
  const png = new PNG({ width: 1, height: 1 });
  await fs.writeFile(imagePath, PNG.sync.write(png));

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: '## 제목\n\n본문\n<img src="image_1">' }]
              }
            }
          ]
        };
      }
    };
  };

  try {
    const service = createGenerationService({ fetchImpl, apiKey: 'test-key' });
    const started = await service.generatePost({
      images: [{ path: imagePath, name: 'image.png', mimeType: 'image/png' }],
      planning: { topic: 'topic' }
    });

    await waitFor(() => service.getGenerationResult(started.generationId), (result) => result.status === 'completed');
    const result = await service.getGenerationResult(started.generationId);

    assert.equal(result.status, 'completed');
    assert.match(result.aiResponse, /제목/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.contents[0].parts.length, 2);
  } finally {
    await fs.unlink(imagePath).catch(() => {});
  }
});

test('generation service fails clearly when api key is missing', async () => {
  const service = createGenerationService({ fetchImpl: async () => ({}), apiKey: '' });
  const started = await service.generatePost({
    images: [{ path: 'C:\\image.png', name: 'image.png' }],
    planning: {}
  });

  await waitFor(() => service.getGenerationResult(started.generationId), (result) => result.status === 'failed');
  const result = await service.getGenerationResult(started.generationId);
  assert.match(result.error, /GOOGLE_GENAI_API_KEY/);
});

test('normalizeImages caps images at 30', () => {
  const images = Array.from({ length: 31 }, (_, index) => ({
    path: `C:\\${index}.png`
  }));

  assert.equal(normalizeImages(images).length, 30);
});

test('generation service maps depleted credit errors', () => {
  const message = toUserFacingGeminiError('Your prepayment credits are depleted.', 429);
  assert.match(message, /크레딧이 소진/);
});

async function waitFor(read, predicate) {
  for (let i = 0; i < 30; i += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}
