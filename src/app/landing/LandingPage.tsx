/**
 * 하이씨앤씨 펜클래스 랜딩 — 애플 제품 페이지 문법.
 * 이미지 없이 타이포와 여백만으로 위계를 만든다. 얇은 반투명 상단 내비 →
 * 가운데 정렬 히어로 → 넉넉히 띄운 기능 섹션 → 다운로드 → 도입 신청 → 최소 푸터.
 * 전체를 [data-portal="landing"] 로 감싸 테마 토큰을 상속한다.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ApplySection } from './ApplySection';
import {
  Bluetooth,
  Download,
  FileText,
  MessageSquareText,
  PenLine,
  Play,
  Usb,
  Users,
} from 'lucide-react';

/** 스크롤 진입 시 .rt-reveal 요소를 순차적으로 나타나게 한다(1회, reduced-motion 존중). */
function useReveal() {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>('.rt-reveal'));
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduced) return;
    // 관찰자를 실제로 걸기 직전에만 숨긴다 — JS 가 실패하면 그냥 다 보인다
    el.setAttribute('data-reveal-ready', '');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => {
      io.disconnect();
      el.removeAttribute('data-reveal-ready');
    };
  }, []);
  return root;
}

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`rt-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** 기능 카드 — 아이콘 하나 + 제목 + 짧은 설명 */
function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rt-card flex h-full flex-col p-7">
      <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5f5f7] text-ink">
        {icon}
      </span>
      <h3 className="text-[19px] font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-[1.47] text-ink-muted">{body}</p>
    </div>
  );
}

const FEATURES = [
  {
    icon: <Bluetooth size={20} />,
    title: '스마트펜 실시간 필기',
    body: '블루투스로 펜을 연결하면 종이에 쓰는 손글씨가 그대로 화면에 나타나요.',
  },
  {
    icon: <Play size={20} />,
    title: '영상 리플레이',
    body: '완성된 답만이 아니라 풀이 과정을 처음부터 되감아 볼 수 있어요.',
  },
  {
    icon: <MessageSquareText size={20} />,
    title: '제출과 피드백',
    body: '필기를 선생님께 보내면 손글씨 인식(OCR) 교정과 피드백을 받아요.',
  },
  {
    icon: <FileText size={20} />,
    title: '학습분석 리포트',
    body: '문항별 정오·풀이 시간·체감 난이도까지 — 펜 데이터 기반 리포트를 PDF 로 전달해요.',
  },
];

const AUDIENCE = [
  {
    icon: <PenLine size={20} />,
    title: '학생',
    body: '스마트펜으로 쓴 필기를 영상으로 되돌아보고, 선생님께 보내 피드백을 받아요.',
  },
  {
    icon: <Users size={20} />,
    title: '선생님',
    body: '학생의 필기를 받아 검토하고, AI 채점·과정 분석으로 학습 리포트까지 만들어요.',
  },
  {
    icon: <Usb size={20} />,
    title: '학원 · PC 프로그램',
    body: '크래들에 펜을 꽂으면 학생별 필기가 한 번에 수신되고, 학원·선생님·학생을 한곳에서 관리해요.',
  },
];

export function LandingPage() {
  const root = useReveal();

  return (
    <div
      data-portal="landing"
      ref={root}
      className="min-h-screen bg-white antialiased"
    >
      {/* ── 상단 내비 — 얇은 반투명 유리 ─────────────────────────── */}
      <header className="ap-nav sticky top-0 z-40">
        <div className="mx-auto flex h-12 max-w-[1120px] items-center justify-between px-6">
          <a href="#top" className="flex items-center gap-2">
            <img
              src="/brand/hicnc-icon.png"
              alt=""
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-[6px]"
              draggable={false}
              aria-hidden
            />
            <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">
              하이씨앤씨 펜클래스
            </span>
          </a>
          <div className="flex items-center gap-5">
            <Link
              to="/login"
              className="text-[13px] text-ink-muted hover:text-ink"
            >
              로그인
            </Link>
            <a
              href="#download"
              className="rt-btn rt-btn-dark h-8 px-4 text-[13px]"
            >
              PC 프로그램 안내
            </a>
          </div>
        </div>
      </header>

      {/* ── 히어로 — 가운데 정렬, 타이포만 ───────────────────────── */}
      <section id="top" className="px-6 pb-[120px] pt-24 sm:pt-32">
        <div className="mx-auto max-w-[820px] text-center">
          <Reveal>
            <h1
              className="ap-display mx-auto max-w-[15ch] text-[42px] text-ink sm:text-[56px]"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              영어 교재부터 문항별 분석까지
            </h1>
          </Reveal>
          <Reveal delay={80}>
            <p
              className="mx-auto mt-6 max-w-[52ch] text-[19px] leading-[1.42] text-ink-muted"
              style={{ textWrap: 'pretty' } as React.CSSProperties}
            >
              영어 PDF 교재를 준비하고 스마트펜 필기를 확인하세요.
              지문의 근거와 문항별 풀이를 살펴보고 학습 리포트로
              다음 수업을 준비합니다.
            </p>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-9 flex flex-col items-center gap-4">
              <a href="#download" className="rt-btn rt-btn-dark h-11 text-[15px]">
                PC 프로그램 안내
              </a>
              <Link to="/login" className="rt-link text-[15px]">
                로그인
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 가치 제안 ────────────────────────────────────────────── */}
      <section className="bg-[#f5f5f7] px-6 py-[120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <Reveal>
            <h2
              className="text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[40px]"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              쓰는 순간부터 복습까지,
              <br />
              끊김 없이 이어집니다
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mx-auto mt-5 max-w-[46ch] text-[17px] leading-[1.5] text-ink-muted">
              결과만 남는 필기는 과정을 잃습니다. 하이씨앤씨 펜클래스는 손끝의 순서와
              속도까지 담아, 학생은 스스로 되돌아보고 선생님은 정확히
              짚어줍니다.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 기능 ─────────────────────────────────────────────────── */}
      <section id="why" className="px-6 py-[120px]">
        <div className="mx-auto max-w-[1120px]">
          <Reveal>
            <h2 className="max-w-[20ch] text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[40px]">
              필기를 영상처럼 다시, 선생님과 바로 연결
            </h2>
          </Reveal>
          <Reveal delay={60}>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.5] text-ink-muted">
              종이에 쓴 그대로 화면에 담고, 언제 어떻게 풀었는지 되감아 봅니다.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70} className="h-full">
                <FeatureCard {...f} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 대상별 ───────────────────────────────────────────────── */}
      <section className="bg-[#f5f5f7] px-6 py-[120px]">
        <div className="mx-auto max-w-[1120px]">
          <Reveal>
            <h2 className="max-w-[22ch] text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[40px]">
              학생·선생님·학원 모두를 위한 설계
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {AUDIENCE.map((u, i) => (
              <Reveal key={u.title} delay={i * 70} className="h-full">
                <FeatureCard {...u} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── PC 프로그램과 PDF 교재 ─────────────────────────────────── */}
      <section id="download" className="px-6 py-[120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <Reveal>
            <span className="mx-auto mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f5f5f7] text-ink">
              <Download size={20} />
            </span>
            <h2 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[40px]">
              PDF 교재부터 시작하세요
            </h2>
            <p className="mx-auto mt-4 max-w-[42ch] text-[17px] leading-[1.5] text-ink-muted">
              PDF를 올려 ncode 교재를 내려받으세요. 학생이 스마트펜으로 푼 뒤
              PC 프로그램에서 크래들 필기를 받아 문항별 분석과 리포트를 확인합니다.
            </p>
            <div className="mt-9 flex items-center justify-center gap-3">
              <Link to="/t/papers" className="rt-btn rt-btn-dark h-11 text-[15px]">
                교재 만들기 열기
              </Link>
            </div>
            <p className="mx-auto mt-5 max-w-[46ch] text-[13px] leading-[1.55] text-ink-subtle">
              PC 프로그램 설치 파일은 학원 관리자에게 받아주세요. 서버 연결과 계정 로그인이 필요합니다.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 마무리 CTA ───────────────────────────────────────────── */}
      <section className="bg-[#f5f5f7] px-6 py-[120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <Reveal>
            <h2
              className="mx-auto max-w-[18ch] text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[40px]"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              지금 하이씨앤씨 펜클래스와 함께 시작하세요
            </h2>
            <p className="mx-auto mt-4 max-w-[40ch] text-[17px] leading-[1.5] text-ink-muted">
              도입 신청을 남겨주시면 담당자가 연락드립니다. 학원 규모에 맞춰
              도입 방법을 안내해 드려요.
            </p>
            <div className="mt-9">
              <a href="#apply" className="rt-btn rt-btn-dark h-11 text-[15px]">
                학원 도입 신청하기
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 학원 도입 신청 접수 ──────────────────────────────────── */}
      <ApplySection />

      {/* ── 푸터 ─────────────────────────────────────────────────── */}
      <footer className="border-t border-black/[0.06]">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px] font-medium text-ink">하이씨앤씨 펜클래스</div>
          <div className="text-[12px] text-ink-subtle">© 2026 하이씨앤씨 펜클래스</div>
        </div>
      </footer>
    </div>
  );
}
