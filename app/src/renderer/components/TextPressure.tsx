// Variable-font "pressure" text: each letter swells in weight and width
// (and leans, if the font supports it) as the pointer gets close.
// Written for Sigil; same idea as the classic CodePen effect.
//
// Works with any variable font that has wght / wdth axes. Compressa VF
// (preusstype.com) is the original look; Roboto Flex (Google Fonts) is a
// free stand-in with the same axes.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  text?: string;
  fontFamily?: string;
  /** optional URL to a variable font file; injected as @font-face */
  fontUrl?: string;
  width?: boolean;
  weight?: boolean;
  italic?: boolean;
  alpha?: boolean;
  flex?: boolean;
  stroke?: boolean;
  scale?: boolean;
  textColor?: string;
  strokeColor?: string;
  minFontSize?: number;
  /** axis ranges for the chosen font */
  axes?: { wght: [number, number]; wdth: [number, number]; slnt: [number, number] };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);

export default function TextPressure({
  text = 'sigil', fontFamily = 'Roboto Flex', fontUrl, width = true, weight = true, italic = true, alpha = false,
  flex = true, stroke = false, scale = false, textColor = '#ffffff', strokeColor = '#5227FF', minFontSize = 24,
  axes = { wght: [100, 1000], wdth: [25, 151], slnt: [-10, 0] },
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const mouse = useRef({ x: 0, y: 0 });
  const cursor = useRef({ x: 0, y: 0 });
  const [fontSize, setFontSize] = useState(minFontSize);
  const [scaleY, setScaleY] = useState(1);
  const [lineHeight, setLineHeight] = useState(1);
  const chars = text.split('');

  useEffect(() => {
    const move = (x: number, y: number) => { cursor.current = { x, y }; };
    const onMouse = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); };
    window.addEventListener('mousemove', onMouse);
    window.addEventListener('touchmove', onTouch, { passive: true });
    if (box.current) {
      const r = box.current.getBoundingClientRect();
      mouse.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      cursor.current = { ...mouse.current };
    }
    return () => { window.removeEventListener('mousemove', onMouse); window.removeEventListener('touchmove', onTouch); };
  }, []);

  const size = useCallback(() => {
    if (!box.current || !title.current) return;
    const { width: w, height: h } = box.current.getBoundingClientRect();
    const fs = Math.max(w / (chars.length / 2), minFontSize);
    setFontSize(fs);
    setScaleY(1);
    setLineHeight(1);
    requestAnimationFrame(() => {
      if (!title.current) return;
      const th = title.current.getBoundingClientRect().height;
      if (scale && th > 0) { const y = h / th; setScaleY(y); setLineHeight(y); }
    });
  }, [chars.length, minFontSize, scale]);

  useEffect(() => {
    size();
    const ro = new ResizeObserver(size);
    if (box.current) ro.observe(box.current);
    document.fonts?.ready.then(size).catch(() => {});
    return () => ro.disconnect();
  }, [size]);

  useEffect(() => {
    let raf = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';
    const tick = () => {
      // ease the effect toward the pointer
      const k = reduced ? 1 : 1 / 15;
      mouse.current.x += (cursor.current.x - mouse.current.x) * k;
      mouse.current.y += (cursor.current.y - mouse.current.y) * k;
      if (title.current) {
        const maxDist = title.current.getBoundingClientRect().width / 2 || 1;
        for (const s of spans.current) {
          if (!s) continue;
          const r = s.getBoundingClientRect();
          const d = dist(mouse.current, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
          const amt = (min: number, max: number) => Math.min(max, Math.max(min, max - Math.abs((max * d) / maxDist) + min));
          const wd = width ? Math.floor(amt(axes.wdth[0], axes.wdth[1])) : 100;
          const wg = weight ? Math.floor(amt(axes.wght[0], axes.wght[1])) : 400;
          const sl = italic ? -(amt(0, -axes.slnt[0]) - 0) : 0;
          const settings = `'wght' ${wg}, 'wdth' ${wd}, 'slnt' ${sl.toFixed(2)}`;
          if (s.style.fontVariationSettings !== settings) s.style.fontVariationSettings = settings;
          if (alpha) s.style.opacity = amt(0, 1).toFixed(2);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [width, weight, italic, alpha, axes]);

  return (
    <div ref={box} className="text-pressure" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'transparent' }}>
      {fontUrl && <style>{`@font-face{font-family:'${fontFamily}';src:url('${fontUrl}');font-style:normal;font-display:swap}`}</style>}
      <h1 ref={title} className={`tp-title ${flex ? 'flex' : ''} ${stroke ? 'stroke' : ''}`} aria-label={text}
        style={{
          fontFamily: `'${fontFamily}', "Segoe UI Variable Display", system-ui, sans-serif`, textTransform: 'uppercase', fontSize, lineHeight,
          transform: `scale(1, ${scaleY})`, transformOrigin: 'center top', margin: 0, textAlign: 'center', userSelect: 'none', whiteSpace: 'nowrap',
          fontWeight: 100, width: '100%', color: stroke ? undefined : textColor, ['--tp-stroke' as any]: strokeColor,
        }}>
        {chars.map((c, i) => <span key={i} aria-hidden="true" ref={(el) => { spans.current[i] = el; }} data-char={c} style={{ display: 'inline-block', color: stroke ? undefined : textColor }}>{c}</span>)}
      </h1>
    </div>
  );
}
