import { useState, useEffect, useMemo, useRef } from 'react'
import { useTweaks, TweaksPanel, TweakSection, TweakRadio } from './tweaks-panel.jsx'
import logoImg from './assets/logo.png'

/** Set `VITE_MAC_DOWNLOAD_URL` in `vmax-site/.env` (e.g. `https://.../your.dmg`) or `/downloads/Vmax-macos-arm64.dmg` with the file under `public/downloads/`. */
const MAC_DOWNLOAD_URL = String(import.meta.env.VITE_MAC_DOWNLOAD_URL ?? '').trim()

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Spread onto `Btn as="a"` primary/secondary downloads. */
function macDownloadBtnProps(url) {
  if (!url) return {};
  const remote = /^https?:\/\//i.test(url);
  return {
    as: 'a',
    href: url,
    ...(remote ? { rel: 'noopener noreferrer', target: '_blank' } : { download: true }),
  };
}

/** Scroll-triggered fade + optional lift; skips motion when `prefers-reduced-motion`.
 *  Use `{ lift: false }` for sticky nav so the bar fades in without sliding the logo. */
function useReveal(delayMs = 0, opts = {}) {
  const { lift = true } = opts;
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setVisible(true);
        });
      },
      { threshold: 0.06, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [reduceMotion]);

  const revealStyle = reduceMotion
    ? {}
    : lift
      ? {
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(18px)',
          transition:
            `opacity 0.7s cubic-bezier(0.2, 0.8, 0.25, 1) ${delayMs}ms, transform 0.7s cubic-bezier(0.2, 0.8, 0.25, 1) ${delayMs}ms`,
        }
      : {
          opacity: visible ? 1 : 0,
          transition: `opacity 0.7s cubic-bezier(0.2, 0.8, 0.25, 1) ${delayMs}ms`,
        };

  return { ref, revealStyle, visible, reduceMotion };
}

/** Flips `live` once the element intersects (for staggered child CSS classes). Honors reduced motion. */
function useRevealChildren({ threshold = 0.08, rootMargin = '0px 0px -8% 0px' } = {}) {
  const ref = useRef(null);
  const [activated, setActivated] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActivated(true);
        });
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduceMotion, threshold, rootMargin]);

  return { ref, live: reduceMotion || activated };
}

/** Product panel KPI / chart orchestration. */
function usePrefersReducedMotion() {
  const [rm, setRm] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setRm(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return rm;
}

function useCountUp(endNum, active, reduceMotion, durationMs = 1400) {
  const [v, setV] = useState(0);

  useEffect(() => {
    if (reduceMotion || !active) return undefined;
    let raf;
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setV(from + (endNum - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endNum, active, reduceMotion, durationMs]);

  if (reduceMotion) return endNum;
  if (!active) return 0;
  return v;
}

function formatKpiNum(n, { decimals = 0, prefix = '', suffix = '' }) {
  const val = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
  return `${prefix}${val}${suffix}`;
}

// ---------------- Tokens ----------------
/** Brand: bg #010916 · accent #002E78 · light #EBF0E7 */
const T = {
  bg: '#010916',
  bgAlt: '#0a1628',
  ink: '#EBF0E7',
  inkDim: 'rgba(235, 240, 231, 0.72)',
  inkMute: 'rgba(235, 240, 231, 0.48)',
  inkFaint: 'rgba(235, 240, 231, 0.26)',
  hair: 'rgba(235, 240, 231, 0.08)',
  hairStrong: 'rgba(235, 240, 231, 0.16)',
  card: 'rgba(235, 240, 231, 0.035)',
  cardHi: 'rgba(235, 240, 231, 0.07)',
  accent: '#002E78',
  accentSoft: 'rgba(0, 46, 120, 0.22)',
  accentGlow: 'rgba(0, 46, 120, 0.45)',
  /** Diagram / status variety (harmonized with accent + ink) */
  green: '#5BA89A',
  greenDim: 'rgba(91, 168, 154, 0.2)',
  amber: '#D4B87A',
  violet: '#4A8FD9',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
};

/** Aligned max width for nav, hero, sections, and footer rails. */
const CONTENT_MAX = 1320;

/** One typographic step smaller (15/16 of previous px). */
const TYPE_STEP = 15 / 16;
const fz = (px) => Math.round(px * TYPE_STEP * 100) / 100;

// ---------------- Atoms ----------------
const Hair = ({ v, style }) => (
  <div style={{
    background: T.hair,
    ...(v ? { width: 1, alignSelf: 'stretch' } : { height: 1, width: '100%' }),
    ...style,
  }} />
);

const Tag = ({ children, tone = 'neutral', mono = true, style }) => {
  const tones = {
    neutral: { color: T.inkDim, border: T.hair, bg: 'transparent' },
    pos:     { color: T.accent, border: 'rgba(0, 46, 120, 0.35)', bg: 'rgba(0, 46, 120, 0.1)' },
    ink:     { color: T.ink, border: T.hairStrong, bg: T.cardHi },
    light:   { color: T.ink, border: 'rgba(235, 240, 231, 0.38)', bg: 'transparent' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 4,
      fontFamily: mono ? T.mono : T.sans, fontSize: fz(11), letterSpacing: 0.2,
      color: tones.color, border: `1px solid ${tones.border}`, background: tones.bg,
      whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  );
};

const Btn = ({ children, variant = 'primary', size = 'md', onClick, style, as = 'button', ...props }) => {
  const Comp = as;
  const sizes = { sm: { padding: '8px 14px', fontSize: fz(13) }, md: { padding: '11px 18px', fontSize: fz(13.5) }, lg: { padding: '14px 22px', fontSize: fz(14.5) } }[size];
  const variants = {
    primary: { background: T.accent, color: T.ink, border: '1px solid ' + T.accent },
    secondary: { background: 'transparent', color: T.ink, border: '1px solid ' + T.hairStrong },
    ghost: { background: 'transparent', color: T.inkDim, border: '1px solid transparent' },
  }[variant];
  return (
    <Comp
      {...(Comp === 'button' ? { type: 'button' } : {})}
      onClick={onClick}
      style={{
        ...sizes, ...variants,
        borderRadius: 8, fontFamily: T.sans, fontWeight: 500,
        letterSpacing: -0.05, cursor: 'pointer', transition: 'all 140ms ease-out',
        display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1,
        ...(Comp === 'a' ? { textDecoration: 'none' } : {}),
        ...style,
      }}
      {...props}
    >{children}</Comp>
  );
};

const Mono = ({ children, style, className }) => (
  <span className={className} style={{ fontFamily: T.mono, fontSize: fz(11.5), letterSpacing: 0.2, color: T.inkMute, ...style }}>{children}</span>
);

const Section = ({ id, label, title, sub, children, pad = '120px 0', topBorder = true }) => {
  const { ref, revealStyle } = useReveal(0);
  return (
    <section ref={ref} id={id} style={{ padding: pad, ...(topBorder ? { borderTop: '1px solid ' + T.hair } : {}), ...revealStyle }}>
      <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', padding: '0 32px' }}>
        {(label || title) && (
          <div style={{ marginBottom: 56, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 720 }}>
              {label && <Mono style={{ display: 'block', marginBottom: 16, color: T.inkMute, textTransform: 'uppercase' }}>{label}</Mono>}
              {title && <h2 style={{ margin: 0, fontSize: fz(44), lineHeight: 1.05, letterSpacing: -1.2, fontWeight: 500, color: T.ink }}>{title}</h2>}
              {sub && <p style={{ margin: '18px 0 0', fontSize: fz(16), lineHeight: 1.55, color: T.inkDim, maxWidth: 580 }}>{sub}</p>}
            </div>
          </div>
        )}
        {children}
      </div>
    </section>
  );
};

// ---------------- Logo ----------------
const Logo = ({ size = 44, wordmark = true, motion = true }) => {
  const wmTrans = motion
    ? 'max-width 380ms cubic-bezier(0.2, 0.8, 0.25, 1), opacity 220ms ease-out'
    : 'none';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          flexShrink: 0,
          height: size,
          lineHeight: 0,
        }}
      >
        <img
          src={logoImg}
          alt=""
          style={{
            height: size,
            width: 'auto',
            maxHeight: size,
            maxWidth: Math.round(size * 2.85),
            objectFit: 'contain',
            display: 'block',
          }}
          draggable={false}
          decoding="async"
        />
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: wordmark ? 260 : 0,
          opacity: wordmark ? 1 : 0,
          overflow: 'hidden',
          transition: wmTrans,
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: T.sans, fontSize: fz(15), fontWeight: 600, letterSpacing: -0.3, color: T.ink }}>Vmax</span>
        <span style={{ fontFamily: T.mono, fontSize: fz(10.5), color: T.inkFaint, letterSpacing: 1 }}>/EXEC</span>
      </span>
    </div>
  );
};

/** Apple mark (decorative) for macOS download badges — not the Apple Inc. trademark artwork. */
function AppleMark({ size = 22, color = T.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <path
        fill={color}
        d="M17.05 20.28c-.98.95-2.05.88-3.08.35-1.09-.48-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.3 4.52-3.74 4.25z"
      />
    </svg>
  );
}

/** Nav-sized macOS download chip (Apple-style: logo + two-line label). */
function NavMacDownloadBadge() {
  const raw = macDownloadBtnProps(MAC_DOWNLOAD_URL);
  const hasFile = !!MAC_DOWNLOAD_URL;
  const { as: _omitAs, ...anchorProps } = raw;
  const common = {
    className: 'vmax-nav-mac-badge',
    style: { WebkitFontSmoothing: 'antialiased' },
  };
  const label = (
    <>
      <AppleMark size={26} color={T.ink} />
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.12, gap: 1 }}>
        <span style={{ fontFamily: T.sans, fontSize: fz(10), fontWeight: 500, color: T.inkMute, letterSpacing: 0.06 }}>Download on the</span>
        <span style={{ fontFamily: T.sans, fontSize: fz(12.5), fontWeight: 600, color: T.ink, letterSpacing: -0.2 }}>Mac App Store</span>
      </span>
    </>
  );
  if (hasFile) {
    return (
      <a {...anchorProps} {...common} aria-label="Download Vmax for macOS">
        {label}
      </a>
    );
  }
  return (
    <a href="#cta" {...common} aria-label="Download Vmax for macOS">
      {label}
    </a>
  );
}

// ---------------- Nav ----------------
const NAV_ITEMS = [
  { href: '#product', label: 'Product' },
  { href: '#features', label: 'Capabilities' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#pricing', label: 'Pricing' },
];

const Nav = () => {
  const [scrolled, setScrolled] = useState(false);
  const { ref, revealStyle } = useReveal(0, { lift: false });

  useEffect(() => {
    const onS = () => setScrolled(window.scrollY > 8);
    onS();
    window.addEventListener('scroll', onS, { passive: true });
    return () => window.removeEventListener('scroll', onS);
  }, []);

  const navBgTransition = 'background 220ms ease-out, backdrop-filter 220ms ease-out';
  return (
    <header ref={ref} style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: scrolled ? 'rgba(1, 9, 22, 0.88)' : 'transparent',
      backdropFilter: scrolled ? 'blur(20px) saturate(140%)' : 'none',
      borderBottom: scrolled ? '1px solid rgba(235, 240, 231, 0.07)' : '1px solid transparent',
      ...revealStyle,
      transition: revealStyle.transition
        ? `${revealStyle.transition}, ${navBgTransition}, border-color 220ms ease-out`
        : `${navBgTransition}, border-color 220ms ease-out`,
    }}>
      <div className="vmax-nav-shell" style={{
        maxWidth: CONTENT_MAX,
        margin: '0 auto',
        padding: '14px 32px',
        minHeight: 56,
      }}>
        <a href="#" className={'vmax-nav-logo' + (scrolled ? ' vmax-nav-logo--scrolled' : '')} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit', minWidth: 0 }} aria-label="Vmax home">
          <Logo wordmark size={44} motion />
        </a>
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          minWidth: 0,
          flexWrap: 'wrap',
          justifySelf: 'stretch',
        }} aria-label="Sections">
          {NAV_ITEMS.map(({ href, label }) => (
            <a key={href} href={href} className="vmax-nav-link">{label}</a>
          ))}
        </nav>
        <div className="vmax-nav-download-wrap" style={{ display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'end', flexShrink: 0 }}>
          <NavMacDownloadBadge />
        </div>
      </div>
    </header>
  );
};

// Hero live-graph: rotates pairs quickly; two spokes active each beat
const HERO_PAIR_STEPS = [
  [0, 1],
  [0, 2],
  [1, 2],
];

/** Status lines under each agent card: rotate while hot so the demo reads as “live workflow”. */
const HERO_AGENT_HOT_ROTATION = {
  claude: ['Planning your task…', 'Reading repo + diff…', 'Drafting next steps…'],
  codex: ['Applying a patch…', 'Editing files (Codex)…', 'Running CLI locally…'],
  cursor: ['Handoff to Cursor…', 'Pasting into agent…', 'Waiting in editor…'],
};
const HERO_AGENT_IDLE = {
  claude: 'Standby · Claude Code',
  codex: 'Standby · Codex CLI',
  cursor: 'Standby · Cursor bridge',
};

/** Interval for rotating agent pairs + status lines (ms). Higher = easier to read. */
const HERO_TICK_MS = 1500;

// ---------------- Hero ----------------
const Hero = () => {
  const [tick, setTick] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const { ref: heroRevealRef, revealStyle: heroRevealStyle } = useReveal(70);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), HERO_TICK_MS);
    return () => clearInterval(t);
  }, [reduceMotion]);
  const pairIdx = reduceMotion ? 0 : tick % HERO_PAIR_STEPS.length;
  const duo = HERO_PAIR_STEPS[pairIdx];
  const duoSet = new Set(duo);

  const agents = useMemo(() => {
    const beat = reduceMotion ? 0 : tick % 3;
    const hotIdx = new Set(HERO_PAIR_STEPS[pairIdx]);
    const ids = ['claude', 'codex', 'cursor'];
    return ids.map((id, i) => {
      const hot = hotIdx.has(i);
      const status = hot ? HERO_AGENT_HOT_ROTATION[id][beat] : HERO_AGENT_IDLE[id];
      const delta = hot ? (id === 'cursor' ? 'live' : id === 'claude' ? '+18' : '+04') : '—';
      return { name: id, status, delta };
    });
  }, [tick, pairIdx, reduceMotion]);

  const nodeDefs = useMemo(() => ([
    { x: 160, y: 50, label: 'Claude', sub: 'v2.1.138', color: T.amber },
    { x: 240, y: 180, label: 'Codex', sub: '0.130.0', color: T.green },
    { x: 80, y: 180, label: 'Cursor', sub: 'editor bridge', color: T.violet },
  ]), []);
  return (
    <div ref={heroRevealRef} style={{ position: 'relative', padding: '108px 0 0', overflow: 'visible', ...heroRevealStyle }}>
      {/* faint grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.6, pointerEvents: 'none',
        backgroundImage: `linear-gradient(${T.hair} 1px, transparent 1px), linear-gradient(90deg, ${T.hair} 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black 30%, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black 30%, transparent 75%)',
      }} />

      <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', padding: '0 32px', position: 'relative' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 12px', border: '1px solid ' + T.hair, borderRadius: 999, marginBottom: 48 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: T.accent, boxShadow: '0 0 12px ' + T.accentGlow }} />
          <Mono style={{ color: T.inkDim }}>v0.7.2 · private beta</Mono>
          <span style={{ width: 1, height: 12, background: T.hair }} />
          <Mono style={{ color: T.inkMute }}>local-first · macOS only</Mono>
        </div>

        <h1
          className={`vmax-hero-title${reduceMotion ? ' vmax-hero-no-motion' : ''}`}
          style={{
            margin: 0,
            fontFamily: T.sans,
            fontWeight: 500,
            fontSize: fz(88),
            lineHeight: 1.1,
            letterSpacing: -3.5,
            maxWidth: 1100,
            color: T.ink,
          }}
        >
          <span className="vmax-hero-line vmax-hero-line-top" style={{ display: 'block' }}>
            {['Manage', 'your'].map((w, i) => (
              <span
                key={w}
                className="vmax-hero-word"
                style={{ animationDelay: reduceMotion ? '0ms' : `${i * 95}ms` }}
              >
                {w}{i === 0 ? '\u00a0' : ''}
              </span>
            ))}
          </span>
          <span className="vmax-hero-subblock" style={{ display: 'inline-block' }}>
            <span className="vmax-hero-line-gradient-wrap" style={{ display: 'inline' }}>
              <span
                className="vmax-hero-word vmax-hero-gradient-line"
                style={{ animationDelay: reduceMotion ? '0ms' : '210ms' }}
              >
                coding agents.
              </span>
            </span>
          </span>
        </h1>

        <p style={{
          margin: '36px 0 0', maxWidth: 580,
          fontSize: fz(17), lineHeight: 1.5, color: T.inkDim, fontFamily: T.sans,
        }}>
          Vmax is the manager for coding agents: Claude, Codex, and Cursor route through one workspace,
          with live logs, human gates, isolated worktrees, and a written recap after every run.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 40, alignItems: 'center' }}>
          <span className="vmax-rainbow-ring">
            <Btn variant="primary" size="lg" {...macDownloadBtnProps(MAC_DOWNLOAD_URL)}>Download for macOS<span style={{ opacity: 0.4, fontFamily: T.mono, fontSize: fz(11) }}>↓ 38mb</span></Btn>
          </span>
          <Btn variant="secondary" size="lg">Read the docs →</Btn>
          <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <Mono>used by engineers at</Mono>
            <div style={{ display: 'flex', gap: 14, fontFamily: T.sans, fontSize: fz(12.5), color: T.inkMute, fontWeight: 500, letterSpacing: -0.2 }}>
              <span>Forge</span><span>Caldera</span><span>Northwind</span><span>Heron</span>
            </div>
          </div>
        </div>

        {/* Hero visual: instrument cluster */}
        <div style={{ marginTop: 88, position: 'relative' }}>
          <div style={{
            border: '1px solid ' + T.hair, borderRadius: 14, background: T.card,
            overflow: 'hidden', boxShadow: '0 80px 120px -60px rgba(0,0,0,0.8)',
          }}>
            {/* window chrome */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid ' + T.hair, gap: 14 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['#2a3548', '#2a3548', '#2a3548'].map((c, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: c, border: '1px solid rgba(235,240,231,0.06)' }} />)}
              </div>
              <Mono style={{ marginLeft: 8 }}>vmax · workspace · exec/main · 25 changed</Mono>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Tag>⌘ K</Tag>
                <Tag tone="light">●  recording</Tag>
              </div>
            </div>

            {/* body grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1fr', minHeight: 380 }}>
              {/* left: My Tasks */}
              <div style={{ padding: 22, borderRight: '1px solid ' + T.hair }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Mono style={{ color: T.inkMute, textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>my tasks ·</span>
                    <span
                      style={{
                        color: T.accent,
                        fontWeight: 600,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: 'rgba(0, 46, 120, 0.14)',
                        border: '1px solid rgba(0, 46, 120, 0.35)',
                      }}
                    >
                      linear
                    </span>
                  </Mono>
                  <Mono>02/13</Mono>
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, fontFamily: T.mono, fontSize: fz(11) }}>
                  {['ALL 13', 'CULIN 11', 'VMAX 2'].map((x, i) => (
                    <span key={x} style={{
                      padding: '4px 8px', borderRadius: 4, border: '1px solid ' + (i === 2 ? T.hairStrong : T.hair),
                      color: i === 2 ? T.ink : T.inkMute, background: i === 2 ? T.cardHi : 'transparent',
                    }}>{x}</span>
                  ))}
                </div>
                {[
                  { id: 'EXE-30', t: 'track context to obsidian when added', tag: 'Vmax' },
                  { id: 'EXE-35', t: 'auto commit messages for agent push contexts', tag: 'Vmax' },
                  { id: 'EXE-28', t: 'voice → plan brief routing', tag: 'EXE' },
                  { id: 'EXE-22', t: 'cursor handoff: open file at line', tag: 'EXE' },
                ].map((row, i) => (
                  <div key={row.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid ' + T.hair }}>
                    <Mono style={{ color: T.inkMute, minWidth: 52 }}>{row.id}</Mono>
                    <div style={{ flex: 1, fontSize: fz(13), color: T.ink, lineHeight: 1.4 }}>
                      {row.t}
                      <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                        <Mono style={{ color: T.inkFaint }}>todo</Mono>
                        <Mono style={{ color: T.inkFaint }}>·</Mono>
                        <Mono style={{ color: T.inkMute }}>{row.tag}</Mono>
                      </div>
                    </div>
                    <div style={{ width: 16, height: 16, border: '1px solid ' + T.hairStrong, borderRadius: 4, marginTop: 2 }} />
                  </div>
                ))}
              </div>

              {/* center: agent diagram */}
              <div style={{ padding: 22, borderRight: '1px solid ' + T.hair, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Mono style={{ color: T.inkMute, textTransform: 'uppercase' }}>live agents</Mono>
                  <Mono>3 connected</Mono>
                </div>
                <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 320 280" style={{ width: '100%', height: '100%' }}>
                    <defs>
                      <radialGradient id="rg" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(235,240,231,0.1)" />
                        <stop offset="100%" stopColor="rgba(235,240,231,0)" />
                      </radialGradient>
                      <filter id="vx-line-glow" x="-55%" y="-55%" width="210%" height="210%">
                        <feGaussianBlur stdDeviation="2.2" result="b" />
                        <feMerge>
                          <feMergeNode in="b" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                      <radialGradient id="vx-hub-pulse" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(235,240,231,0.14)" />
                        <stop offset="70%" stopColor="rgba(235,240,231,0)" />
                      </radialGradient>
                    </defs>
                    <circle cx="160" cy="140" r="120" fill="url(#rg)" />
                    {!reduceMotion && (
                      <>
                        {/* misaligned halo so rotation reads */}
                        <g>
                          <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 160 140" to="360 160 140" dur="28s" repeatCount="indefinite" />
                          <ellipse cx="175" cy="128" rx="108" ry="96" fill="none" stroke="rgba(127,183,150,0.075)" strokeWidth="1.2" />
                        </g>
                        <circle cx="160" cy="140" r="94" fill="none" stroke={T.hair} strokeWidth="0.85" strokeDasharray="6 14" opacity={0.9}>
                          <animate attributeName="stroke-dashoffset" from="0" to="-140" dur="7s" repeatCount="indefinite" />
                        </circle>
                      </>
                    )}
                    <circle cx="160" cy="140" r="80" fill="none" stroke={T.hair} strokeDasharray="2 4" opacity={0.95}>
                      {!reduceMotion && (
                        <animate attributeName="stroke-dashoffset" from="0" to="-72" dur="4.8s" repeatCount="indefinite" />
                      )}
                    </circle>
                    <circle cx="160" cy="140" r="48" fill="none" stroke={T.hairStrong} />
                    {/* center */}
                    {!reduceMotion && (
                      <circle cx="160" cy="140" r="46" fill="none" stroke="rgba(235,240,231,0.08)" strokeWidth="12">
                        <animate attributeName="opacity" attributeType="CSS" values="0.55;1;0.55" dur="2.2s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx="160" cy="140" r="34" fill={T.bg} stroke={T.hairStrong} />
                    <circle cx="160" cy="140" r="64" fill="url(#vx-hub-pulse)" style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
                      {!reduceMotion && (
                        <>
                          <animate attributeName="r" values="58;76;58" dur="3.8s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.5;1;0.42" dur="3.8s" repeatCount="indefinite" />
                        </>
                      )}
                    </circle>
                    <text x="160" y="138" textAnchor="middle" fill={T.ink} fontFamily={T.sans} fontSize={fz(11)} fontWeight="600">Vmax</text>
                    <text x="160" y="151" textAnchor="middle" fill={T.inkMute} fontFamily={T.mono} fontSize={fz(8)}>manager</text>
                    {/* dormant spokes first */}
                    {nodeDefs.map((n, i) => {
                      const hot = duoSet.has(i);
                      return (
                        <g key={`hero-spoke-${i}`}>
                          {!hot && (
                            <line x1="160" y1="140" x2={n.x} y2={n.y} stroke={T.hair} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.45} />
                          )}
                        </g>
                      );
                    })}
                    {/* glowing active spokes */}
                    {nodeDefs.map((n, i) => {
                      const len = Math.hypot(n.x - 160, n.y - 140);
                      const dash = reduceMotion ? len : Math.max(24, Math.min(44, len * 0.32));
                      const hot = duoSet.has(i);
                      return hot ? (
                        <g key={`hero-hot-${i}`}>
                          <line x1="160" y1="140" x2={n.x} y2={n.y} stroke={n.color} strokeWidth={1.4} strokeLinecap="round" opacity={0.35} />
                          {!reduceMotion && (
                            <>
                              <line
                                x1="160"
                                y1="140"
                                x2={n.x}
                                y2={n.y}
                                stroke={n.color}
                                strokeWidth={3}
                                strokeLinecap="round"
                                opacity={0.45}
                                filter="url(#vx-line-glow)"
                                strokeDasharray={`${dash} ${len}`}
                              >
                                <animate attributeName="stroke-dashoffset" from="0" to={-(len + dash)} dur="1.05s" repeatCount="indefinite" />
                              </line>
                              <circle r="5" fill={n.color} opacity={0}>
                                <animateMotion dur="1.05s" repeatCount="indefinite" path={`M160,140 L${n.x},${n.y}`} />
                                <animate attributeName="opacity" values="0;1;0" dur="1.05s" repeatCount="indefinite" />
                              </circle>
                              <circle r="2.8" fill={T.ink} opacity={0}>
                                <animateMotion dur="1.05s" repeatCount="indefinite" begin="0.28s" path={`M160,140 L${n.x},${n.y}`} />
                                <animate attributeName="opacity" values="0;1;0" dur="1.05s" repeatCount="indefinite" begin="0.28s" />
                              </circle>
                            </>
                          )}
                          {!reduceMotion && (
                            <line
                              x1="160"
                              y1="140"
                              x2={n.x}
                              y2={n.y}
                              stroke={T.ink}
                              strokeWidth={0.9}
                              strokeLinecap="round"
                              strokeDasharray={`4 ${Math.max(len - 4, 4)}`}
                              opacity={0.45}
                            >
                              <animate attributeName="stroke-dashoffset" from="0" to={-(len + 24)} dur="1.65s" repeatCount="indefinite" />
                            </line>
                          )}
                        </g>
                      ) : null;
                    })}
                    {/* nodes */}
                    {nodeDefs.map((n, i) => {
                      const hot = duoSet.has(i);
                      return (
                        <g key={`hero-node-${i}`}>
                          {!reduceMotion && hot && (
                            <circle cx={n.x} cy={n.y} r="30" fill="none" stroke={n.color} strokeWidth={1} opacity={0.25}>
                              <animate attributeName="r" values="26;36;26" dur="2.35s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.6;0.15;0.6" dur="2.35s" repeatCount="indefinite" />
                            </circle>
                          )}
                          <circle cx={n.x} cy={n.y} r="24" fill={T.bg} stroke={n.color} strokeWidth={hot ? 1.65 : 1} opacity={hot ? 1 : 0.45} />
                          <text x={n.x} y={n.y - 1} textAnchor="middle" fill={T.ink} fontFamily={T.sans} fontSize={fz(10)} fontWeight="500">{n.label}</text>
                          <text x={n.x} y={n.y + 11} textAnchor="middle" fill={T.inkMute} fontFamily={T.mono} fontSize={fz(7)}>{n.sub}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, minWidth: 0 }}>
                  {agents.map((a, i) => {
                    const pulse = duoSet.has(i);
                    const agentColor = nodeDefs[i]?.color ?? T.green;
                    const deltaColor =
                      a.delta.startsWith('+') || a.delta === 'live' ? T.green : T.inkFaint;
                    return (
                      <div
                        key={a.name}
                        title={pulse ? `${a.name}: active — ${a.status}` : `${a.name}: ${a.status}`}
                        style={{
                          minWidth: 0,
                          maxWidth: '100%',
                          overflow: 'hidden',
                          padding: '8px 10px',
                          border: `1px solid ${pulse ? T.hairStrong : T.hair}`,
                          borderRadius: 6,
                          ...(pulse && !reduceMotion
                            ? {
                                boxShadow: `0 0 0 1px rgba(235,240,231,0.06), 0 14px 32px -12px ${agentColor}`,
                              }
                            : {}),
                          transition: 'border-color 380ms ease-out, box-shadow 380ms ease-out',
                        }}
                      >
                      <Mono style={{ color: T.inkDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{a.name}</Mono>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
                        <Mono style={{
                          color: T.ink,
                          fontSize: fz(11),
                          lineHeight: 1.35,
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        >{a.status}</Mono>
                        <Mono style={{ color: deltaColor, flexShrink: 0, fontSize: fz(11) }}>{a.delta}</Mono>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* right: terminal */}
              <div style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Mono style={{ color: T.inkMute }}>
                    <span style={{ textTransform: 'uppercase' }}>recap · </span>
                    <span style={{ textTransform: 'none' }}>ClaudeCodex_Run4823</span>
                  </Mono>
                  <Tag tone="light">passed</Tag>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: fz(11.5), lineHeight: 1.65, color: T.inkDim, flex: 1 }}>
                  <div style={{ color: T.inkMute }}># intent</div>
                  <div style={{ color: T.ink }}>render UI before vehicle_state sync on iOS startup</div>
                  <div style={{ color: T.inkMute, marginTop: 10 }}># pipeline</div>
                  <div>claude · plan <span style={{ color: T.green }}>✓</span></div>
                  <div>cursor · patch <span style={{ color: T.green }}>✓</span></div>
                  <div>codex · verify <span style={{ color: T.green }}>✓</span></div>
                  <div style={{ color: T.inkMute, marginTop: 10 }}># files touched</div>
                  <div>ios/App/Boot.swift</div>
                  <div>ios/UI/SplashScene.swift</div>
                  <div>ios/State/VehicleStore.swift</div>
                  <div style={{ color: T.inkMute, marginTop: 10 }}># cost</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>gpt5.5 → opus → haiku</span>
                    <span style={{ color: T.green }}>$0.21</span>
                  </div>
                </div>
              </div>
            </div>

            {/* terminal strip — continuous with workspace (no hard divider) */}
            <div style={{ padding: '16px 22px', fontFamily: T.mono, fontSize: fz(11.5), color: T.inkDim, display: 'flex', gap: 24 }}>
              <span style={{ color: T.inkMute }}>$</span>
              <span>Scanning repo… Watching exec on main.</span>
              <span style={{ color: T.inkFaint }}>·</span>
              <span>25 changed files.</span>
              <span style={{ color: T.inkFaint }}>·</span>
              <span style={{ color: T.green }}>[linear] 13 issues loaded</span>
              <span style={{ marginLeft: 'auto', color: T.inkMute }}>Ready. Paste a task, then ⌘↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------- Instrument Panels (Product story) ----------------
const InstrumentPanel = ({
  tag, title, kpiLabel, delta, children, kpiCount, active, reduceMotion,
}) => {
  const n = useCountUp(kpiCount.end, active, reduceMotion, kpiCount.durationMs ?? 1450);
  const kpiStr = formatKpiNum(n, kpiCount);
  return (
    <div className="vmax-panel-cell" style={{
      border: '1px solid ' + T.hair, borderRadius: 14, background: T.card,
      padding: 22, display: 'flex', flexDirection: 'column', gap: 18,
      transition: 'border-color 160ms',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = T.hairStrong}
      onMouseLeave={e => e.currentTarget.style.borderColor = T.hair}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Mono style={{ color: T.inkMute, textTransform: 'uppercase' }}>{tag}</Mono>
        <Mono style={{ color: T.inkFaint }}>illustrative</Mono>
      </div>
      <div>
        <div style={{ fontFamily: T.sans, fontSize: fz(38), fontWeight: 500, letterSpacing: -1, color: T.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          {kpiStr}
          {delta && <span style={{ fontSize: fz(13), color: T.green, fontFamily: T.mono, letterSpacing: 0 }}>↑ {delta}</span>}
        </div>
        <div style={{ marginTop: 8, fontSize: fz(13), color: T.inkDim, fontFamily: T.sans, letterSpacing: -0.1 }}>{kpiLabel}</div>
      </div>
      <div style={{ flex: 1, minHeight: 120 }}>{children}</div>
      <div style={{ fontSize: fz(13.5), color: T.ink, fontFamily: T.sans, fontWeight: 500, letterSpacing: -0.2 }}>{title}</div>
    </div>
  );
};

const BarChart = ({ active, reduceMotion }) => {
  const bars = [22, 38, 31, 54, 48, 71, 64, 82, 76, 88, 72, 90];
  const p = useCountUp(1, active, reduceMotion, 1100);
  return (
    <svg viewBox="0 0 320 110" style={{ width: '100%', height: 110 }}>
      <line x1="0" y1="105" x2="320" y2="105" stroke={T.hair} />
      {bars.map((h, i) => {
        const stagger = i * 0.055;
        const t = Math.max(0, Math.min(1, (p * 1.2 - stagger) / (1 - stagger + 0.001)));
        const H = h * t;
        return (
          <rect key={i} x={i * 27 + 4} y={105 - H} width="18" height={H}
            fill={i === bars.length - 1 ? T.ink : 'rgba(235,240,231,0.12)'}
            stroke={i === bars.length - 1 ? T.ink : 'rgba(235,240,231,0.18)'}
            strokeWidth="0.5" />
        );
      })}
    </svg>
  );
};

const DonutChart = ({ segs, active, reduceMotion }) => {
  const total = segs.reduce((a, b) => a + b.value, 0);
  let acc = 0;
  const r = 42, c = 2 * Math.PI * r;
  const t = useCountUp(1, active, reduceMotion, 1300);
  const scale = reduceMotion ? 1 : 0.82 + 0.18 * t;
  const rot = reduceMotion ? 0 : -14 * (1 - t);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, height: '100%' }}>
      <svg viewBox="0 0 120 120" width="120" height="120" style={{ flexShrink: 0, overflow: 'visible' }}>
        <g transform={`translate(60 60) rotate(${rot}) scale(${scale}) translate(-60 -60)`} style={{ opacity: reduceMotion ? 1 : 0.15 + 0.85 * t }}>
          <circle cx="60" cy="60" r={r} stroke={T.hair} strokeWidth="14" fill="none" />
          {segs.map((s, i) => {
            const len = (s.value / total) * c;
            const off = -acc;
            acc += len;
            return (
              <circle key={i} cx="60" cy="60" r={r} stroke={s.color} strokeWidth="14" fill="none"
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={off}
                transform="rotate(-90 60 60)" strokeLinecap="butt" />
            );
          })}
        </g>
        <text x="60" y="58" textAnchor="middle" fill={T.ink} fontFamily={T.sans} fontSize={fz(16)} fontWeight="500">{total}</text>
        <text x="60" y="72" textAnchor="middle" fill={T.inkMute} fontFamily={T.mono} fontSize={fz(8)}>RUNS / 24H</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.mono, fontSize: fz(11) }}>
            <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
            <span style={{ color: T.inkDim }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Heatmap = ({ active, reduceMotion }) => {
  const rows = 7, cols = 24;
  const cells = useMemo(() => Array.from({ length: rows * cols }, (_, i) => {
    const v = Math.sin(i * 0.7) * 0.4 + Math.cos(i * 0.3) * 0.3 + Math.sin(i * 1.1) * 0.2 + 0.35;
    return Math.max(0, Math.min(1, v));
  }), []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
      {cells.map((v, i) => (
        <div
          key={i}
          style={{
            aspectRatio: '1',
            borderRadius: 2,
            background: v > 0.7 ? `rgba(235,240,231,${0.15 + v * 0.42})` : `rgba(235,240,231,${0.04 + v * 0.08})`,
            opacity: reduceMotion || active ? 1 : 0,
            transform: reduceMotion || active ? 'scale(1)' : 'scale(0.6)',
            transition: reduceMotion ? 'none' : `opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)`,
            transitionDelay: reduceMotion || !active ? '0ms' : `${Math.floor(i / cols) * 22 + (i % cols) * 12}ms`,
          }}
        />
      ))}
    </div>
  );
};

const Funnel = ({ active, reduceMotion }) => {
  const stages = [
    { label: 'intent', value: 100 },
    { label: 'plan', value: 84 },
    { label: 'agents', value: 71 },
    { label: 'verified', value: 62 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stages.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mono style={{ color: T.inkMute, width: 60 }}>{s.label}</Mono>
          <div style={{ flex: 1, height: 18, background: 'rgba(235,240,231,0.05)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              width: s.value + '%',
              transform: active ? 'scaleX(1)' : 'scaleX(0)',
              transformOrigin: 'left center',
              transition: reduceMotion ? 'none' : `transform 820ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 100}ms`,
              background: `linear-gradient(90deg, rgba(0,46,120,0.35), rgba(235,240,231,0.12))`,
              borderRight: '1px solid ' + T.hairStrong,
            }} />
          </div>
          <Mono style={{ color: T.ink, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.value}%</Mono>
        </div>
      ))}
    </div>
  );
};

const ProductStory = () => {
  const { ref: panelGridRef, live: panelsLive } = useRevealChildren({ threshold: 0.06 });
  const reduceMotion = usePrefersReducedMotion();
  const play = panelsLive;
  return (
    <Section id="product" topBorder={false} label="Product · instrument panel" title="One workspace to manage every coding agent."
      sub="Routing, observability, human gates, isolation, and recap, built around how senior engineers actually ship.">
      <div ref={panelGridRef} className={`vmax-panel-grid${panelsLive ? ' vmax-panel-grid-live' : ''}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
      <InstrumentPanel tag="pipeline" title="Intent → plan → agents → verified" kpiLabel="end-to-end pass rate, last 24h" delta="6.4"
        kpiCount={{ end: 62, decimals: 0, suffix: '%' }} active={play} reduceMotion={reduceMotion}>
        <Funnel active={play} reduceMotion={reduceMotion} />
      </InstrumentPanel>
      <InstrumentPanel tag="routing" title="Cross-agent routing by policy" kpiLabel="runs routed this week" delta="22.1"
        kpiCount={{ end: 318, decimals: 0, suffix: '' }} active={play} reduceMotion={reduceMotion}>
        <DonutChart segs={[
          { label: 'claude', value: 142, color: '#EBF0E7' },
          { label: 'codex', value: 98, color: '#002E78' },
          { label: 'cursor', value: 78, color: 'rgba(235,240,231,0.35)' },
        ]} active={play} reduceMotion={reduceMotion} />
      </InstrumentPanel>
      <InstrumentPanel tag="throughput" title="Tasks shipped per engineer / day" kpiLabel="vs 6.2 without orchestration" delta="84"
        kpiCount={{ end: 11.4, decimals: 1, suffix: '' }} active={play} reduceMotion={reduceMotion}>
        <BarChart active={play} reduceMotion={reduceMotion} />
      </InstrumentPanel>
      <InstrumentPanel tag="cost" title="Model economics, auto-routed" kpiLabel="avg cost per verified run" delta="38"
        kpiCount={{ end: 0.21, decimals: 2, prefix: '$' }} active={play} reduceMotion={reduceMotion}>
        <Heatmap active={play} reduceMotion={reduceMotion} />
      </InstrumentPanel>
    </div>
  </Section>
  );
};

// ---------------- Feature grid ----------------
const FeatureCard = ({ title, body, accent, children, span = 1 }) => (
  <div className="vmax-feature-cell" style={{
    gridColumn: `span ${span}`,
    border: '1px solid ' + T.hair, borderRadius: 14, background: T.card,
    padding: 26, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 320,
    overflow: 'hidden', position: 'relative',
    transition: 'border-color 160ms',
  }}
    onMouseEnter={e => e.currentTarget.style.borderColor = T.hairStrong}
    onMouseLeave={e => e.currentTarget.style.borderColor = T.hair}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Mono style={{ color: T.inkMute, textTransform: 'uppercase' }}>{accent}</Mono>
    </div>
    <h3 style={{ margin: 0, fontFamily: T.sans, fontSize: fz(22), fontWeight: 500, letterSpacing: -0.5, color: T.ink, lineHeight: 1.15 }}>{title}</h3>
    <p style={{ margin: 0, fontSize: fz(14), lineHeight: 1.55, color: T.inkDim, fontFamily: T.sans, maxWidth: 460 }}>{body}</p>
    <div style={{ flex: 1, marginTop: 8, minHeight: 100 }}>{children}</div>
  </div>
);

const VoiceWave = () => {
  const bars = 40;
  const heights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const base = Math.abs(Math.sin(i * 0.48)) * 0.58 + Math.abs(Math.cos(i * 0.31)) * 0.28;
        return Math.min(0.96, 0.2 + base);
      }),
    [bars],
  );
  const [tick, setTick] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (reduceMotion) return undefined;
    const id = setInterval(() => setTick(x => x + 1), 42);
    return () => clearInterval(id);
  }, [reduceMotion]);
  /** Wrapped playhead crosses bar strip (loop). */
  const head = reduceMotion ? bars * 0.62 : (tick * 0.11) % (bars + 8);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, border: '1px solid ' + T.hairStrong, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: T.green, boxShadow: '0 0 8px ' + T.green }} />
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'center', height: 36 }}>
          {heights.map((h, i) => {
            const mu = reduceMotion ? (i / bars > 0.58 ? 0.15 : 1) : Math.max(0, Math.min(1, head - i + 0.65));
            const fg = mu > 0.85 ? T.ink : `rgba(235,240,231,${0.08 + mu * 0.52})`;
            return (
              <div key={i} style={{ flex: 1, height: h * 32 + 4, background: fg, borderRadius: 1 }} />
            );
          })}
        </div>
        <Mono>{reduceMotion ? '0:14' : `0:${String((Math.floor(tick / 28)) % 20).padStart(2, '0')}`}</Mono>
      </div>
      <div style={{ padding: 12, borderRadius: 8, border: '1px solid ' + T.hair, fontFamily: T.mono, fontSize: fz(12), color: T.inkDim, lineHeight: 1.55 }}>
        <div style={{ marginBottom: 10 }}>
          <Mono style={{ fontSize: fz(10), letterSpacing: 0.06, marginBottom: 4, display: 'block', color: T.inkFaint }}>YOU</Mono>
          <span style={{ color: T.ink }}>&quot;Ship the auth flow isolated on a branch, and have Codex run tests before we open the PR.&quot;</span>
        </div>
        <div style={{ borderTop: `1px solid ${T.hair}`, paddingTop: 10 }}>
          <Mono style={{ fontSize: fz(10), letterSpacing: 0.06, marginBottom: 4, display: 'block', color: T.green }}>VMAX</Mono>
          <span style={{ color: T.inkDim }}>&quot;Got it: feat branch, gated test run, PR after green. Anything else risky, migrations or prod keys?&quot;</span>
        </div>
      </div>
    </div>
  );
};

const SessionList = () => {
  const { ref: wrapRef, live: rowsLive } = useRevealChildren({ threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

  const sessions = [
    { name: 'auth-flow-rewrite', repo: 'culin/api', branch: 'feat/auth-v2', agents: ['claude', 'codex'], status: 'running', delta: '+312/-184' },
    { name: 'splash-perf', repo: 'vmax/exec', branch: 'main', agents: ['cursor'], status: 'awaiting', delta: '+18/-04' },
    { name: 'obsidian-sync', repo: 'vmax/exec', branch: 'feat/obs', agents: ['claude'], status: 'paused', delta: '+44/-12' },
  ];
  return (
    <div
      ref={wrapRef}
      className={`vmax-sessions${rowsLive ? ' vmax-sessions-live' : ''}`}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      {sessions.map((s, i) => (
        <div
          key={i}
          className="vmax-session-row"
          style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px 70px', gap: 12, padding: '12px 0', borderTop: '1px solid ' + T.hair, alignItems: 'center' }}
        >
          <div>
            <div style={{ fontFamily: T.sans, fontSize: fz(13), color: T.ink }}>{s.name}</div>
            <Mono style={{ color: T.inkMute }}>{s.repo} · {s.branch}</Mono>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {s.agents.map(a => <Tag key={a}>{a}</Tag>)}
          </div>
          <Mono
            className={
              s.status === 'running'
                ? 'vmax-session-status vmax-session-running'
                : s.status === 'awaiting'
                  ? 'vmax-session-status vmax-session-awaiting'
                  : 'vmax-session-status'
            }
            style={{ color: s.status === 'running' ? T.green : s.status === 'awaiting' ? T.amber : T.inkMute }}
          >● {s.status}</Mono>
          <Mono style={{ textAlign: 'right', color: T.inkDim }}>{s.delta}</Mono>
        </div>
      ))}
    </div>
  );
};

const DiffPreview = () => (
  <div style={{ fontFamily: T.mono, fontSize: fz(11.5), lineHeight: 1.6, border: '1px solid ' + T.hair, borderRadius: 8, padding: 14, color: T.inkDim }}>
    <div style={{ color: T.inkMute, marginBottom: 8 }}>diff · ios/App/Boot.swift</div>
    <div><span style={{ color: T.inkFaint }}>  </span>func application(launch:Launch) {'{'}</div>
    <div style={{ color: 'rgba(255,120,120,0.85)' }}>- &nbsp; await syncVehicleState()</div>
    <div style={{ color: 'rgba(255,120,120,0.85)' }}>- &nbsp; render(UI.splash)</div>
    <div style={{ color: T.green }}>+ &nbsp; render(UI.splash)</div>
    <div style={{ color: T.green }}>+ &nbsp; Task {'{'} await syncVehicleState() {'}'}</div>
    <div><span style={{ color: T.inkFaint }}>  </span>{'}'}</div>
  </div>
);

const ApprovalCard = () => (
  <div style={{ border: '1px solid ' + T.hairStrong, borderRadius: 10, padding: 14, background: T.cardHi }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: T.amber }} />
      <Mono style={{ color: T.ink, textTransform: 'uppercase' }}>approval required</Mono>
    </div>
    <div style={{ fontFamily: T.sans, fontSize: fz(13), color: T.ink, lineHeight: 1.5, marginBottom: 12 }}>
      Codex wants to <span style={{ color: T.ink, background: 'rgba(216,179,117,0.12)', padding: '0 4px', borderRadius: 3 }}>git push --force-with-lease origin feat/auth-v2</span>.
      This rewrites 3 commits.
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <Btn variant="primary" size="sm">Approve</Btn>
      <Btn variant="secondary" size="sm">Deny</Btn>
      <Btn variant="ghost" size="sm">Open diff</Btn>
    </div>
  </div>
);

const Features = () => {
  const { ref: featureGridRef, live: featuresLive } = useRevealChildren({ threshold: 0.05 });
  return (
    <Section id="features" label="Capabilities" title="Six surfaces. One workflow." sub="Each feature is a thin layer over the runners you already use. No fork. No lock-in.">
      <div ref={featureGridRef} className={`vmax-feature-grid${featuresLive ? ' vmax-feature-grid-live' : ''}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
      <FeatureCard span={3} accent="01 · voice" title="Say it sloppy. We talk back until it makes sense." body="Hold ⌥ and ramble intent in your own words. Vmax answers with sharp follow-ups so you surface what you're actually optimizing for, then turns that into a structured task: repo, branch, gates, and the right runner.">
        <VoiceWave />
      </FeatureCard>
      <FeatureCard span={3} accent="02 · workspace" title="Every session, repo, and run in one pane." body="Workspace is your live session. Tasks, plans, run output, and the live agent graph live side-by-side. Switch repos without losing context.">
        <SessionList />
      </FeatureCard>
      <FeatureCard span={2} accent="03 · approval" title="Human gates on the risky stuff." body="Define what needs approval: pushes, deletions, prod migrations. Vmax pauses agents and waits for you.">
        <ApprovalCard />
      </FeatureCard>
      <FeatureCard span={2} accent="04 · isolation" title="Worktrees, not wreckage." body="Every run gets its own branch and worktree. Experiments stay quarantined until you promote them.">
        <div style={{ fontFamily: T.mono, fontSize: fz(11.5), color: T.inkDim, lineHeight: 1.7 }}>
          <div>~/code/culin/<span style={{ color: T.ink }}>main</span></div>
          <div style={{ paddingLeft: 14, color: T.inkMute }}>├ <span style={{ color: T.ink }}>.worktrees/auth-v2</span> <span style={{ color: T.green }}>● running</span></div>
          <div style={{ paddingLeft: 14, color: T.inkMute }}>├ <span style={{ color: T.ink }}>.worktrees/splash-perf</span> <span style={{ color: T.amber }}>● review</span></div>
          <div style={{ paddingLeft: 14, color: T.inkMute }}>└ <span style={{ color: T.ink }}>.worktrees/obs-sync</span> <span style={{ color: T.inkFaint }}>● paused</span></div>
          <div style={{ marginTop: 10 }}>3 worktrees · 0 conflicts</div>
        </div>
      </FeatureCard>
      <FeatureCard span={2} accent="05 · diff & PR" title="Reviewable narratives, not patch spam." body="After each run, get a written summary with intent, files touched, risk, and follow-ups, ready to paste into a PR.">
        <DiffPreview />
      </FeatureCard>
      </div>
    </Section>
  );
};

// ---------------- Workflow strip ----------------
const Workflow = () => {
  const steps = [
    { n: '01', t: 'Capture', sub: 'Voice, Linear issue, or paste.', body: 'Vmax accepts intent in any form. Voice transcripts route through a brief-writer; Linear tasks pull labels, priority, and links.' },
    { n: '02', t: 'Plan', sub: 'Claude drafts the approach.', body: 'A reasoning model proposes a plan: files to touch, risk surface, runner assignment, approval gates, editable before kickoff.' },
    { n: '03', t: 'Route', sub: 'Right agent for the step.', body: 'Heavy reasoning on Claude. IDE-native work on Cursor. CLI patches on Codex. Routing is policy, not a coin flip.' },
    { n: '04', t: 'Run', sub: 'Live logs, human gates.', body: 'Subprocess stdout streams in real time. Defined gates pause for approval. Worktrees keep experiments out of main.' },
    { n: '05', t: 'Recap', sub: 'A written record of reality.', body: 'Every run yields a structured recap: intent, outcomes, failures, files. Memory persists per repo and per task.' },
  ];
  const [active, setActive] = useState(0);
  return (
    <Section id="workflow" label="The loop" title="A workflow that survives Monday morning.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0, border: '1px solid ' + T.hair, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '1px solid ' + T.hair }}>
          {steps.map((s, i) => (
            <button key={i} onClick={() => setActive(i)} style={{
              padding: '24px 22px', textAlign: 'left',
              background: active === i ? T.cardHi : 'transparent',
              border: 'none', borderRight: i < steps.length - 1 ? '1px solid ' + T.hair : 'none',
              cursor: 'pointer', fontFamily: T.sans, color: T.ink,
              transition: 'background 160ms',
            }}>
              <Mono style={{ color: active === i ? T.ink : T.inkFaint, display: 'block', marginBottom: 14 }}>{s.n}</Mono>
              <div style={{ fontSize: fz(17), fontWeight: 500, letterSpacing: -0.3, color: active === i ? T.ink : T.inkDim }}>{s.t}</div>
              <div style={{ marginTop: 4, fontSize: fz(12.5), color: active === i ? T.inkDim : T.inkMute, lineHeight: 1.4 }}>{s.sub}</div>
            </button>
          ))}
        </div>
        <div style={{ padding: '40px 32px', display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 48, alignItems: 'start' }}>
          <div>
            <Mono style={{ color: T.inkMute }}>STEP {steps[active].n}</Mono>
            <h3 style={{ margin: '12px 0 16px', fontFamily: T.sans, fontSize: fz(34), fontWeight: 500, letterSpacing: -0.8, color: T.ink, lineHeight: 1.1 }}>{steps[active].t}.</h3>
            <p style={{ margin: 0, fontSize: fz(15), lineHeight: 1.6, color: T.inkDim, maxWidth: 380 }}>{steps[active].body}</p>
          </div>
          <div style={{ border: '1px solid ' + T.hair, borderRadius: 10, padding: 22, background: T.bg, minHeight: 240, fontFamily: T.mono, fontSize: fz(12), color: T.inkDim, lineHeight: 1.75 }}>
            {active === 0 && (<>
              <div style={{ color: T.inkMute }}>// captured 14s of voice</div>
              <div style={{ color: T.ink }}>{'>'} ship auth-v2 on a branch.</div>
              <div style={{ color: T.ink }}>{'>'} run the suite before the pr.</div>
              <div style={{ marginTop: 10, color: T.inkMute }}>// brief-writer:</div>
              <div>{'{'} task: "Implement auth v2",</div>
              <div>&nbsp;&nbsp;branch: "feat/auth-v2",</div>
              <div>&nbsp;&nbsp;gates: ["tests_pass", "pr_open"] {'}'}</div>
            </>)}
            {active === 1 && (<>
              <div style={{ color: T.inkMute }}># plan · claude-sonnet-4.5</div>
              <div>1. fork worktree feat/auth-v2</div>
              <div>2. swap session middleware</div>
              <div>3. add cookie rotation (+tests)</div>
              <div>4. run integration suite</div>
              <div>5. open PR · request review from @ash</div>
              <div style={{ marginTop: 10, color: T.amber }}>! requires approval: db migration</div>
            </>)}
            {active === 2 && (<>
              <div style={{ color: T.inkMute }}># routing policy</div>
              <div>step 1 → cursor <span style={{ color: T.inkMute }}>// worktree ops</span></div>
              <div>step 2 → claude <span style={{ color: T.inkMute }}>// reasoning</span></div>
              <div>step 3 → codex &nbsp;<span style={{ color: T.inkMute }}>// patch + tests</span></div>
              <div>step 4 → codex &nbsp;<span style={{ color: T.inkMute }}>// run suite</span></div>
              <div>step 5 → claude <span style={{ color: T.inkMute }}>// pr narrative</span></div>
            </>)}
            {active === 3 && (<>
              <div style={{ color: T.green }}>[codex] running suite (412 tests)</div>
              <div>passed: 410 · failed: 2 · skipped: 0</div>
              <div style={{ color: 'rgba(255,140,140,0.85)' }}>FAIL auth.session.rotation_test</div>
              <div style={{ color: T.inkMute }}>{'>'} claude retrying with patched cookie key</div>
              <div style={{ color: T.green }}>[codex] re-run · passed: 412</div>
              <div style={{ color: T.amber }}>⏸ paused for approval: pr_open</div>
            </>)}
            {active === 4 && (<>
              <div style={{ color: T.inkMute }}># recap · ClaudeCodex_Run4823</div>
              <div>intent: auth v2, branch-isolated</div>
              <div>outcome: <span style={{ color: T.green }}>passed</span> (412/412)</div>
              <div>files: 8 changed · +312 -184</div>
              <div>cost: $0.41 · 18m wall</div>
              <div>follow-ups: rotate prod keys (mon)</div>
              <div style={{ marginTop: 10, color: T.inkMute }}>// saved to /memory/auth-v2.md</div>
            </>)}
          </div>
        </div>
      </div>
    </Section>
  );
};

// ---------------- Pricing ----------------
const Pricing = () => {
  const { ref: pricingGridRef, live: pricingLive } = useRevealChildren({ threshold: 0.1 });
  const plans = [
    { name: 'Solo', price: 'Free', desc: 'For one engineer, local machine.', cta: 'Download', features: ['Unlimited workspaces', 'Claude / Codex / Cursor', 'Local memory store', 'BYO API keys'] },
    { name: 'Team', price: '$24', unit: '/seat / month', desc: 'For pods running 3+ agents in parallel.', cta: 'Start trial', features: ['Everything in Solo', 'Shared routing policies', 'Linear & GitHub sync', 'Team-wide recap library', 'Audit log + approvals'], featured: true },
    { name: 'Org', price: 'Contact', desc: 'SSO, SOC 2, private runners.', cta: 'Talk to us', features: ['Everything in Team', 'SSO + SCIM', 'Self-hosted runners', 'Custom approval policies', 'Priority support'] },
  ];
  return (
    <Section id="pricing" label="Pricing" title="Pay for orchestration. Not for tokens." sub="Vmax uses your existing API keys. We don't markup model usage, so you see the same cost a curl would.">
      <div ref={pricingGridRef} className={`vmax-pricing-grid${pricingLive ? ' vmax-pricing-grid-live' : ''}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {plans.map(p => (
          <div key={p.name} className="vmax-pricing-card" style={{
            border: '1px solid ' + (p.featured ? T.hairStrong : T.hair), borderRadius: 14,
            background: p.featured ? T.cardHi : T.card, padding: 28, display: 'flex', flexDirection: 'column', gap: 20,
            position: 'relative',
          }}>
            {p.featured && (
              <div style={{ position: 'absolute', top: 14, right: 14 }}><Tag tone="light">popular</Tag></div>
            )}
            <div>
              <Mono style={{ color: T.inkMute, textTransform: 'uppercase' }}>{p.name}</Mono>
              <div style={{ marginTop: 14, fontFamily: T.sans, fontSize: fz(42), fontWeight: 500, letterSpacing: -1.2, color: T.ink, lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {p.price}
                {p.unit && <span style={{ fontSize: fz(13), color: T.inkMute, fontFamily: T.sans, letterSpacing: -0.1, fontWeight: 400 }}>{p.unit}</span>}
              </div>
              <p style={{ margin: '14px 0 0', fontSize: fz(13.5), color: T.inkDim, lineHeight: 1.5 }}>{p.desc}</p>
            </div>
            <Btn variant={p.featured ? 'primary' : 'secondary'} size="md" {...(p.cta === 'Download' ? macDownloadBtnProps(MAC_DOWNLOAD_URL) : {})}>{p.cta} →</Btn>
            <div style={{ borderTop: '1px solid ' + T.hair, paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {p.features.map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: fz(13), color: T.ink, fontFamily: T.sans }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke={T.inkDim} strokeWidth="1.3" /></svg>
                  {f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
};

// ---------------- CTA + Footer ----------------
const CTA = () => {
  const { ref, revealStyle } = useReveal(0);
  return (
  <section id="cta" ref={ref} style={{ padding: '120px 0', borderTop: '1px solid ' + T.hair, position: 'relative', overflow: 'hidden', ...revealStyle }}>
    <div style={{
      position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none',
      backgroundImage: `radial-gradient(circle at 50% 100%, rgba(0, 46, 120, 0.18), transparent 60%)`,
    }} />
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 32px', textAlign: 'center', position: 'relative' }}>
      <h2 style={{ margin: 0, fontFamily: T.sans, fontSize: fz(64), fontWeight: 500, letterSpacing: -2.4, lineHeight: 1, color: T.ink }}>
        Stop juggling tabs.<br /><span style={{ color: T.inkMute }}>Start orchestrating.</span>
      </h2>
      <p style={{ margin: '28px auto 0', maxWidth: 520, fontSize: fz(16), lineHeight: 1.55, color: T.inkDim }}>
        Vmax is in private beta. macOS only. Local-first. Bring your own API keys.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 36, justifyContent: 'center' }}>
        <span className="vmax-rainbow-ring">
          <Btn variant="primary" size="lg" {...macDownloadBtnProps(MAC_DOWNLOAD_URL)}>Download for macOS</Btn>
        </span>
        <Btn variant="secondary" size="lg">Join the waitlist</Btn>
      </div>
    </div>
  </section>
  );
};

const Footer = () => {
  const { ref, revealStyle } = useReveal(0);
  return (
  <footer ref={ref} style={{ borderTop: '1px solid ' + T.hair, padding: '48px 0 36px', ...revealStyle }}>
    <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', padding: '0 32px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 40 }}>
      <div>
        <Logo />
        <p style={{ margin: '16px 0 0', fontSize: fz(12.5), color: T.inkMute, lineHeight: 1.55, maxWidth: 280 }}>
          The operating system for coding agents. Built in San Francisco.
        </p>
      </div>
      {[
        { h: 'Product', items: ['Download', 'Workspace', 'Voice', 'Routing'] },
        { h: 'Developers', items: ['Docs', 'CLI', 'Changelog', 'Status'] },
        { h: 'Company', items: ['About', 'Careers', 'Contact', 'Press'] },
        { h: 'Legal', items: ['Privacy', 'Terms', 'Security', 'DPA'] },
      ].map(col => (
        <div key={col.h}>
          <Mono style={{ color: T.inkMute, textTransform: 'uppercase', display: 'block', marginBottom: 14 }}>{col.h}</Mono>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {col.items.map(i => {
              const href = i === 'Download' && MAC_DOWNLOAD_URL ? MAC_DOWNLOAD_URL : '#';
              const remote = /^https?:\/\//i.test(href);
              return (
              <a
                key={i}
                href={href}
                {...(remote ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={{ color: T.inkDim, textDecoration: 'none', fontSize: fz(13), fontFamily: T.sans }}
              >{i}</a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
    <div style={{ maxWidth: CONTENT_MAX, margin: '40px auto 0', padding: '20px 32px 0', borderTop: '1px solid ' + T.hair, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
      <Mono style={{ color: T.inkFaint }}>© 2026 Vmax Labs, Inc. · v0.7.2 · build a4f9c1</Mono>
      <div style={{ display: 'flex', gap: 18 }}>
        {['github', 'x', 'discord'].map(s => (
          <a key={s} href="#" style={{ color: T.inkMute, textDecoration: 'none', fontFamily: T.mono, fontSize: fz(11.5) }}>{s}</a>
        ))}
      </div>
    </div>
  </footer>
  );
};

// ---------------- App ----------------
function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "mono",
    "density": "standard"
  }/*EDITMODE-END*/;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // accent override
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-mode', t.accent);
  }, [t.accent]);

  // Standalone: open floating tweaks with ?tweaks=1 (edit host used __activate_edit_mode)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tweaks') === '1') {
      window.postMessage({ type: '__activate_edit_mode' }, '*')
    }
  }, []);

  return (
    <div style={{ background: T.bg, color: T.ink, fontFamily: T.sans, minHeight: '100vh' }}>
      <Nav />
      <Hero />
      <ProductStory />
      <Features />
      <Workflow />
      <Pricing />
      <CTA />
      <Footer />
      <TweaksPanel title="Tweaks">
          <TweakSection title="Accent">
            <TweakRadio
              label="Trend deltas"
              value={t.accent}
              onChange={v => setTweak('accent', v)}
              options={[{ label: 'Mono', value: 'mono' }, { label: 'Green', value: 'green' }, { label: 'Amber', value: 'amber' }]}
            />
          </TweakSection>
          <TweakSection title="Density">
            <TweakRadio
              label="Spacing"
              value={t.density}
              onChange={v => setTweak('density', v)}
              options={[{ label: 'Tight', value: 'tight' }, { label: 'Standard', value: 'standard' }, { label: 'Airy', value: 'airy' }]}
            />
          </TweakSection>
      </TweaksPanel>
    </div>
  );
}

export default App
