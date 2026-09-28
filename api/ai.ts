import { gradingOcrPrompt } from './_korean-grading.js';
import { gunzipSync } from 'node:zlib';
import { requireCaller } from './_lib.js';
import { runOcr, sanitizeEngine, type OcrConfig } from './_ocr-engines.js';
import {
  DEFAULT_ANALYSIS_PROMPT,
  isCurrentAssessment,
  KOREAN_STYLE_RULES,
  extractFeatures,
  runAnalysisLLM,
  runLearnReportLLM,
  runTextLLM,
  type AnalysisReport,
  type StrokeLike,
} from './_analysis.js';

/**
 * 교재 과목 (027) — 허용 목록은 **여기 상수로** 둔다. 서버리스 함수는
 * `src/` 를 import 하지 못할 수 있어 클라이언트 정의(PAPER_SUBJECTS)를
 * 끌어다 쓸 수 없다. 모르는 값·미지정은 수학(027 이전 교재는 전부 수학).
 */
const SUBJECTS = ['수학', '영어', '국어', '과학'] as const;
type Subject = (typeof SUBJECTS)[number];
function pickSubject(v: unknown): Subject {
  return typeof v === 'string' && (SUBJECTS as readonly string[]).includes(v)
    ? (v as Subject)
    : '수학';
}

/**
 * AI 통합 엔드포인트 — POST { action, ... }
 * (Vercel Hobby 는 배포당 서버리스 함수 12개 제한이라 ocr / analyze /
 *  admin-settings 세 엔드포인트를 하나로 합쳤다)
 *
 *  - 'ocr'           { image }               선생님/관리자 — 손글씨 인식
 *  - 'analyze'       { submissionId, force } 선생님/관리자 — 필적 과정 분석
 *  - 'settings-get'                          관리자 — OCR 엔진·프롬프트 조회
 *  - 'settings-save' { ocr? analysisPrompt? }관리자 — 저장
 *  - 'settings-test' { ocr }                 관리자 — OCR 연결 테스트
 *
 * 보안: OpenRouter/Gemini 키는 서버 환경변수 전용(브라우저 미노출).
 * 엔진은 openrouter/gemini 만 지원 — 레거시 저장값(postmath 등)은
 * sanitizeEngine 이 기본(openrouter)으로 폴백한다.
 */
type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

// 1×1 픽셀 PNG — 연결 테스트용 최소 이미지
const TEST_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Body = {
  action?: string;
  /** 문항 채점 호출에만 전달. 일반 필기 OCR은 그대로 유지한다. */
  grading?: { subject: string; question: string };
  image?: string;
  /** OCR 커스텀 프롬프트 (라이브 주석 인식용) — 선택 */
  prompt?: string;
  submissionId?: string;
  force?: boolean;
  /** 분석 범위 — 그룹/페이지/문항 단위 스트로크 부분집합 (미지정 = 전체) */
  scope?: { key?: string; strokeIds?: string[] };
  /** 범위 전용 OCR 텍스트 (문항 지문+풀이) — 있으면 저장된 전체 OCR 대신 사용 */
  scopeOcrText?: string;
  /** 문항별 타임라인 요약 (클라이언트 계산) — 시도·재방문·난이도 판단 근거 */
  problemsContext?: string;
  /** 피드백 초안 — 현재 화면의 분석/OCR 을 그대로 쓸 때 */
  analysis?: AnalysisReport;
  ocrText?: string;
  ocr?: OcrConfig;
  analysisPrompt?: string;
  /** 학습분석 리포트 입력 — 전체 OCR + 문항별 타임라인 요약 (클라이언트 조립) */
  reportContext?: string;
  /** 교재 과목 — analyze·report 의 시스템 프롬프트를 고른다 (미지정 = 수학) */
  subject?: string;
};

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const body = (
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  ) as Body;
  const action = body.action ?? '';
  const subject = pickSubject(body.subject);

  // OCR 은 학생 라이브 주석 인식에도 쓰이므로 student 포함
  const roles: Array<'student' | 'teacher' | 'admin'> = action.startsWith(
    'settings',
  )
    ? ['admin']
    : action === 'ocr' && !body.grading
      ? ['student', 'teacher', 'admin']
      : ['teacher', 'admin'];
  const gate = await requireCaller(req, roles);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return;
  }
  const { caller, admin } = gate;

  try {
    // ---------- OCR ----------
    if (action === 'ocr') {
      const image = body.image ?? '';
      if (!/^data:image\/[a-z+]+;base64,.+/.test(image)) {
        res.status(400).json({ error: 'image 는 data URL(base64) 형식이어야 합니다.' });
        return;
      }
      const { data } = await admin
        .from('sp_settings')
        .select('value')
        .eq('key', 'ocr')
        .maybeSingle();
      const cfg = (data?.value ?? {}) as OcrConfig;
      if (body.grading && (
        typeof body.grading !== 'object' || !SUBJECTS.includes(body.grading.subject as Subject)
        || typeof body.grading.question !== 'string'
      )) {
        res.status(400).json({ error: '채점 과목과 문항 지문을 확인해 주세요.' });
        return;
      }
      const koreanGrading = body.grading?.subject === '국어';
      const promptLimit = koreanGrading ? 20000 : 4000;
      if (koreanGrading && typeof body.prompt === 'string' && body.prompt.length > promptLimit) {
        res.status(400).json({ error: '문항별 채점 지침이 너무 깁니다. 필요한 기준만 남겨 주세요.' });
        return;
      }
      const basePrompt =
        typeof body.prompt === 'string' && body.prompt.trim()
          ? body.prompt.slice(0, promptLimit)
          : undefined;
      const prompt = gradingOcrPrompt(basePrompt, body.grading);
      const text = await runOcr(cfg, image, prompt);
      res.status(200).json({ text, engine: sanitizeEngine(cfg.engine) });
      return;
    }

    // ---------- 필적 과정 분석 ----------
    if (action === 'analyze') {
      const submissionId = body.submissionId;
      if (!submissionId) {
        res.status(400).json({ error: 'submissionId 가 필요합니다.' });
        return;
      }
      const { data: sub } = await admin
        .from('sp_submissions')
        .select('id, student_id, teacher_id, strokes_path')
        .eq('id', submissionId)
        .maybeSingle();
      if (!sub) {
        res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
        return;
      }
      if (caller.role !== 'admin' && sub.teacher_id !== caller.id) {
        res.status(403).json({ error: '담당 제출이 아닙니다.' });
        return;
      }

      // 범위 분석 — 스트로크 부분집합(페이지/문항). 캐시도 범위별로 분리.
      const scope =
        body.scope &&
        Array.isArray(body.scope.strokeIds) &&
        body.scope.strokeIds.length > 0
          ? {
              key: String(body.scope.key || 'scope')
                .replace(/[^a-zA-Z0-9_-]/g, '-')
                .slice(0, 80),
              ids: new Set(body.scope.strokeIds.map(String)),
            }
          : null;
      const cachePath = scope
        ? `${sub.student_id}/${sub.id}.analysis.${scope.key}.json`
        : `${sub.student_id}/${sub.id}.analysis.json`;
      if (!body.force) {
        const { data: cached } = await admin.storage
          .from('sp-strokes')
          .download(cachePath);
        if (cached) {
          const report = JSON.parse(
            Buffer.from(await cached.arrayBuffer()).toString('utf-8'),
          ) as AnalysisReport;
          if (isCurrentAssessment(report.assessment, subject)) {
            res.status(200).json({ report, cached: true });
            return;
          }
        }
      }

      const { data: gz, error: dlErr } = await admin.storage
        .from('sp-strokes')
        .download(sub.strokes_path);
      if (dlErr || !gz) {
        res.status(404).json({ error: '필기 데이터를 찾을 수 없습니다.' });
        return;
      }
      const raw = gunzipSync(Buffer.from(await gz.arrayBuffer())).toString('utf-8');
      const all =
        (JSON.parse(raw) as { strokes?: StrokeLike[] }).strokes ?? [];
      const strokes = scope
        ? all.filter((s) => {
            const sid = (s as { id?: string }).id;
            return sid != null && scope.ids.has(String(sid));
          })
        : all;
      if (strokes.length === 0) {
        res.status(422).json({ error: '분석할 필기 데이터가 없습니다.' });
        return;
      }

      // 범위 전용 OCR(문항 지문+풀이)이 오면 그걸 우선 사용 — 문항 단위 분석에서
      // 정답 도출·오류 검출의 근거가 된다. 없으면 저장된 전체 OCR 폴백.
      let ocrText: string | null =
        typeof body.scopeOcrText === 'string' && body.scopeOcrText.trim()
          ? body.scopeOcrText.trim().slice(0, 12000)
          : null;
      if (!ocrText) {
        const { data: fb } = await admin
          .from('sp_feedback')
          .select('ocr_text, ocr_edited')
          .eq('submission_id', sub.id)
          .maybeSingle();
        ocrText = fb?.ocr_edited?.trim() || fb?.ocr_text?.trim() || null;
      }

      const { data: promptRow } = await admin
        .from('sp_settings')
        .select('value')
        .eq('key', 'analysis_prompt')
        .maybeSingle();
      // 학원 커스텀이 있으면 그것이 우선. 없으면 빈 문자열을 넘겨
      // runAnalysisLLM 이 **과목 기본 프롬프트**를 고르게 한다 (027).
      const systemPrompt =
        (promptRow?.value as { system?: string } | null)?.system?.trim() || '';

      const features = extractFeatures(strokes);
      // 🚨 컷을 8000 → 24000 으로 올렸다 (리뷰 확정 결함 2026-09-02): 32문항 교재는
      // 문항 컨텍스트만 8.6k 를 넘어, 맨 뒤에 붙는 "## 모범 풀이·답안" 블록이
      // 통째로 잘려 비교가 절대 나오지 않았다. 클라이언트도 지시문을 앞에 둔다.
      const problemsContext =
        typeof body.problemsContext === 'string'
          ? body.problemsContext.trim().slice(0, 24000)
          : null;
      const report = await runAnalysisLLM({
        features,
        ocrText,
        systemPrompt,
        subject,
        problemsContext,
        isFullScope: !scope, // scope 없음 = 제출(문제지) 전체 종합
      });

      await admin.storage
        .from('sp-strokes')
        .upload(cachePath, Buffer.from(JSON.stringify(report)), {
          contentType: 'application/json',
          upsert: true,
        })
        .catch(() => {});

      res.status(200).json({ report, cached: false });
      return;
    }

    // ---------- 학습분석 리포트 — 문제지 단위 채점·펜데이터 분석 ----------
    if (action === 'report') {
      const submissionId = body.submissionId;
      if (!submissionId) {
        res.status(400).json({ error: 'submissionId 가 필요합니다.' });
        return;
      }
      const { data: sub } = await admin
        .from('sp_submissions')
        .select('id, teacher_id')
        .eq('id', submissionId)
        .maybeSingle();
      if (!sub) {
        res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
        return;
      }
      if (caller.role !== 'admin' && sub.teacher_id !== caller.id) {
        res.status(403).json({ error: '담당 제출이 아닙니다.' });
        return;
      }
      const context =
        typeof body.reportContext === 'string'
          ? body.reportContext.trim().slice(0, 24000)
          : '';
      if (!context) {
        res.status(400).json({ error: 'reportContext 가 필요합니다.' });
        return;
      }
      const report = await runLearnReportLLM(context, subject);
      res.status(200).json({ report });
      return;
    }

    // ---------- 피드백 초안 — AI 과정 분석(수정본 우선) + OCR 기반 ----------
    if (action === 'feedback-draft') {
      const submissionId = body.submissionId;
      if (!submissionId) {
        res.status(400).json({ error: 'submissionId 가 필요합니다.' });
        return;
      }
      const { data: sub } = await admin
        .from('sp_submissions')
        .select('id, student_id, teacher_id')
        .eq('id', submissionId)
        .maybeSingle();
      if (!sub) {
        res.status(404).json({ error: '제출을 찾을 수 없습니다.' });
        return;
      }
      if (caller.role !== 'admin' && sub.teacher_id !== caller.id) {
        res.status(403).json({ error: '담당 제출이 아닙니다.' });
        return;
      }
      // 현재 화면의 분석/OCR 이 오면 그대로 사용 (페이지·문항 범위 초안)
      let analysis: AnalysisReport | null =
        body.analysis && typeof body.analysis === 'object' && body.analysis.headline
          ? body.analysis
          : null;
      for (const p of analysis
        ? []
        : [
            `${sub.student_id}/${sub.id}.analysis-edit.json`,
            `${sub.student_id}/${sub.id}.analysis.json`,
          ]) {
        const { data } = await admin.storage.from('sp-strokes').download(p);
        if (!data) continue;
        try {
          const parsed = JSON.parse(
            Buffer.from(await data.arrayBuffer()).toString('utf-8'),
          ) as AnalysisReport | null;
          if (parsed && typeof parsed === 'object' && parsed.headline) {
            analysis = parsed;
            break;
          }
        } catch {
          /* 손상/무효 — 다음 후보 */
        }
      }
      let ocr =
        typeof body.ocrText === 'string' && body.ocrText.trim()
          ? body.ocrText.trim().slice(0, 8000)
          : null;
      if (!ocr) {
        const { data: fb } = await admin
          .from('sp_feedback')
          .select('ocr_text, ocr_edited')
          .eq('submission_id', sub.id)
          .maybeSingle();
        ocr = fb?.ocr_edited?.trim() || fb?.ocr_text?.trim() || null;
      }
      if (!analysis && !ocr) {
        res.status(422).json({
          error: 'AI 과정 분석 또는 필기 인식을 먼저 실행해주세요.',
        });
        return;
      }
      const { data: prof } = await admin
        .from('sp_profiles')
        .select('name')
        .eq('id', sub.student_id)
        .maybeSingle();
      const draft = await runTextLLM(
        [
          '당신은 학생의 손글씨 필기를 검토한 선생님을 돕는 조교입니다.',
          '분석 결과와 인식된 풀이 내용을 바탕으로, 선생님이 학생에게 보낼 피드백 코멘트 초안을 한국어로 작성하세요.',
          '- 부드러운 존댓말, 4~6문장.',
          '- 잘한 점 1~2개 → 아쉬운 점/막힌 지점 1개 → 다음에 시도할 행동 1개 순서.',
          '- 분석에 없는 사실을 지어내지 마세요. 설명 없이 코멘트 본문만 출력하세요.',
          '',
          KOREAN_STYLE_RULES,
        ].join('\n'),
        [
          '## 학생 이름',
          prof?.name ?? '학생',
          '',
          '## AI 과정 분석',
          analysis ? JSON.stringify(analysis, null, 1) : '(없음)',
          '',
          '## 인식된 풀이 내용(OCR)',
          ocr ?? '(없음)',
        ].join('\n'),
      );
      res.status(200).json({ draft });
      return;
    }

    // ---------- 관리자 설정 ----------
    const { data: row } = await admin
      .from('sp_settings')
      .select('value')
      .eq('key', 'ocr')
      .maybeSingle();
    const stored = (row?.value ?? {}) as OcrConfig;

    if (action === 'settings-get') {
      const { data: promptRow } = await admin
        .from('sp_settings')
        .select('value')
        .eq('key', 'analysis_prompt')
        .maybeSingle();
      res.status(200).json({
        ocr: {
          engine: sanitizeEngine(stored.engine),
          openrouterModel: stored.openrouterModel ?? '',
        },
        env: {
          openrouter: Boolean(process.env.OPENROUTER_API_KEY),
          gemini: Boolean(process.env.GEMINI_API_KEY),
        },
        analysisPrompt:
          (promptRow?.value as { system?: string } | null)?.system ?? '',
        defaultAnalysisPrompt: DEFAULT_ANALYSIS_PROMPT,
      });
      return;
    }

    if (action === 'settings-save' || action === 'settings-test') {
      // 분석 프롬프트만 저장
      if (
        action === 'settings-save' &&
        body.analysisPrompt !== undefined &&
        !body.ocr
      ) {
        const { error } = await admin.from('sp_settings').upsert({
          key: 'analysis_prompt',
          value: { system: body.analysisPrompt.trim() },
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true });
        return;
      }

      const input = body.ocr ?? {};
      const merged: OcrConfig = {
        engine: sanitizeEngine(input.engine ?? stored.engine),
        openrouterModel: (input.openrouterModel ?? '').trim(),
      };

      if (action === 'settings-test') {
        try {
          await runOcr(merged, TEST_IMAGE, '이 이미지에 보이는 것을 한 단어로 답하세요.');
          res.status(200).json({ ok: true, engine: merged.engine });
        } catch (err) {
          res.status(200).json({
            ok: false,
            engine: merged.engine,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      const { error } = await admin.from('sp_settings').upsert({
        key: 'ocr',
        value: merged,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: `알 수 없는 action: ${action}` });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : '요청 처리에 실패했습니다.',
    });
  }
}
