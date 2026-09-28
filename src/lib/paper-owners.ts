/**
 * 교재(ncode PDF) 소유 매핑 — NGS 는 선생님 개념이 없는 공용 서버라,
 * 어떤 선생님이 올린 교재인지 Supabase(sp_paper_owners)에 기록한다.
 * 교재 만들기 목록은 내 소유만 노출한다. (supabase/012_paper_owners.sql)
 */
import { requireSupabase } from '@/lib/supabase';
import { isPaperSubject, type PaperSubject } from './paper-subject';

// 순수 헬퍼는 supabase 를 끌고 오지 않는 곳에 둔다 — 테스트가 그대로 부른다
export { visiblePapers } from './paper-list';

export type PaperOwnership = {
  /** 활성(휴지통 제외) pdf id 집합. null = 012 미적용 → 필터 생략 */
  active: Set<number> | null;
  /** 휴지통 pdf id → 삭제 시각 (013 미적용이면 빈 맵) */
  trashed: Map<number, string>;
};

/**
 * 내 소유 pdf 목록(활성/휴지통 분리).
 * 012 마이그레이션 미적용(테이블 없음)이면 active=null — 호출부는 필터를
 * 생략해 기존처럼 전체를 노출한다(빈 목록 사고 방지).
 * 013(deleted_at 칼럼) 미적용이면 휴지통 없이 전부 활성으로 취급.
 */
export async function listMyPaperOwnership(): Promise<PaperOwnership> {
  const supabase = requireSupabase();
  let rows: Array<{ pdf_id: number; deleted_at?: string | null }> | null = null;
  const withTrash = await supabase
    .from('sp_paper_owners')
    .select('pdf_id, deleted_at');
  if (withTrash.error) {
    if (/deleted_at/i.test(withTrash.error.message)) {
      // 013 미적용 — 칼럼 없이 재시도
      const basic = await supabase.from('sp_paper_owners').select('pdf_id');
      if (basic.error) {
        if (/sp_paper_owners/i.test(basic.error.message)) {
          return { active: null, trashed: new Map() };
        }
        throw new Error(basic.error.message);
      }
      rows = basic.data ?? [];
    } else if (/sp_paper_owners/i.test(withTrash.error.message)) {
      return { active: null, trashed: new Map() };
    } else {
      throw new Error(withTrash.error.message);
    }
  } else {
    rows = withTrash.data ?? [];
  }
  const active = new Set<number>();
  const trashed = new Map<number, string>();
  for (const r of rows ?? []) {
    if (r.deleted_at) trashed.set(Number(r.pdf_id), r.deleted_at);
    else active.add(Number(r.pdf_id));
  }
  return { active, trashed };
}

/** 호환 유지 — 활성 pdf id 집합만 */
export async function listMyPaperIds(): Promise<Set<number> | null> {
  return (await listMyPaperOwnership()).active;
}

/**
 * 휴지통으로 이동. 013 미적용이거나 **내 소유 행이 없으면** false 를 돌려
 * 호출부가 즉시 삭제로 폴백하게 한다.
 *
 * 🚨 `.select()` 없이 update 하면 **0행이 바뀌어도 error 가 null** 이다.
 * 예전엔 그걸 성공으로 읽어 "휴지통으로 이동했습니다" 토스트를 띄우고는
 * 아무 것도 지우지 않았다 — 소유 행이 없는 교재(다른 계정이 올렸거나 업로드
 * 직후 claim 이 실패한 것)에서 그대로 재현된다. 바뀐 행 수를 보고 판정한다.
 */
export async function trashPaper(pdfId: number): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sp_paper_owners')
    .update({ deleted_at: new Date().toISOString() })
    .eq('pdf_id', pdfId)
    .select('pdf_id');
  if (error) {
    if (/deleted_at|sp_paper_owners/i.test(error.message)) return false;
    throw new Error(error.message);
  }
  return (data?.length ?? 0) > 0;
}

/** 휴지통에서 원복 */
export async function restorePaper(pdfId: number): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_paper_owners')
    .update({ deleted_at: null })
    .eq('pdf_id', pdfId);
  if (error) throw new Error(error.message);
}

// ---------- 교재 종류 (015) ----------
export const PAPER_KINDS = ['테스트지', '시험지', '학습지', '단순노트'] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

/**
 * 내 교재의 종류 맵 (pdf_id → kind).
 * 015 미적용(kind 칼럼 없음)이면 빈 맵 — 호출부는 종류 미지정으로 취급.
 */
export async function listMyPaperKinds(): Promise<Map<number, PaperKind>> {
  const supabase = requireSupabase();
  // 🚨 'pdf_id, kind' 로 콕 집으면 015 미적용 DB 에서 쿼리 전체가 42703 으로
  // 죽는다 — '*' 는 있는 컬럼만 돌려주므로 어떤 마이그레이션 상태에서도 산다.
  const { data, error } = await supabase.from('sp_paper_owners').select('*');
  if (error || !data) return new Map();
  const out = new Map<number, PaperKind>();
  for (const r of data as Array<{ pdf_id: number; kind?: string | null }>) {
    if (r.kind && (PAPER_KINDS as readonly string[]).includes(r.kind)) {
      out.set(Number(r.pdf_id), r.kind as PaperKind);
    }
  }
  return out;
}

/**
 * 업로드 성공 직후 호출 — 이 교재를 내 소유로 기록한다.
 *
 * 🚨 **여기서 던지면 교재를 잃는다.** 목록은 소유 기록이 있는 교재만 보여주므로
 * (`visiblePapers`), 소유 기록을 못 남기면 방금 만든 ncode 교재가 NGS 에만 남고
 * 화면에서는 영영 안 보인다 — 발급 한도만 깎인다(실사고 2026-09-04: 과목을 과학으로
 * 고르면 026 CHECK 제약에 걸려 400 → 업로드는 성공했는데 목록이 비어 있었다).
 * 그래서 과목·종류처럼 **곁가지 값은 하나씩 덜어내며** 소유 기록만은 반드시 남긴다.
 *
 * 돌려주는 값으로 호출부가 "교재는 만들어졌지만 과목은 저장 못 했다" 를 안내한다.
 */
export type ClaimResult = {
  /** 소유 기록을 남겼는가 — false 면 목록에 안 보인다(치명) */
  claimed: boolean;
  /** 과목까지 저장했는가 */
  subjectSaved: boolean;
  /** 과목을 못 저장한 이유(안내 문구) */
  warning?: string;
};

export async function claimPaper(
  pdfId: number,
  kind?: PaperKind,
  /** 과목 — 문항 인식·분석 프롬프트가 이 값으로 갈린다 */
  subject?: PaperSubject | null,
  /** 업로드를 시작한 교사. 처리 도중 계정이 바뀌면 소유 기록을 쓰지 않는다. */
  expectedTeacherId?: string,
): Promise<ClaimResult> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return { claimed: false, subjectSaved: false };
  if (expectedTeacherId !== undefined && uid !== expectedTeacherId) {
    return {
      claimed: false,
      subjectSaved: false,
      warning: '로그인이 바뀌어 교재를 등록하지 않았습니다. 업로드를 시작한 계정으로 다시 접속해 주세요.',
    };
  }
  const base = { pdf_id: pdfId, teacher_id: uid };
  const withKind = { ...base, ...(kind ? { kind } : {}) };
  const full = {
    ...withKind,
    ...(subject !== undefined ? { subject } : {}),
  };

  const first = await supabase.from('sp_paper_owners').upsert(full);
  if (!first.error) return { claimed: true, subjectSaved: subject != null };

  // 과목 때문에 막힌 경우 — 과목을 빼고 교재부터 살린다.
  const msg = first.error.message;
  const warning = isSubjectConstraintViolation(msg)
    ? SCIENCE_MIGRATION_HINT
    : isMissingSubjectColumn(msg)
      ? SUBJECT_MIGRATION_HINT
      : `과목을 저장하지 못했습니다 — ${msg}`;
  const second = await supabase.from('sp_paper_owners').upsert(withKind);
  if (!second.error) return { claimed: true, subjectSaved: false, warning };

  // 종류 컬럼(015)조차 없는 DB — 최소 기록만 남긴다.
  const third = await supabase.from('sp_paper_owners').upsert(base);
  return {
    claimed: !third.error,
    subjectSaved: false,
    warning: third.error ? `교재 소유 기록에 실패했습니다 — ${third.error.message}` : warning,
  };
}

export type PaperMeta = {
  kind: PaperKind | null;
  /** 표지 본인정보 기입란 페이지 (PDF 페이지 번호, 022) */
  infoPage: number | null;
  /** 별도 정답지 페이지 (022) */
  answerPage: number | null;
  /** 과목 (026). null = 미지정 — 026 이전 교재는 전부 수학이라 수학으로 읽는다 */
  subject: PaperSubject | null;
};

/**
 * 교재별 메타(종류·과목·특수 페이지).
 * 특수 페이지(info_page/answer_page)는 업로드에서 더 받지 않지만, 예전에 지정한
 * 값과 리뷰 화면의 자동 판별이 아직 읽으므로 그대로 돌려준다.
 */
export async function listMyPaperMeta(): Promise<Map<number, PaperMeta>> {
  const supabase = requireSupabase();
  const out = new Map<number, PaperMeta>();
  type Row = {
    pdf_id: number;
    kind?: string | null;
    info_page?: number | null;
    answer_page?: number | null;
    subject?: string | null;
  };
  // 🚨 컬럼을 콕 집은 select 체인은 함정이었다 (실사고 2026-09-01): 이 DB 는
  // 015/022 가 미적용이라 **kind 가 없고**, 체인 세 단이 전부 kind 를 포함해
  // 셋 다 42703 으로 죽었다 — 값이 DB 에 잘 저장돼 있는데(사용자가 지정)
  // 읽기가 빈 맵을 돌려줘 "미지정" 으로 보였다. '*' 는 있는 컬럼만 돌려주므로
  // 어떤 마이그레이션 조합에서도 산다. 없는 컬럼은 undefined → null 매핑.
  const res = await supabase.from('sp_paper_owners').select('*');
  const rows: Row[] | null = res.error ? null : ((res.data ?? []) as unknown as Row[]);
  for (const r of rows ?? []) {
    out.set(Number(r.pdf_id), {
      kind:
        r.kind && (PAPER_KINDS as readonly string[]).includes(r.kind)
          ? (r.kind as PaperKind)
          : null,
      infoPage: typeof r.info_page === 'number' ? r.info_page : null,
      answerPage: typeof r.answer_page === 'number' ? r.answer_page : null,
      subject: isPaperSubject(r.subject) ? r.subject : null,
    });
  }
  return out;
}

/** 026 미적용 DB 안내 — 화면이 이 문구를 그대로 띄운다(원문 DB 에러 금지) */
export const SUBJECT_MIGRATION_HINT =
  '과목 저장 준비가 아직 안 됐습니다 — supabase/026_paper_subject.sql 을 1회 실행해주세요.';

/**
 * 028 미적용 DB 안내. 026 의 CHECK 제약이 수학·국어·영어만 허용해서, 과학을
 * 고르면 저장이 23514 로 튕긴다 — PostgREST 원문 대신 이 문구를 띄운다.
 */
export const SCIENCE_MIGRATION_HINT =
  '과학 과목 저장 준비가 아직 안 됐습니다 — supabase/028_paper_subject_science.sql 을 1회 실행해주세요.';

/** 컬럼 없음(PostgREST 스키마 캐시) 판별 */
function isMissingSubjectColumn(message: string): boolean {
  return /subject/i.test(message) && /column|schema cache|does not exist/i.test(message);
}

/** 과목 CHECK 제약 위반 판별 — 028 미적용 DB 에 과학을 저장할 때 */
function isSubjectConstraintViolation(message: string): boolean {
  return /check constraint|sp_paper_owners_subject_chk/i.test(message);
}

/**
 * 이 DB 에 `subject` 컬럼이 있는가 (026 적용 여부).
 *
 * 없으면 화면이 **과목 셀렉트를 잠그고** 안내만 띄운다 — 예전엔 그냥 저장을
 * 시도하다 PostgREST 원문("Could not find the 'subject' column ... schema cache")을
 * 토스트로 뱉었다(사용자 신고 2026-09-04: "에러가 나면 안 되는데 에러가 나잖아").
 * 한 번 확인하면 프로세스 수명 동안 재사용한다.
 */
let subjectSupport: Promise<boolean> | null = null;
export function supportsPaperSubject(): Promise<boolean> {
  if (!subjectSupport) {
    subjectSupport = (async () => {
      try {
        const supabase = requireSupabase();
        const { error } = await supabase
          .from('sp_paper_owners')
          .select('subject')
          .limit(1);
        if (!error) return true;
        if (isMissingSubjectColumn(error.message)) return false;
        // 다른 이유(권한·네트워크)면 있다고 보고 진행 — 저장 시점에 다시 걸린다
        return true;
      } catch {
        return true;
      }
    })();
  }
  return subjectSupport;
}

/**
 * 교재 과목 지정/변경 (026). **upsert + 결과 확인**으로 간다:
 * 소유 행이 없는 교재에 update 를 쏘면 0행에 조용히 성공해 토스트만 거짓말한다.
 * 026 미적용 DB 에서는 컬럼이 없다고 에러가 나므로 그대로 던져 화면에 알린다.
 */
export async function setPaperSubject(
  pdfId: number,
  subject: PaperSubject | null,
): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { data, error } = await supabase
    .from('sp_paper_owners')
    .upsert({ pdf_id: pdfId, teacher_id: uid, subject })
    .select('subject')
    .single();
  if (error) {
    if (isMissingSubjectColumn(error.message)) {
      subjectSupport = Promise.resolve(false); // 화면이 바로 잠기도록
      throw new Error(SUBJECT_MIGRATION_HINT);
    }
    if (isSubjectConstraintViolation(error.message))
      throw new Error(SCIENCE_MIGRATION_HINT);
    throw new Error(error.message);
  }
  if (((data as { subject?: string | null } | null)?.subject ?? null) !== subject)
    throw new Error('저장이 반영되지 않았습니다 — 다시 시도해주세요.');
}

/** 교재 삭제 시 소유 기록도 정리 */
export async function releasePaper(pdfId: number): Promise<void> {
  const supabase = requireSupabase();
  await supabase.from('sp_paper_owners').delete().eq('pdf_id', pdfId);
}
