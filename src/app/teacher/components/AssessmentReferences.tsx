import type { AssessmentMetadata } from '@/lib/assessment';

export function AssessmentReferences({ assessment }: { assessment?: AssessmentMetadata }) {
  if (!assessment) return null;
  return <aside className="my-3 rounded-lg border border-line-weak bg-white p-3 text-xs text-ink-muted" data-testid="assessment-references">
    <h4 className="font-semibold">참고 평가자료</h4>
    {assessment.koreanGradingVersion && <p className="mt-1">제공하신 「고등학교 국어 채점 원칙」을 참고했습니다. 현재 문항의 조건과 확인 가능한 성취를 기준으로 판단합니다.</p>}
    <p className="mt-1">{assessment.status === 'reference'
      ? '문항 내용으로 찾은 평가자료입니다. 적용한 기준은 분석 내용과 함께 확인하세요.'
      : '일치하는 평가 사례를 찾지 못해 과목별 기본 기준으로 분석했습니다.'}</p>
    {assessment.references.length > 0 && <ul className="mt-2 space-y-1">
      {assessment.references.map(ref => <li key={ref.id}>{ref.title} · {ref.subject} · {ref.source}{ref.pages.length ? ` · PDF ${ref.pages.join(', ')}쪽` : ''}</li>)}
    </ul>}
    {assessment.status === 'reference' && (
      assessment.applications?.length ? <div className="mt-3 space-y-2">
        <h5 className="font-semibold">AI가 기록한 적용 기준</h5>
        {assessment.applications.map((item, index) => {
          const ref = assessment.references.find(ref => ref.id === item.referenceId);
          if (!ref) return null;
          return <div key={`${item.referenceId}-${index}`}>
            <p>{ref.title} · {item.criterion}</p>
            <p className="mt-1">{item.application}</p>
          </div>;
        })}
      </div> : <p className="mt-2">자료는 찾았지만 AI가 적용한 기준을 기록하지 않았습니다. 분석 내용을 함께 확인해 주세요.</p>
    )}
  </aside>;
}
