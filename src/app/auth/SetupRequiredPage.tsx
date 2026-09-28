/** 서버 연결이 없는 빌드에서는 실제 학습 화면 대신 설정 상태를 알린다. */
export function SetupRequiredPage() {
  return (
    <main data-portal="auth" className="flex min-h-screen items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-lg rounded-[20px] border border-black/[0.06] bg-white p-8">
        <img src="/brand/hicnc-logo.png" alt="하이씨앤씨" className="mb-2 h-10 w-auto" />
        <p className="mb-8 text-sm text-ink-muted">펜클래스</p>
        <h1 className="text-2xl font-semibold text-ink">서버 연결이 필요합니다</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
          하이씨앤씨 학습 서버를 아직 연결하지 않았습니다. 관리자에게 서버 연결을 요청해주세요.
          연결을 마치면 선생님 계정으로 로그인할 수 있습니다.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          PDF 교재 업로드부터 ncode PDF 내려받기, 스마트펜 필기 수신,
          문항별 분석과 리포트까지 기존 펜클래스 순서로 사용합니다.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="ap-auth-submit mt-7 h-11 w-full rounded-xl text-[15px] font-medium text-white">
          연결 상태 다시 확인
        </button>
      </div>
    </main>
  );
}
