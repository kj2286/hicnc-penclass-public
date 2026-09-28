/**
 * 펜 구독 관리 다이얼로그 — 플랜 선택(베이직/플러스) → 모의 결제 → updatePen.
 * 실제 결제는 이루어지지 않는 데모 흐름임을 명시한다.
 */
import { useState } from 'react';
import { Badge } from '@seed-design/react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  RadioSelectBoxRadiomark,
  RadioSelectBoxItem,
  RadioSelectBoxRoot,
} from 'seed-design/ui/select-box';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updatePen, type PenPlan, type PenRow } from '@/lib/api';
import { useToast } from './toast';
import { formatWon, PLAN_PRICE, PLAN_SHORT_LABEL } from '../format';

type Step = 'plan' | 'pay';

export function PlanDialog({
  pen,
  open,
  onOpenChange,
  onSaved,
}: {
  pen: PenRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 저장 성공 후 목록 갱신용 콜백 */
  onSaved: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('plan');
  const [plan, setPlan] = useState<Exclude<PenPlan, 'none'>>('basic_3900');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('plan');
    setPlan('basic_3900');
    setCardNumber('');
    setExpiry('');
    setCvc('');
    setSaving(false);
    setError(null);
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const submitPayment = async () => {
    if (!pen || saving) return;
    if (!cardNumber.trim() || !expiry.trim() || !cvc.trim()) {
      setError('카드 정보를 모두 입력해주세요. (데모 결제 — 아무 값이나 가능)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePen(pen.id, { plan });
      toast(
        `${PLAN_SHORT_LABEL[plan]} 구독이 시작되었습니다. (데모 결제)`,
        'positive',
      );
      onSaved();
      close(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '구독 처리 중 오류가 발생했습니다.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!pen) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'plan' ? '구독 플랜 선택' : '결제 정보 입력'}
          </DialogTitle>
          <DialogDescription>
            {step === 'plan'
              ? `${pen.name || pen.mac} 펜에 적용할 플랜을 선택해주세요.`
              : '실제 결제가 이루어지지 않는 데모 결제 단계입니다.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'plan' ? (
          <div className="space-y-4 py-2">
            <RadioSelectBoxRoot
              aria-label="구독 플랜"
              value={plan}
              onValueChange={(v) => setPlan(v as Exclude<PenPlan, 'none'>)}
            >
              <RadioSelectBoxItem
                value="basic_3900"
                label={`베이직 · 월 ${formatWon(PLAN_PRICE.basic_3900)}`}
                description="필기 영상 전송 · OCR 분석 · 피드백"
                suffix={<RadioSelectBoxRadiomark />}
              />
              <RadioSelectBoxItem
                value="plus_4900"
                label={
                  <span className="inline-flex items-center gap-2">
                    플러스 · 월 {formatWon(PLAN_PRICE.plus_4900)}
                    <Badge size="medium" variant="weak" tone="warning">
                      기능 준비중
                    </Badge>
                  </span>
                }
                description="베이직의 모든 기능 + 추가 분석 기능이 준비 중입니다. 지금 구독해도 베이직과 같은 기능이 제공됩니다."
                suffix={<RadioSelectBoxRadiomark />}
              />
            </RadioSelectBoxRoot>
            <DialogFooter>
              <ActionButton variant="neutralWeak" onClick={() => close(false)}>
                취소
              </ActionButton>
              <ActionButton variant="brandSolid" onClick={() => setStep('pay')}>
                다음
              </ActionButton>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <Callout
              tone="warning"
              title="데모 결제"
              description="실 결제 연동 전이라 카드에 청구되지 않습니다. 입력한 카드 정보는 저장되지 않아요."
            />
            <div className="rounded-xl border border-line-weak bg-layer-fill px-4 py-3 text-sm text-ink">
              선택한 플랜:{' '}
              <span className="font-bold">
                {PLAN_SHORT_LABEL[plan]} · 월 {formatWon(PLAN_PRICE[plan])}
              </span>
            </div>
            <TextField label="카드 번호">
              <TextFieldInput
                value={cardNumber}
                onChange={(e) => setCardNumber(e.currentTarget.value)}
                placeholder="0000 0000 0000 0000"
                inputMode="numeric"
                autoComplete="off"
              />
            </TextField>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="유효기간">
                <TextFieldInput
                  value={expiry}
                  onChange={(e) => setExpiry(e.currentTarget.value)}
                  placeholder="MM/YY"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </TextField>
              <TextField label="CVC">
                <TextFieldInput
                  value={cvc}
                  onChange={(e) => setCvc(e.currentTarget.value)}
                  placeholder="123"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </TextField>
            </div>
            {error && <Callout tone="critical" description={error} />}
            <DialogFooter>
              <ActionButton
                variant="neutralWeak"
                onClick={() => setStep('plan')}
                disabled={saving}
              >
                이전
              </ActionButton>
              <ActionButton
                variant="brandSolid"
                loading={saving}
                onClick={() => void submitPayment()}
              >
                {formatWon(PLAN_PRICE[plan])} 데모 결제하기
              </ActionButton>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
