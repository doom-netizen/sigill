// Profile theme: JSON in, CSS variables out. No free-form CSS.
// Every value is validated against a fixed schema; anything else is dropped.
// Themes can never render badges — badges come only from the server field.

export type BgType = 'solid' | 'gradient' | 'image';
export type CardStyle = 'glass' | 'solid' | 'outline';
export type FontChoice = 'mono' | 'sans' | 'serif' | 'display';
export type AvatarShape = 'circle' | 'rounded' | 'square' | 'hex';
export type NameStyle = 'solid' | 'gradient' | 'outline' | 'shimmer';

export interface Theme {
  accent: string;           // #rrggbb
  background: {
    type: BgType;
    color: string;          // solid
    from: string;           // gradient
    to: string;
    angle: number;          // 0–360
    // image backgrounds use the uploaded "background" media slot
  };
  cardStyle: CardStyle;
  radius: number;           // 0–28 px
  font: FontChoice;
  noise: boolean;
  accent2: string;          // second color for gradients
  avatarShape: AvatarShape;
  nameStyle: NameStyle;
  glow: boolean;            // soft accent glow around the card
}

export const DEFAULT_THEME: Theme = {
  accent: '#8b7cff',
  background: { type: 'gradient', color: '#0b0b10', from: '#16122b', to: '#07070a', angle: 160 },
  cardStyle: 'glass',
  radius: 18,
  font: 'mono',
  noise: true,
  accent2: '#ff8ad8',
  avatarShape: 'circle',
  nameStyle: 'solid',
  glow: false,
};

export const THEME_PRESETS: { name: string; theme: Theme }[] = [
  { name: 'Violet', theme: DEFAULT_THEME },
  { name: 'Acid', theme: { ...DEFAULT_THEME, accent: '#c6ff3d', background: { type: 'gradient', color: '#090b06', from: '#151d07', to: '#060706', angle: 200 } } },
  { name: 'Ember', theme: { ...DEFAULT_THEME, accent: '#ff6a3d', background: { type: 'gradient', color: '#0d0806', from: '#2a0f07', to: '#080505', angle: 140 }, cardStyle: 'solid' } },
  { name: 'Ice', theme: { ...DEFAULT_THEME, accent: '#5ee7ff', background: { type: 'gradient', color: '#05090c', from: '#06202b', to: '#05070a', angle: 180 }, font: 'sans' } },
  { name: 'Mono', theme: { ...DEFAULT_THEME, accent: '#f2f2f2', background: { type: 'solid', color: '#0a0a0a', from: '#0a0a0a', to: '#0a0a0a', angle: 0 }, cardStyle: 'outline', radius: 4, noise: false } },
  { name: 'Pitch Black', theme: { ...DEFAULT_THEME, accent: '#ffffff', accent2: '#8b8b8b', background: { type: 'solid', color: '#000000', from: '#000000', to: '#000000', angle: 0 }, cardStyle: 'solid', noise: false, nameStyle: 'solid', radius: 14 } },
  { name: 'Rose', theme: { ...DEFAULT_THEME, accent: '#ff5fa2', background: { type: 'gradient', color: '#0c0609', from: '#2a0a1c', to: '#09060a', angle: 220 }, font: 'serif' } },
];

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d;
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T =>
  (opts as readonly unknown[]).includes(v) ? (v as T) : d;

/** Sanitize arbitrary JSON into a valid Theme. Unknown keys are dropped. */
export function sanitizeTheme(input: unknown): Theme {
  const t = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const bg = (t.background && typeof t.background === 'object' ? t.background : {}) as Record<string, any>;
  const d = DEFAULT_THEME;
  return {
    accent: hex(t.accent, d.accent),
    background: {
      type: pick(bg.type, ['solid', 'gradient', 'image'] as const, d.background.type),
      color: hex(bg.color, d.background.color),
      from: hex(bg.from, d.background.from),
      to: hex(bg.to, d.background.to),
      angle: num(bg.angle, 0, 360, d.background.angle),
    },
    cardStyle: pick(t.cardStyle, ['glass', 'solid', 'outline'] as const, d.cardStyle),
    radius: num(t.radius, 0, 28, d.radius),
    font: pick(t.font, ['mono', 'sans', 'serif', 'display'] as const, d.font),
    noise: typeof t.noise === 'boolean' ? t.noise : d.noise,
    accent2: hex(t.accent2, d.accent2),
    avatarShape: pick(t.avatarShape, ['circle', 'rounded', 'square', 'hex'] as const, d.avatarShape),
    nameStyle: pick(t.nameStyle, ['solid', 'gradient', 'outline', 'shimmer'] as const, d.nameStyle),
    glow: typeof t.glow === 'boolean' ? t.glow : d.glow,
  };
}

export const FONT_STACKS: Record<FontChoice, string> = {
  mono: '"JetBrains Mono","SF Mono","Cascadia Code",ui-monospace,Menlo,Consolas,monospace',
  sans: '"Inter","SF Pro Display","Segoe UI",system-ui,-apple-system,sans-serif',
  serif: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
  display: '"Space Grotesk","Avenir Next","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif',
};

/** Theme -> CSS custom properties. Values are already validated. */
export function themeToCssVars(theme: Theme, backgroundImageUrl?: string | null): Record<string, string> {
  const t = sanitizeTheme(theme);
  const bg = t.background;
  let background: string;
  if (bg.type === 'image' && backgroundImageUrl && /^(https?:|\/media\/|data:image\/)/.test(backgroundImageUrl)) {
    background = `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.65)), url("${backgroundImageUrl.replace(/["\\)]/g, '')}") center/cover`;
  } else if (bg.type === 'solid') {
    background = bg.color;
  } else {
    background = `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
  }
  const black = bg.type === 'solid' && bg.color === '#000000';
  const card = {
    glass: { bg: 'rgba(18,18,24,.55)', border: 'rgba(255,255,255,.08)', blur: '18px' },
    solid: { bg: black ? '#000000' : '#121217', border: black ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.06)', blur: '0px' },
    outline: { bg: 'transparent', border: 'rgba(255,255,255,.22)', blur: '0px' },
  }[t.cardStyle];
  return {
    '--p-accent': t.accent,
    '--p-accent-soft': `${t.accent}33`,
    '--p-bg': background,
    '--p-card-bg': card.bg,
    '--p-card-border': card.border,
    '--p-card-blur': card.blur,
    '--p-radius': `${t.radius}px`,
    '--p-font': FONT_STACKS[t.font],
    '--p-noise': t.noise ? '1' : '0',
    '--p-accent2': t.accent2,
    '--p-glow': t.glow ? `0 0 0 1px ${t.accent}55, 0 0 60px -10px ${t.accent}88` : '0 0 0 transparent',
    '--p-card-bg-solid': black ? '#000000' : '#111116',
  };
}

export function cssVarsToString(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}
