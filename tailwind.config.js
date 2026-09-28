/**
 * Tailwind is used ONLY for layout utilities (flex/grid/spacing) and as a
 * bridge to SEED Design tokens. Every color/radius/shadow utility below maps
 * to a --seed-* CSS variable so the whole app stays 100% on seed foundations.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './seed-design/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'layer-default': 'var(--seed-color-bg-layer-default)',
        'layer-fill': 'var(--seed-color-bg-layer-fill)',
        'layer-floating': 'var(--seed-color-bg-layer-floating)',
        'layer-basement': 'var(--seed-color-bg-layer-basement)',
        'neutral-weak': 'var(--seed-color-bg-neutral-weak)',
        'brand-solid': 'var(--seed-color-bg-brand-solid)',
        'brand-weak': 'var(--seed-color-bg-brand-weak)',
        'critical-solid': 'var(--seed-color-bg-critical-solid)',
        'critical-weak': 'var(--seed-color-bg-critical-weak)',
        'informative-weak': 'var(--seed-color-bg-informative-weak)',
        'bg-disabled': 'var(--seed-color-bg-disabled)',
        overlay: 'var(--seed-color-bg-overlay)',
        // Foregrounds
        ink: 'var(--seed-color-fg-neutral)',
        'ink-muted': 'var(--seed-color-fg-neutral-muted)',
        'ink-subtle': 'var(--seed-color-fg-neutral-subtle)',
        'ink-inverted': 'var(--seed-color-fg-neutral-inverted)',
        placeholder: 'var(--seed-color-fg-placeholder)',
        'fg-disabled': 'var(--seed-color-fg-disabled)',
        brand: 'var(--seed-color-fg-brand)',
        critical: 'var(--seed-color-fg-critical)',
        positive: 'var(--seed-color-fg-positive)',
        warning: 'var(--seed-color-fg-warning)',
        informative: 'var(--seed-color-fg-informative)',
        // Strokes
        'line-weak': 'var(--seed-color-stroke-neutral-weak)',
        'line-muted': 'var(--seed-color-stroke-neutral-muted)',
        'line-solid': 'var(--seed-color-stroke-neutral-solid)',
        'line-brand': 'var(--seed-color-stroke-brand-solid)',
        'focus-ring': 'var(--seed-color-stroke-focus-ring)',
      },
      fontFamily: {
        // 애플 시스템 서체 우선 — 맥/iOS 는 SF Pro + Apple SD Gothic Neo,
        // 윈도우·안드로이드는 Pretendard 가 같은 자리를 메운다.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro KR',
          'SF Pro Text',
          'Apple SD Gothic Neo',
          'Pretendard Variable',
          'Pretendard',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
