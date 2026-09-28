/**
 * OCR 엔진 디스패처 — api/ocr.ts(실사용)와 api/admin-settings.ts(연결 테스트)가
 * 공유한다.
 *
 * 보안 원칙: OpenRouter/Gemini 키는 **서버 환경변수로만** 읽는다
 * (OPENROUTER_API_KEY / GEMINI_API_KEY). 과거 클라이언트 번들에 키가 실려
 * 유출된 전례가 있어, 어떤 경로로도 키가 브라우저에 내려가면 안 된다.
 * Google Vision / PostMath 의 부가 키는 sp_settings(관리자 전용 RLS)에 두되
 * 관리자 UI 에는 마스킹된 값만 돌려준다.
 */

export type OcrEngine = 'openrouter' | 'gemini';

export type OcrConfig = {
  engine?: OcrEngine;
  /** OpenRouter 비전 모델 — 기본 google/gemini-3.7-flash */
  openrouterModel?: string;
};

/** 저장값 무해화 — 제거된 엔진(postmath/google_vision 레거시 저장값)은 기본으로 폴백 */
export function sanitizeEngine(e: unknown): OcrEngine {
  return e === 'gemini' ? 'gemini' : 'openrouter';
}

export const DEFAULT_OCR_PROMPT = `이 이미지는 학생이 스마트펜으로 종이에 쓴 손글씨입니다.
이미지 속 손글씨를 정확히 읽어 텍스트로 옮겨 적어주세요.
- 수식이 있으면 LaTeX 로 표기하고 $...$ 로 감싸주세요.
- 읽을 수 없는 글자는 □ 로 표시해주세요.
- 설명 없이 옮겨 적은 내용만 출력하세요.`;

/** dataUrl(base64 image) → 인식 텍스트. 실패 시 사용자 표시용 메시지로 throw. */
export async function runOcr(
  cfg: OcrConfig,
  dataUrl: string,
  prompt: string = DEFAULT_OCR_PROMPT,
): Promise<string> {
  const engine = sanitizeEngine(cfg.engine);
  if (engine === 'gemini') return ocrGemini(dataUrl, prompt);
  return ocrOpenRouter(cfg, dataUrl, prompt);
}

async function ocrOpenRouter(
  cfg: OcrConfig,
  dataUrl: string,
  prompt: string,
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY 서버 환경변수가 설정되지 않았습니다.');
  }
  const model = cfg.openrouterModel?.trim() || 'google/gemini-3.7-flash';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://hicnc-penclass.vercel.app',
      'X-Title': 'PenClass OCR',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `OpenRouter 호출 실패 (${res.status}): ${detail.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

async function ocrGemini(dataUrl: string, prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 서버 환경변수가 없습니다.');
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('이미지 형식이 올바르지 않습니다.');
  const [, mimeType, base64Data] = match;
  const model = process.env.GEMINI_OCR_MODEL ?? 'gemini-3.7-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini 호출 실패 (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() ?? ''
  );
}
