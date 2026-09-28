/**
 * 학원 도입 신청 — 하이씨앤씨 펜클래스 랜딩페이지의 접수 폼.
 *
 * 학원은 PC 프로그램에서 쓰는 구조라, 이 폼은 로그인 없이 접수만 받는다.
 *
 * 원장님이 한 번에 끝낼 수 있어야 하므로 필수는 **학원명·위치·연락처 셋**뿐이다.
 * 학생 수·선생님 수는 규모 파악용이라 몰라도 넘어갈 수 있게 둔다 — 필수로 막으면
 * 접수 자체를 포기한다.
 */
import { useState } from 'react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import { submitAcademyApplication } from '@/lib/api';
import {
  EMPTY_APPLICATION,
  formatPhone,
  hasErrors,
  toRow,
  validateApplication,
  type AcademyApplication,
  type ApplicationErrors,
} from '@/lib/academy-apply';

export function ApplySection() {
  const [v, setV] = useState<AcademyApplication>(EMPTY_APPLICATION);
  const [errors, setErrors] = useState<ApplicationErrors>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const set = (k: keyof AcademyApplication) => (val: string) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    const e = validateApplication(v);
    setErrors(e);
    if (hasErrors(e)) return;
    setSending(true);
    setFailed(null);
    try {
      await submitAcademyApplication(toRow(v));
      setDone(true);
    } catch (err) {
      setFailed(
        err instanceof Error
          ? `접수에 실패했습니다. ${err.message}`
          : '접수에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <section id="apply" className="mx-auto max-w-[560px] px-6 py-[120px]">
        <div className="rt-card px-8 py-12 text-center">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
            신청이 완료되었습니다
          </h2>
          <p className="mt-3 text-[15px] leading-[1.5] text-ink-muted">
            담당자가 확인 후 별도로 연락드리겠습니다.
            <br />
            도입 상담을 거쳐 학원 계정과 전용 홈페이지를 만들어 드립니다.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="apply" className="mx-auto max-w-[560px] px-6 py-[120px]">
      <h2 className="text-center text-[32px] font-semibold tracking-[-0.025em] text-ink">
        학원 도입 신청
      </h2>
      <p className="mx-auto mt-3 max-w-[38ch] text-center text-[15px] leading-[1.5] text-ink-muted">
        간단한 정보만 남겨주시면 담당자가 연락드립니다.
        <br />
        학원 규모에 맞춰 도입 방법을 안내해 드려요.
      </p>

      <div className="rt-card mt-10 space-y-4 p-7">
        {failed && <Callout tone="critical" description={failed} />}

        <TextField label="학원명" required errorMessage={errors.academyName}>
          <TextFieldInput
            value={v.academyName}
            onChange={(e) => set('academyName')(e.currentTarget.value)}
            placeholder="예: MK아카데미"
          />
        </TextField>

        <TextField label="학원 위치" required errorMessage={errors.location}>
          <TextFieldInput
            value={v.location}
            onChange={(e) => set('location')(e.currentTarget.value)}
            placeholder="예: 부산 해운대구 센텀"
          />
        </TextField>

        <div className="grid grid-cols-2 gap-3">
          <TextField label="학생 수" errorMessage={errors.studentCount}>
            <TextFieldInput
              inputMode="numeric"
              value={v.studentCount}
              onChange={(e) => set('studentCount')(e.currentTarget.value)}
              placeholder="예: 120"
            />
          </TextField>
          <TextField label="선생님 수" errorMessage={errors.teacherCount}>
            <TextFieldInput
              inputMode="numeric"
              value={v.teacherCount}
              onChange={(e) => set('teacherCount')(e.currentTarget.value)}
              placeholder="예: 8"
            />
          </TextField>
        </div>

        <TextField label="대표자 성함">
          <TextFieldInput
            value={v.contactName}
            onChange={(e) => set('contactName')(e.currentTarget.value)}
            placeholder="예: 김원장"
          />
        </TextField>

        <TextField
          label="연락 가능한 연락처"
          required
          description="학원 대표번호도 괜찮습니다."
          errorMessage={errors.contactPhone}
        >
          <TextFieldInput
            inputMode="tel"
            value={v.contactPhone}
            // 입력 중에도 하이픈을 넣어준다 — 자릿수를 눈으로 확인하게
            onChange={(e) => set('contactPhone')(formatPhone(e.currentTarget.value))}
            placeholder="010-1234-5678"
          />
        </TextField>

        <TextField
          label="이메일"
          required
          description="전화 연결이 어려울 때 이 주소로 안내드립니다."
          errorMessage={errors.contactEmail}
        >
          <TextFieldInput
            inputMode="email"
            value={v.contactEmail}
            onChange={(e) => set('contactEmail')(e.currentTarget.value)}
            placeholder="owner@academy.co.kr"
          />
        </TextField>

        <TextField label="문의 사항" description="선택 사항입니다.">
          <TextFieldInput
            value={v.memo}
            onChange={(e) => set('memo')(e.currentTarget.value)}
            placeholder="궁금하신 점을 적어주세요"
          />
        </TextField>

        <ActionButton
          variant="neutralSolid"
          size="large"
          className="ap-auth-submit w-full"
          loading={sending}
          onClick={() => void submit()}
        >
          신청하기
        </ActionButton>
        <p className="text-center text-[12px] text-ink-subtle">
          입력하신 정보는 도입 상담 목적으로만 사용됩니다.
        </p>
      </div>
    </section>
  );
}
