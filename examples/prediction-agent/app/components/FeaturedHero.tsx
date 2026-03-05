"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import TamagotchiBadge from "./dashboard/TamagotchiBadge";
import LiveChatFeed from "./LiveChatFeed";
import LiveNewsFeed from "./LiveNewsFeed";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";

/* ═══════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════ */
interface FeaturedHeroProps {
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

const CAT_META: Record<string, { icon: string; label: string; color: string; sub?: string }> = {
  sports:   { icon: "\u{1F3C8}", label: "Sports", color: "#10b981" },
  crypto:   { icon: "\u20BF",    label: "Crypto", color: "#f59e0b", sub: "Markets" },
  politics: { icon: "\u{1F3DB}\uFE0F", label: "Politics", color: "#6366f1", sub: "Geopolitics" },
  tech:     { icon: "\u{1F4BB}", label: "Tech",   color: "#8b5cf6", sub: "AI \u00B7 Innovation" },
  other:    { icon: "\u{1F30D}", label: "World",  color: "#ec4899", sub: "Global Events" },
};

/* ═══════════════════════════════════════════════════════════
   LIVE HOOKS
   ═══════════════════════════════════════════════════════════ */
function useLiveCountdown(resolutionTime: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, resolutionTime - now / 1000);
  if (s <= 0) return "0:00";
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24,
        m = Math.floor(s / 60) % 60, sec = Math.floor(s) % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Rolling 5-minute cycle for crypto markets — countdown, price-to-beat snapshot, time window */
function useCryptoCycle(currentPrice: number) {
  const CYCLE_MS = 5 * 60 * 1000;
  const [now, setNow] = useState(Date.now());
  const [priceToBeat, setPriceToBeat] = useState(currentPrice);
  const lastCycleRef = useRef(Math.floor(Date.now() / CYCLE_MS));
  const priceRef = useRef(currentPrice);
  priceRef.current = currentPrice;

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const cycle = Math.floor(t / CYCLE_MS);
      if (cycle !== lastCycleRef.current) {
        lastCycleRef.current = cycle;
        setPriceToBeat(priceRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = CYCLE_MS - (now % CYCLE_MS);
  const totalSecs = Math.floor(remaining / 1000);
  const countdown = `${Math.floor(totalSecs / 60)}:${String(totalSecs % 60).padStart(2, "0")}`;

  const cycleStart = new Date(Math.floor(now / CYCLE_MS) * CYCLE_MS);
  const cycleEnd = new Date(cycleStart.getTime() + CYCLE_MS);
  const ft = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const fd = cycleStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeWindow = `${fd}, ${ft(cycleStart)}\u2013${ft(cycleEnd)} ET`;

  return { countdown, priceToBeat, timeWindow };
}

function useLivePrice(basePrice: number, seed: number) {
  const [price, setPrice] = useState(basePrice);
  const [delta, setDelta] = useState(0);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPrice = useRef(basePrice);
  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick++;
      setPrice(prev => {
        // Target oscillates around base — ±0.15%
        const target = basePrice
          + Math.sin(seed * 3.1 + tick * 0.12) * basePrice * 0.0015
          + Math.cos(seed * 7.7 + tick * 0.07) * basePrice * 0.001;
        // Pull toward target + visible noise
        const pull = (target - prev) * 0.08;
        const micro = (Math.random() - 0.5) * basePrice * 0.0005;
        const next = prev + pull + micro;
        const d = next - prevPrice.current;
        setDelta(d);
        setFlash(d >= 0 ? "up" : "down");
        prevPrice.current = next;
        setTimeout(() => setFlash(null), 400);
        return next;
      });
    }, 700 + Math.random() * 300);
    return () => clearInterval(id);
  }, [basePrice, seed]);
  return { price, delta, flash };
}

function useLiveProb(basePct: number, seed: number) {
  const [pct, setPct] = useState(basePct);
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const move = Math.round((Math.random() - 0.48) * 2);
      setPct(prev => Math.max(1, Math.min(99, prev + move)));
      if (move !== 0) { setTicked(true); setTimeout(() => setTicked(false), 300); }
    }, 2500 + Math.random() * 2000);
    return () => clearInterval(id);
  }, [seed]);
  return { pct, ticked };
}

/* ═══════════════════════════════════════════════════════════
   LIVE TRADE FEED
   ═══════════════════════════════════════════════════════════ */
interface TradeEvent { id: number; amount: number; side: "yes" | "no"; y: number; }

function useLiveTrades() {
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const idRef = useRef(0);
  useEffect(() => {
    // Initial burst of trades
    const initial: TradeEvent[] = [];
    for (let i = 0; i < 4; i++) {
      initial.push({ id: ++idRef.current, amount: Math.floor(Math.random() * 50) + 1, side: Math.random() > 0.35 ? "yes" : "no", y: 15 + i * 18 });
    }
    setTrades(initial);
    const id = setInterval(() => {
      const trade: TradeEvent = { id: ++idRef.current, amount: Math.floor(Math.random() * 90) + 1, side: Math.random() > 0.35 ? "yes" : "no", y: 10 + Math.random() * 65 };
      setTrades(prev => { const next = [...prev, trade]; return next.length > 8 ? next.slice(-8) : next; });
    }, 2000 + Math.random() * 2000);
    return () => clearInterval(id);
  }, []);
  return trades;
}

function TradeFeedOverlay({ trades }: { trades: TradeEvent[] }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {trades.slice(-6).map((t, i) => (
        <div key={t.id} className="absolute left-2 animate-trade-slide-in" style={{ top: `${12 + i * 11}%` }}>
          <span className={`text-[13px] font-mono font-bold tabular-nums ${t.side === "yes" ? "text-emerald-400/70" : "text-red-400/70"}`}>+ ${t.amount}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CHART GENERATORS
   ═══════════════════════════════════════════════════════════ */
function seededRand(seed: number, i: number): number {
  return ((Math.sin(seed * 13.731 + i * 2.317) * 43758.5453) % 1 + 1) % 1;
}

function genChartData(prob: number, seed: number, n: number): number[] {
  const pts: number[] = [];
  let v = prob * 100 * 0.4 + 8;
  const target = prob * 100, bias = (target - v) / n;
  for (let i = 0; i < n; i++) {
    v += bias + Math.sin(seed * 13.7 + i * 0.47) * 5 + Math.cos(seed * 7.1 + i * 0.23) * 3.5 + seededRand(seed, i) * 2 - 1;
    v = Math.max(2, Math.min(98, v)); pts.push(v);
  }
  for (let i = 0; i < 4; i++) { v += (target - v) * 0.4; pts.push(Math.max(2, Math.min(98, v))); }
  return pts;
}

function genPricePath(basePrice: number, seed: number, n: number): number[] {
  const pts: number[] = [];
  // Dynamic crypto price — oscillates up and down around base
  // Multiple overlapping wave frequencies create realistic-looking movement
  let v = basePrice;
  for (let i = 0; i < n; i++) {
    // Random step — creates noise texture
    const step = (seededRand(seed, i) - 0.5) * basePrice * 0.0008;
    // Two overlapping oscillations at different frequencies — creates peaks and valleys
    const wave1 = Math.sin(seed * 2.3 + i * 0.15) * basePrice * 0.0006;
    const wave2 = Math.cos(seed * 5.1 + i * 0.08) * basePrice * 0.0004;
    // Mean-revert to prevent drift, but loose enough to allow swings
    const revert = (basePrice - v) * 0.03;
    v += step + wave1 + wave2 + revert;
    pts.push(v);
  }
  return pts;
}

/* ═══════════════════════════════════════════════════════════
   LIVE SVG CHART — fills container, grows with new points
   ═══════════════════════════════════════════════════════════ */
function LiveChart({ initialPoints, color, yUnit, targetPrice, decimals: decProp }: {
  initialPoints: number[]; color: string; yUnit?: "%" | "$"; targetPrice?: number; decimals?: number;
}) {
  const [points, setPoints] = useState(initialPoints);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

  // Measure container so viewBox matches real pixels — no stretch
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live updates — random walk with gentle mean-reversion
  const baseRef = useRef(initialPoints[Math.floor(initialPoints.length / 2)]);
  const tickRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current++;
      const t = tickRef.current;
      setPoints(prev => {
        const last = prev[prev.length - 1];
        const base = baseRef.current;
        const liveTarget = base + Math.sin(t * 0.2) * base * 0.0004 + Math.cos(t * 0.13) * base * 0.0003;
        const revert = (liveTarget - last) * 0.08;
        const step = (Math.random() - 0.5) * base * 0.0004;
        const newVal = last + revert + step;
        const next = [...prev, yUnit === "$" ? newVal : Math.max(2, Math.min(98, newVal))];
        return next.length > 80 ? next.slice(-80) : next;
      });
    }, 1200);
    return () => clearInterval(id);
  }, [yUnit]);

  const W = dims.w || 600, H = dims.h || 260;
  const pL = 0, pR = 48, pT = 8, pB = 28;
  const cW = W - pL - pR, cH = H - pT - pB;
  const mn = Math.min(...points), mx = Math.max(...points);
  const rawRange = mx - mn || (yUnit === "$" ? mn * 0.001 : 5);
  const pad = rawRange * 0.2;
  const yLo = yUnit === "$" ? mn - pad : Math.max(0, mn - pad);
  const yHi = yUnit === "$" ? mx + pad : Math.min(100, mx + pad);
  const yR = yHi - yLo || 10;

  const decimals = decProp ?? (yR < 0.1 ? 4 : yR < 1 ? 3 : yR < 50 ? 2 : 0);

  const tickCount = 5;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(yLo + (yR / tickCount) * i);

  const toX = (i: number) => pL + (i / (points.length - 1)) * cW;
  const toY = (v: number) => pT + cH - ((v - yLo) / yR) * cH;

  let d = `M ${toX(0).toFixed(1)} ${toY(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const px = toX(i - 1), py = toY(points[i - 1]);
    const cx = toX(i), cy = toY(points[i]);
    const mx2 = (px + cx) / 2;
    d += ` C ${mx2.toFixed(1)} ${py.toFixed(1)}, ${mx2.toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }

  const areaD = `${d} L ${toX(points.length - 1).toFixed(1)} ${(pT + cH).toFixed(1)} L ${pL.toFixed(1)} ${(pT + cH).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const lx = toX(points.length - 1), ly = toY(last);

  const fmtY = (v: number) => yUnit === "$"
    ? `$${v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    : `${v.toFixed(decimals > 0 ? 1 : 0)}%`;

  const now = new Date();
  const timeLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const t = new Date(now.getTime() - (1 - f) * 90000);
    const h = t.getHours() % 12 || 12;
    const m = String(t.getMinutes()).padStart(2, "0");
    const s = String(t.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  });

  const targetInRange = targetPrice !== undefined && targetPrice >= yLo - yR * 0.1 && targetPrice <= yHi + yR * 0.1;

  const handleMouse = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = (e.clientX - rect.left);
    if (svgX < pL || svgX > W - pR) { setHover(null); return; }
    const frac = (svgX - pL) / cW;
    const idx = Math.round(frac * (points.length - 1));
    const clampedIdx = Math.max(0, Math.min(points.length - 1, idx));
    setHover({ x: toX(clampedIdx), idx: clampedIdx });
  }, [points.length, cW, W, pL, pR]);

  const hoverVal = hover ? points[hover.idx] : null;

  // Don't render SVG until measured
  if (dims.w === 0) return <div ref={wrapRef} className="w-full h-full" />;

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="cursor-crosshair block"
        onMouseMove={handleMouse}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`lg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.10" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {/* Gridlines + Y labels */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.035)" strokeDasharray="2,5" />
            <text x={W - pR + 6} y={toY(v) + 4} fontSize="11" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.35)">
              {fmtY(v)}
            </text>
          </g>
        ))}
        {/* Target line */}
        {targetInRange && (() => {
          const tgtY = Math.max(pT, Math.min(pT + cH, toY(targetPrice!)));
          return (
            <g>
              <line x1={0} y1={tgtY} x2={W - pR} y2={tgtY} stroke="rgba(255,255,255,0.12)" strokeDasharray="5,4" strokeWidth="1" />
              <rect x={W - pR - 32} y={tgtY - 10} width="32" height="20" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
              <text x={W - pR - 16} y={tgtY + 3.5} textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600" fill="rgba(255,255,255,0.35)">{"\u21C5"}</text>
            </g>
          );
        })()}
        {/* Time axis */}
        {timeLabels.map((t, i) => (
          <text key={i} x={pL + (i / 4) * cW} y={H - 6} fontSize="11" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.3)" textAnchor="middle">{t}</text>
        ))}
        {/* Area + line */}
        <path d={areaD} fill={`url(#lg-${color.replace('#','')})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dynamic endpoint — pulse rings */}
        <circle cx={lx} cy={ly} r="6" fill={color} opacity="0.04">
          <animate attributeName="r" values="6;16;6" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.06;0.01;0.06" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx={lx} cy={ly} r="4" fill={color} opacity="0.08">
          <animate attributeName="r" values="4;10;4" dur="1.8s" repeatCount="indefinite" />
        </circle>
        <circle cx={lx} cy={ly} r="4" fill={color} />
        <circle cx={lx} cy={ly} r="1.5" fill="white" />
        {/* Current value badge */}
        <rect x={lx - 32} y={ly - 22} width="64" height="18" rx="4" fill="rgba(0,0,0,0.75)" stroke={color} strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={lx} y={ly - 10} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fontWeight="700" fill={color}>
          {fmtY(last)}
        </text>
        {/* Hover crosshair + tooltip */}
        {hover && hoverVal !== null && (() => {
          const hoverTime = new Date(now.getTime() - ((points.length - 1 - hover.idx) / (points.length - 1)) * 90000);
          const hh = hoverTime.getHours() % 12 || 12;
          const mm = String(hoverTime.getMinutes()).padStart(2, "0");
          const ss = String(hoverTime.getSeconds()).padStart(2, "0");
          const ampm = hoverTime.getHours() >= 12 ? "PM" : "AM";
          const hoverTimeStr = `${hh}:${mm}:${ss} ${ampm}`;
          // Clamp tooltip so it doesn't overflow SVG edges
          const tipW = 88, tipH = 28;
          const tipX = Math.max(tipW / 2, Math.min(W - tipW / 2, hover.x));
          const tipY = toY(hoverVal) - 32;
          return (
            <g>
              <line x1={hover.x} y1={pT} x2={hover.x} y2={pT + cH} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={hover.x} cy={toY(hoverVal)} r="4" fill={color} stroke="white" strokeWidth="1.5" />
              <rect x={tipX - tipW / 2} y={tipY} width={tipW} height={tipH} rx="5" fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
              <text x={tipX} y={tipY + 12} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fontWeight="700" fill="white">
                {fmtY(hoverVal)}
              </text>
              <text x={tipX} y={tipY + 22} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.45)">
                {hoverTimeStr}
              </text>
              <line x1={pL} y1={toY(hoverVal)} x2={W - pR} y2={toY(hoverVal)} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="2,3" />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

function DualLiveChart({ pts1, pts2, c1, c2, l1, l2 }: { pts1: number[]; pts2: number[]; c1: string; c2: string; l1: string; l2: string }) {
  const [p1, setP1] = useState(pts1);
  const [p2, setP2] = useState(pts2);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      setP1(prev => { const last = prev[prev.length - 1]; const next = [...prev, Math.max(2, Math.min(98, last + (Math.random() - 0.48) * 1.5))]; return next.length > 70 ? next.slice(-70) : next; });
      setP2(prev => { const last = prev[prev.length - 1]; const next = [...prev, Math.max(2, Math.min(98, last + (Math.random() - 0.52) * 1.5))]; return next.length > 70 ? next.slice(-70) : next; });
    }, 1200);
    return () => clearInterval(id);
  }, []);

  const W = 600, H = 260, pL = 0, pR = 68, pT = 8, pB = 28;
  const cW = W - pL - pR, cH = H - pT - pB;
  const all = [...p1, ...p2];
  const mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.12;
  const yLo = Math.max(0, mn - pad), yHi = Math.min(100, mx + pad);
  const yR = yHi - yLo || 10;
  const tickCount = 5;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(yLo + (yR / tickCount) * i);
  const n = Math.max(p1.length, p2.length);
  const toX = (i: number) => pL + (i / (n - 1)) * cW;
  const toY = (v: number) => pT + cH - ((v - yLo) / yR) * cH;
  const mkBezier = (pts: number[]) => {
    let d = `M ${toX(0).toFixed(1)} ${toY(pts[0]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const py = toY(pts[i - 1]), cy = toY(pts[i]);
      const px = toX(i - 1), cx = toX(i), mx2 = (px + cx) / 2;
      d += ` C ${mx2.toFixed(1)} ${py.toFixed(1)}, ${mx2.toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
    return d;
  };
  const last1 = p1[p1.length - 1], last2 = p2[p2.length - 1];

  const handleMouse = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    if (svgX < pL || svgX > W - pR) { setHover(null); return; }
    const idx = Math.round(((svgX - pL) / cW) * (n - 1));
    setHover({ x: toX(Math.max(0, Math.min(n - 1, idx))), idx: Math.max(0, Math.min(n - 1, idx)) });
  }, [n, cW, W, pL, pR]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-crosshair" preserveAspectRatio="none"
      onMouseMove={handleMouse} onMouseLeave={() => setHover(null)}>
      {ticks.map((v, i) => (<g key={i}><line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.035)" strokeDasharray="2,5" /><text x={W - pR + 8} y={toY(v) + 4} fontSize="12" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.35)">{Math.round(v)}%</text></g>))}
      <path d={mkBezier(p1)} fill="none" stroke={c1} strokeWidth="2" strokeLinecap="round" />
      <path d={mkBezier(p2)} fill="none" stroke={c2} strokeWidth="2" strokeLinecap="round" />
      <circle cx={toX(p1.length - 1)} cy={toY(last1)} r="6" fill={c1} opacity="0.06"><animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" /></circle>
      <circle cx={toX(p1.length - 1)} cy={toY(last1)} r="3.5" fill={c1} />
      <circle cx={toX(p2.length - 1)} cy={toY(last2)} r="6" fill={c2} opacity="0.06"><animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" /></circle>
      <circle cx={toX(p2.length - 1)} cy={toY(last2)} r="3.5" fill={c2} />
      {/* Endpoint labels */}
      <text x={toX(p1.length - 1) + 8} y={toY(last1) - 1} fontSize="10" fontFamily="var(--font-heading)" fontWeight="700" fill={c1}>{l1}</text>
      <text x={toX(p1.length - 1) + 8} y={toY(last1) + 11} fontSize="12" fontFamily="var(--font-heading)" fontWeight="800" fill={c1}>{Math.round(last1)}%</text>
      <text x={toX(p2.length - 1) + 8} y={toY(last2) - 1} fontSize="10" fontFamily="var(--font-heading)" fontWeight="700" fill={c2}>{l2}</text>
      <text x={toX(p2.length - 1) + 8} y={toY(last2) + 11} fontSize="12" fontFamily="var(--font-heading)" fontWeight="800" fill={c2}>{Math.round(last2)}%</text>
      {/* Hover crosshair */}
      {hover && (() => {
        const v1 = p1[Math.min(hover.idx, p1.length - 1)];
        const v2 = p2[Math.min(hover.idx, p2.length - 1)];
        return (
          <g>
            <line x1={hover.x} y1={pT} x2={hover.x} y2={pT + cH} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={hover.x} cy={toY(v1)} r="4" fill={c1} stroke="white" strokeWidth="1.5" />
            <circle cx={hover.x} cy={toY(v2)} r="4" fill={c2} stroke="white" strokeWidth="1.5" />
            <rect x={hover.x - 28} y={toY(v1) - 20} width="56" height="16" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            <text x={hover.x} y={toY(v1) - 9} textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fontWeight="600" fill={c1}>{Math.round(v1)}%</text>
            <rect x={hover.x - 28} y={toY(v2) - 20} width="56" height="16" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
            <text x={hover.x} y={toY(v2) - 9} textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fontWeight="600" fill={c2}>{Math.round(v2)}%</text>
          </g>
        );
      })()}
    </svg>
  );
}

function MultiLineLiveChart({ lines }: { lines: { initialPoints: number[]; color: string; label: string }[] }) {
  const [allLines, setAllLines] = useState(lines.map(l => ({ ...l, points: [...l.initialPoints] })));
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      setAllLines(prev => prev.map(line => { const last = line.points[line.points.length - 1]; const next = [...line.points, Math.max(2, Math.min(98, last + (Math.random() - 0.5) * 1.8))]; return { ...line, points: next.length > 70 ? next.slice(-70) : next }; }));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const W = 600, H = 260, pL = 0, pR = 68, pT = 8, pB = 28;
  const cW = W - pL - pR, cH = H - pT - pB;
  const all = allLines.flatMap(l => l.points);
  const mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.12;
  const yLo = Math.max(0, mn - pad), yHi = Math.min(100, mx + pad);
  const yR = yHi - yLo || 10;
  const tickCount = 5;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(yLo + (yR / tickCount) * i);
  const n = Math.max(...allLines.map(l => l.points.length));
  const toX = (i: number) => pL + (i / (n - 1)) * cW;
  const toY = (v: number) => pT + cH - ((v - yLo) / yR) * cH;
  const mkBezier = (pts: number[]) => {
    let d = `M ${toX(0).toFixed(1)} ${toY(pts[0]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const py = toY(pts[i - 1]), cy = toY(pts[i]);
      const px = toX(i - 1), cx = toX(i), mx2 = (px + cx) / 2;
      d += ` C ${mx2.toFixed(1)} ${py.toFixed(1)}, ${mx2.toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
    return d;
  };

  const handleMouse = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    if (svgX < pL || svgX > W - pR) { setHover(null); return; }
    const idx = Math.round(((svgX - pL) / cW) * (n - 1));
    setHover({ x: toX(Math.max(0, Math.min(n - 1, idx))), idx: Math.max(0, Math.min(n - 1, idx)) });
  }, [n, cW, W, pL, pR]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-crosshair" preserveAspectRatio="none"
      onMouseMove={handleMouse} onMouseLeave={() => setHover(null)}>
      {ticks.map((v, i) => (<g key={i}><line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.035)" strokeDasharray="2,5" /><text x={W - pR + 8} y={toY(v) + 4} fontSize="12" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.35)">{Math.round(v)}%</text></g>))}
      {allLines.map((line, li) => {
        const last = line.points[line.points.length - 1];
        return (<g key={li}><path d={mkBezier(line.points)} fill="none" stroke={line.color} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          <circle cx={toX(line.points.length - 1)} cy={toY(last)} r="6" fill={line.color} opacity="0.06"><animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" /></circle>
          <circle cx={toX(line.points.length - 1)} cy={toY(last)} r="3.5" fill={line.color} /></g>);
      })}
      {/* Hover crosshair */}
      {hover && (
        <g>
          <line x1={hover.x} y1={pT} x2={hover.x} y2={pT + cH} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
          {allLines.map((line, li) => {
            const v = line.points[Math.min(hover.idx, line.points.length - 1)];
            return (
              <g key={li}>
                <circle cx={hover.x} cy={toY(v)} r="3.5" fill={line.color} stroke="white" strokeWidth="1.5" />
                <rect x={hover.x + 6} y={toY(v) - 8} width="42" height="16" rx="4" fill="rgba(0,0,0,0.75)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                <text x={hover.x + 27} y={toY(v) + 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fontWeight="600" fill={line.color}>{Math.round(v)}%</text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function detectSportSub(question: string): string {
  const q = question.toLowerCase();
  if (/nba|lakers|celtics|warriors|bucks|nuggets|76ers|knicks/.test(q)) return "Basketball \u00B7 NBA";
  if (/nfl|super bowl|seahawks|patriots|chiefs|eagles|sb lx/.test(q)) return "Football \u00B7 NFL";
  if (/mlb|yankees|dodgers|world series/.test(q)) return "Baseball \u00B7 MLB";
  if (/ufc|boxing/.test(q)) return "Combat Sports";
  if (/premier league|la liga|champions league|world cup/.test(q)) return "Football \u00B7 Soccer";
  if (/formula 1|f1/.test(q)) return "Motorsport \u00B7 F1";
  if (/ncaa|ncaaf|march madness/.test(q)) return "College Sports";
  return "Live Sports";
}

function fmtVol(poolWei: bigint): string {
  const w = poolWei / 10n ** 18n; const n = Number(w);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n > 0) return `${n} STRK`;
  return "\u2014";
}

/* ═══════════════════════════════════════════════════════════
   CATEGORY HERO LAYOUTS — Polymarket-style
   Stats across top, buttons+chat left, chart fills right
   ═══════════════════════════════════════════════════════════ */

function CryptoHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  const q = market.question.toLowerCase();
  let basePrice = 65000, ticker = "BTC";
  if (q.includes("eth")) { basePrice = 4800; ticker = "ETH"; }
  else if (q.includes("strk")) { basePrice = 1.8; ticker = "STRK"; }
  else if (q.includes("btc") && q.includes("90k")) { basePrice = 88000; }
  else if (q.includes("btc")) { basePrice = 65000; }

  const startPrice = basePrice * (0.97 + seededRand(market.id, 5) * 0.06);
  const { price: currentPrice, delta: priceDelta, flash } = useLivePrice(startPrice, market.id);
  const { pct: yesPct, ticked } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const { countdown, priceToBeat, timeWindow } = useCryptoCycle(currentPrice);
  const trades = useLiveTrades();
  const pricePts = useMemo(() => genPricePath(startPrice, market.id, 60), [startPrice, market.id]);

  // Formatting
  const priceDec = basePrice < 10 ? 4 : basePrice < 100 ? 2 : basePrice < 10000 ? 2 : 2;
  const fmtP = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`;

  // UP/DOWN multipliers derived from market odds
  // When pool is empty/unfunded yesPct is 0 or 100 — fall back to ~50/50
  const effectiveYes = yesPct >= 5 && yesPct <= 95 ? yesPct : 50;
  const upMult = Math.min(10, 100 / effectiveYes).toFixed(1);
  const downMult = Math.min(10, 100 / (100 - effectiveYes)).toFixed(1);

  // Delta from price-to-beat
  const beatDelta = currentPrice - priceToBeat;
  const beating = beatDelta >= 0;

  return (
    <>
      {/* ── Date/time window ── */}
      <p className="text-[11px] text-white/25 font-mono mb-2.5">{timeWindow}</p>

      {/* ── Hero: Price to Beat | Current Price | Countdown ── */}
      <div className="flex items-end justify-between mb-3 flex-wrap gap-y-2">
        <div className="flex items-end gap-5 lg:gap-8">
          <div>
            <span className="text-[11px] text-white/35 font-heading font-semibold tracking-wide">Price to Beat</span>
            <p className="text-[28px] lg:text-[34px] font-heading font-extrabold text-white/50 tabular-nums leading-none tracking-tight">{fmtP(priceToBeat)}</p>
          </div>
          <div>
            <span className="text-[11px] font-heading font-semibold tracking-wide" style={{ color: "#f59e0b" }}>
              Current Price
              <span className={`ml-1.5 text-[13px] font-mono font-bold ${beating ? "text-emerald-400" : "text-red-400"}`}>
                {beating ? "\u25B2" : "\u25BC"} {fmtP(Math.abs(beatDelta))}
              </span>
            </span>
            <p className={`text-[28px] lg:text-[34px] font-heading font-extrabold tabular-nums leading-none tracking-tight ${flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : ""} ${beating ? "text-emerald-400" : "text-red-400"}`}
               key={Math.round(currentPrice * 10000)}>
              {fmtP(currentPrice)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-white/35 font-heading font-semibold tracking-wide">Ends in</span>
          <p className="text-[28px] lg:text-[34px] font-heading font-extrabold text-orange-400 tabular-nums leading-none font-mono" key={countdown}>{countdown}</p>
        </div>
      </div>

      {/* ── UP / DOWN buttons — Polymarket style ── */}
      <div className="flex gap-3 mb-3">
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
          className={`flex-1 py-3 rounded-xl text-center font-heading font-extrabold bg-amber-600/[0.18] border border-amber-500/30 hover:bg-amber-600/[0.28] hover:border-amber-500/45 active:scale-[0.97] transition-all ${ticked ? "animate-prob-tick" : ""}`}>
          <span className="text-amber-400 text-[17px]">UP <span className="tabular-nums">{upMult}x</span></span>
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
          className="flex-1 py-3 rounded-xl text-center font-heading font-extrabold bg-white/[0.06] border border-white/[0.10] hover:bg-white/[0.10] hover:border-white/[0.16] active:scale-[0.97] transition-all">
          <span className="text-white/50 text-[17px]">DOWN <span className="tabular-nums">{downMult}x</span></span>
        </button>
      </div>

      {/* ── Agent feed LEFT | Chart RIGHT ── */}
      <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
        <div className="lg:w-[300px] shrink-0 flex flex-col h-full min-h-0 lg:pr-3 lg:border-r lg:border-white/[0.04]">
          <div className="flex-1 min-h-0 overflow-hidden">
            <LiveChatFeed category="crypto" question={market.question} />
          </div>
        </div>
        <div className="flex-1 min-w-0 relative lg:pl-2 mt-2 lg:mt-0 h-full">
          <TradeFeedOverlay trades={trades} />
          <div className="h-full">
            <LiveChart initialPoints={pricePts} color="#f59e0b" yUnit="$" targetPrice={priceToBeat} />
          </div>
        </div>
      </div>
    </>
  );
}

function SportsHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  const { pct: yesPct, ticked } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const q = market.question;
  const teamMatch = q.match(/Will (?:the )?(.+?)\s+(?:win|beat|cover|score)/i);
  const team1 = teamMatch?.[1] || "Yes";
  const isLive = market.resolutionTime - Date.now() / 1000 < 86400 * 3;
  const quarter = isLive ? `Q${Math.floor(seededRand(market.id, 3) * 4) + 1}` : "";

  const [score1, setScore1] = useState(Math.floor(seededRand(market.id, 1) * 28 + 7));
  const [score2, setScore2] = useState(Math.floor(seededRand(market.id, 2) * 28 + 7));
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      if (Math.random() > 0.7) {
        if (Math.random() > 0.5) setScore1(p => p + Math.ceil(Math.random() * 3));
        else setScore2(p => p + Math.ceil(Math.random() * 3));
      }
    }, 8000);
    return () => clearInterval(id);
  }, [isLive]);

  const chartPts = useMemo(() => genChartData(market.impliedProbYes, market.id, 50), [market.id, market.impliedProbYes]);

  // Cycleable spread & total
  const SPREADS = [1.5, 2.5, 3.5, 6.5, 7.5];
  const TOTALS = [41.5, 44.5, 47.5, 50.5, 53.5];
  const seedSpreadIdx = Math.floor(seededRand(market.id, 10) * SPREADS.length);
  const seedTotalIdx = Math.floor(seededRand(market.id, 11) * TOTALS.length);
  const [spreadIdx, setSpreadIdx] = useState(seedSpreadIdx);
  const [totalIdx, setTotalIdx] = useState(seedTotalIdx);
  const spread = SPREADS[spreadIdx % SPREADS.length];
  const total = TOTALS[totalIdx % TOTALS.length];
  const tm1Short = team1.length > 6 ? team1.slice(0, 3).toUpperCase() : team1;

  return (
    <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
      {/* ── Left column: teams, spread/total, scoreboard ── */}
      <div className="lg:w-[42%] shrink-0 flex flex-col h-full min-h-0 overflow-hidden lg:pr-4 lg:border-r lg:border-white/[0.04]">
        {/* Team buttons */}
        <div className="shrink-0 flex gap-2.5 mb-3">
          <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
            className={`flex-1 py-2.5 rounded-lg text-center font-heading font-bold bg-red-500/[0.15] hover:bg-red-500/[0.25] active:scale-[0.97] transition-all ${ticked ? "animate-prob-tick" : ""}`}>
            <span className="text-red-400 text-[14px] block">{team1}</span>
            <span className="text-red-400/60 text-[11px] tabular-nums">{yesPct}%</span>
          </button>
          <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
            className="flex-1 py-2.5 rounded-lg text-center font-heading font-bold bg-blue-500/[0.12] hover:bg-blue-500/[0.2] active:scale-[0.97] transition-all">
            <span className="text-blue-400 text-[14px] block">Opponent</span>
            <span className="text-blue-400/60 text-[11px] tabular-nums">{100 - yesPct}%</span>
          </button>
        </div>

        {/* Spread — cycleable */}
        <div className="shrink-0 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-white/40 font-heading font-semibold uppercase tracking-wide">Spread</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSpreadIdx(i => (i - 1 + SPREADS.length) % SPREADS.length)}
                className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <span className="text-[12px] text-white/50 font-mono font-bold tabular-nums w-7 text-center">{spread}</span>
              <button type="button" onClick={() => setSpreadIdx(i => (i + 1) % SPREADS.length)}
                className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
              className="flex-1 py-1.5 rounded-lg text-center font-heading font-bold bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.97] transition-all">
              <span className="text-white/60 text-[12px] tabular-nums">{tm1Short} -{spread}</span>
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
              className="flex-1 py-1.5 rounded-lg text-center font-heading font-bold bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.97] transition-all">
              <span className="text-white/60 text-[12px] tabular-nums">OPP +{spread}</span>
            </button>
          </div>
        </div>

        {/* Total — cycleable */}
        <div className="shrink-0 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-white/40 font-heading font-semibold uppercase tracking-wide">Total</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setTotalIdx(i => (i - 1 + TOTALS.length) % TOTALS.length)}
                className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <span className="text-[12px] text-white/50 font-mono font-bold tabular-nums w-7 text-center">{total}</span>
              <button type="button" onClick={() => setTotalIdx(i => (i + 1) % TOTALS.length)}
                className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
              className="flex-1 py-1.5 rounded-lg text-center font-heading font-bold bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.97] transition-all">
              <span className="text-white/60 text-[12px] tabular-nums">O {total}</span>
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
              className="flex-1 py-1.5 rounded-lg text-center font-heading font-bold bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.97] transition-all">
              <span className="text-white/60 text-[12px] tabular-nums">U {total}</span>
            </button>
          </div>
        </div>

        {/* Compact scoreboard */}
        <div className="mt-auto shrink-0 pt-2 border-t border-white/[0.04]">
          <div className="flex items-center justify-center gap-3">
            <div className="w-7 h-7 rounded-md bg-red-500/[0.12] flex items-center justify-center text-[10px] font-heading font-extrabold text-red-400">
              {team1.slice(0, 3).toUpperCase()}
            </div>
            <div className="text-center">
              <div className="text-[20px] font-heading font-extrabold text-white tabular-nums tracking-tight leading-none">
                <span key={`h-${score1}`} className="animate-count-up">{score1}</span>
                <span className="text-white/15 mx-1">-</span>
                <span key={`a-${score2}`} className="animate-count-up">{score2}</span>
              </div>
              {isLive && (
                <span className="text-[9px] font-heading font-bold text-red-400 flex items-center justify-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-live-breathe" />
                  LIVE {quarter && `\u2022 ${quarter}`}
                </span>
              )}
            </div>
            <div className="w-7 h-7 rounded-md bg-blue-500/[0.12] flex items-center justify-center text-[10px] font-heading font-extrabold text-blue-400">
              OPP
            </div>
          </div>
        </div>
      </div>

      {/* ── Right column: single probability chart (blue) ── */}
      <div className="flex-1 min-w-0 lg:pl-2 mt-2 lg:mt-0 h-full">
        <LiveChart initialPoints={chartPts} color="#3b82f6" yUnit="%" />
      </div>
    </div>
  );
}

/* ── Politics candidate pools — keyed by market ID ── */
const POLITICS_OPTION_COLORS = ["#3b82f6", "#60a5fa", "#f59e0b", "#f97316"];

const POLITICS_OPTION_POOL: Record<number, string[]> = {
  904: ["James Talarico", "Jasmine Crockett", "Emily Morgul", "Colin Allred"],
  905: ["Republican wins Senate", "Democrat wins Senate", "Independent kingmaker", "No majority"],
};
const POLITICS_OPTION_FALLBACK = ["Candidate A", "Candidate B", "Candidate C", "Candidate D"];

function PoliticsHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  // Generate 4 seeded options from market.id
  const options = useMemo(() => {
    const names = POLITICS_OPTION_POOL[market.id] ?? POLITICS_OPTION_FALLBACK;
    const probs = [
      40 + Math.floor(seededRand(market.id, 1) * 35),
      10 + Math.floor(seededRand(market.id, 2) * 20),
      Math.floor(seededRand(market.id, 3) * 5),
      Math.floor(seededRand(market.id, 4) * 5),
    ].sort((a, b) => b - a);
    return probs.map((prob, i) => ({
      name: names[i] ?? `Candidate ${i + 1}`,
      prob,
      color: POLITICS_OPTION_COLORS[i],
      chartData: genChartData(prob / 100, market.id + i * 13, 60),
    }));
  }, [market.id]);

  const chartLines = useMemo(() =>
    options.map(o => ({ initialPoints: o.chartData, color: o.color, label: o.name })),
    [options],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
      {/* ── Left column: candidate list + news feed ── */}
      <div className="lg:w-[42%] shrink-0 flex flex-col h-full min-h-0 overflow-hidden lg:pr-4">
        {/* Candidate rows — clickable */}
        <div className="shrink-0 flex flex-col">
          {options.map((opt, i) => (
            <button key={i} type="button"
              onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
              className={`flex items-center justify-between py-3 text-left group/opt hover:bg-white/[0.03] -mx-1 px-1 rounded-md transition-colors ${i < options.length - 1 ? "border-b border-white/[0.06]" : ""}`}>
              <span className="text-[14px] text-white/70 font-heading font-medium truncate group-hover/opt:text-white/90 transition-colors">{opt.name}</span>
              <span className="text-[20px] font-heading font-extrabold tabular-nums leading-none shrink-0 ml-4" style={{ color: opt.color }}>
                {opt.prob < 1 ? "<1" : opt.prob}%
              </span>
            </button>
          ))}
        </div>

        {/* News feed below candidates */}
        <div className="flex-1 min-h-0 overflow-hidden mt-2 border-t border-white/[0.04] pt-2">
          <LiveNewsFeed question={market.question} />
        </div>
      </div>

      {/* ── Right column: legend + multi-line chart ── */}
      <div className="flex-1 min-w-0 flex flex-col lg:pl-3 mt-2 lg:mt-0 h-full">
        {/* Legend row */}
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-1">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: opt.color }} />
              <span className="text-[11px] text-white/50 font-heading font-medium">{opt.name}</span>
              <span className="text-[11px] font-heading font-bold tabular-nums" style={{ color: opt.color }}>
                {opt.prob < 1 ? "<1" : opt.prob}%
              </span>
            </div>
          ))}
        </div>
        {/* Chart */}
        <div className="flex-1 min-h-0">
          <MultiLineLiveChart lines={chartLines} />
        </div>
      </div>
    </div>
  );
}

function DefaultHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  const { pct: yesPct, ticked } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const noPct = 100 - yesPct;
  const category = categorizeMarket(market.question);
  const chartPts = useMemo(() => genChartData(market.impliedProbYes, market.id, 60), [market.id, market.impliedProbYes]);
  const chartColor = yesPct >= 50 ? "#10b981" : "#3b82f6";
  const countdown = useLiveCountdown(market.resolutionTime);
  const trades = useLiveTrades();

  return (
    <>
      {/* ── Prob + countdown row ── */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-[28px] font-heading font-extrabold tabular-nums leading-none ${yesPct >= 50 ? "text-emerald-400" : "text-red-400"} ${ticked ? "animate-prob-tick" : ""}`} key={yesPct}>{yesPct}%</span>
          <span className="text-[12px] text-white/25 font-heading font-medium">chance</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] text-white/25 uppercase font-heading font-semibold tracking-widest">Ends</span>
          <p className="text-[16px] font-heading font-extrabold text-orange-400/80 tabular-nums font-mono leading-tight" key={countdown}>{countdown}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
        <div className="lg:w-[260px] shrink-0 flex flex-col h-full min-h-0 lg:pr-3 lg:border-r lg:border-white/[0.04]">
          <div className="shrink-0 flex gap-2 mb-2.5">
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
              className={`flex-1 py-2 rounded-xl text-center font-heading font-bold bg-emerald-500/[0.1] border border-emerald-500/20 hover:bg-emerald-500/[0.18] hover:border-emerald-500/30 active:scale-[0.97] transition-all ${ticked ? "animate-prob-tick" : ""}`}>
              <span className="text-emerald-400 text-[13px]">Yes <span className="tabular-nums">{yesPct}¢</span></span>
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
              className="flex-1 py-2 rounded-xl text-center font-heading font-bold bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] active:scale-[0.97] transition-all">
              <span className="text-white/40 text-[13px]">No <span className="tabular-nums">{noPct}¢</span></span>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <LiveChatFeed category={category} question={market.question} />
          </div>
        </div>
        <div className="flex-1 min-w-0 relative lg:pl-2 mt-2 lg:mt-0 h-full">
          <TradeFeedOverlay trades={trades} />
          <div className="h-full">
            <LiveChart initialPoints={chartPts} color={chartColor} yUnit="%" />
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   WORLD HERO — Polymarket multi-option card
   Left: candidate list (clickable) | Right: legend + multi-line chart
   ═══════════════════════════════════════════════════════════ */

const WORLD_OPTION_COLORS = ["#3b82f6", "#22d3ee", "#f59e0b", "#f97316"];

/** Per-market option pools — keyed by market ID for deterministic candidates */
const WORLD_OPTION_POOL: Record<number, string[]> = {
  902: ["Hassan Khomeini", "Alireza Arafi", "Position abolished", "Gholam-Hossein Mohseni-Eje'i"],
  903: ["Ratified by 2027", "Delayed past 2028", "Partial framework only", "No agreement reached"],
};
const WORLD_OPTION_FALLBACK = ["Option A", "Option B", "Option C", "Option D"];

function WorldHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  // Generate 4 seeded options from market.id
  const options = useMemo(() => {
    const names = WORLD_OPTION_POOL[market.id] ?? WORLD_OPTION_FALLBACK;
    const probs = [
      12 + Math.floor(seededRand(market.id, 1) * 10),
      10 + Math.floor(seededRand(market.id, 2) * 8),
      8 + Math.floor(seededRand(market.id, 3) * 8),
      7 + Math.floor(seededRand(market.id, 4) * 7),
    ].sort((a, b) => b - a);
    return probs.map((prob, i) => ({
      name: names[i] ?? `Option ${i + 1}`,
      prob,
      color: WORLD_OPTION_COLORS[i],
      chartData: genChartData(prob / 100, market.id + i * 17, 60),
    }));
  }, [market.id]);

  const chartLines = useMemo(() =>
    options.map(o => ({ initialPoints: o.chartData, color: o.color, label: o.name })),
    [options],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
      {/* ── Left column: candidate list (each row is a bet target) ── */}
      <div className="lg:w-[38%] shrink-0 flex flex-col h-full min-h-0 overflow-hidden lg:pr-4">
        {/* Option rows — clickable, no Yes/No */}
        <div className="flex flex-col mt-1">
          {options.map((opt, i) => (
            <button key={i} type="button"
              onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
              className={`flex items-center justify-between py-3.5 text-left group/opt hover:bg-white/[0.03] -mx-1 px-1 rounded-md transition-colors ${i < options.length - 1 ? "border-b border-white/[0.06]" : ""}`}>
              <span className="text-[14px] text-white/70 font-heading font-medium truncate group-hover/opt:text-white/90 transition-colors">{opt.name}</span>
              <span className="text-[20px] font-heading font-extrabold tabular-nums leading-none shrink-0 ml-4" style={{ color: opt.color }}>{opt.prob}%</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right column: legend + multi-line chart ── */}
      <div className="flex-1 min-w-0 flex flex-col lg:pl-3 mt-2 lg:mt-0 h-full">
        {/* Legend row */}
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-1">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: opt.color }} />
              <span className="text-[11px] text-white/50 font-heading font-medium">{opt.name}</span>
              <span className="text-[11px] font-heading font-bold tabular-nums" style={{ color: opt.color }}>{opt.prob}%</span>
            </div>
          ))}
        </div>
        {/* Chart */}
        <div className="flex-1 min-h-0">
          <MultiLineLiveChart lines={chartLines} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function FeaturedHero({ markets, predictions, weightedProbs, latestTakes, onBet }: FeaturedHeroProps) {
  const [activeSlide, setActiveSlide] = useState(0);

  const featuredMarkets = useMemo(() => {
    if (markets.length === 0) return [];
    return [...markets]
      .sort((a, b) => Number(safeBigInt(b.totalPool) / 10n ** 18n) - Number(safeBigInt(a.totalPool) / 10n ** 18n))
      .slice(0, Math.min(6, markets.length));
  }, [markets]);

  const breakingNews = useMemo(() => {
    // Use all markets, generate plausible small diffs for display
    return markets
      .map(m => {
        const wp = typeof weightedProbs[m.id] === "number" ? (weightedProbs[m.id] as number) : m.impliedProbYes;
        const aiProb = Math.round(wp * 100) || Math.round(30 + seededRand(m.id, 99) * 50);
        // Small realistic diff: ±1-5%
        const rawDiff = typeof weightedProbs[m.id] === "number"
          ? Math.round((wp - m.impliedProbYes) * 100)
          : Math.round((seededRand(m.id, 77) - 0.5) * 8);
        const diff = Math.max(-5, Math.min(5, rawDiff));
        return { market: m, aiProb, diff };
      })
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 7);
  }, [markets, weightedProbs]);

  // Extract trending keywords from market questions instead of just categories
  const hotTopics = useMemo(() => {
    const TOPIC_KEYWORDS: [RegExp, string][] = [
      [/super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp/i, "Super Bowl"],
      [/bitcoin|btc/i, "Bitcoin"],
      [/ethereum|eth\b/i, "Ethereum"],
      [/trump/i, "Trump"],
      [/starknet|strk/i, "STRK"],
      [/solana|sol\b/i, "Solana"],
      [/ai\b|gpt|openai/i, "AI"],
      [/score|over|under|spread|halftime|rush/i, "NFL Props"],
      [/\$\d|price|above|hit \$/i, "Price Targets"],
      [/election|vote|congress/i, "Elections"],
      [/ceasefire|war|ukraine|russia/i, "Geopolitics"],
      [/crypto|defi|token/i, "Crypto"],
    ];
    const seen = new Set<string>();
    const topics: { label: string; count: number; volume: bigint }[] = [];
    for (const [regex, label] of TOPIC_KEYWORDS) {
      if (seen.has(label)) continue;
      const matching = markets.filter(m => regex.test(m.question));
      if (matching.length === 0) continue;
      seen.add(label);
      const vol = matching.reduce((acc, m) => acc + safeBigInt(m.totalPool), 0n);
      topics.push({ label, count: matching.length, volume: vol });
    }
    return topics.sort((a, b) => b.count - a.count).slice(0, 5);
  }, [markets]);

  useEffect(() => {
    if (featuredMarkets.length <= 1) return;
    const id = setInterval(() => setActiveSlide(prev => (prev + 1) % featuredMarkets.length), 45000);
    return () => clearInterval(id);
  }, [featuredMarkets.length]);

  if (featuredMarkets.length === 0) return null;

  const featured = featuredMarkets[activeSlide] || featuredMarkets[0];
  const category = categorizeMarket(featured.question);
  const catMeta = CAT_META[category] || CAT_META.other;
  const catSub = catMeta.sub ?? (category === "sports" ? detectSportSub(featured.question) : undefined);
  const sportsIcon = category === "sports" && /nba|lakers|celtics|warriors|bucks/i.test(featured.question) ? "\u{1F3C0}" : catMeta.icon;
  const poolVol = fmtVol(safeBigInt(featured.totalPool));
  const isLive = featured.resolutionTime - Date.now() / 1000 < 86400 * 3;

  return (
    <div className="mb-5 animate-card-enter">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3 items-stretch">
        {/* ─── Hero card ─── */}
        <div className={`market-card overflow-hidden relative flex flex-col h-[540px] ${isLive ? "market-card-live" : ""}`}>
          {/* Dot-grid texture overlay */}
          <div className="absolute inset-0 pointer-events-none z-0" style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }} />
          {/* Title bar */}
          <div className="relative z-[1] flex items-center justify-between px-5 lg:px-6 pt-4 pb-0 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {category === "crypto" ? (
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[22px] shrink-0 shadow-lg shadow-amber-500/10"
                     style={{ background: catMeta.color }}>
                  <span className="text-white font-bold drop-shadow-sm">{catMeta.icon}</span>
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: `${catMeta.color}12`, border: `1px solid ${catMeta.color}20` }}>
                  {sportsIcon}
                </div>
              )}
              <div className="min-w-0">
                <h2 className={`font-heading font-bold text-white leading-snug truncate ${category === "crypto" ? "text-[18px] lg:text-[20px]" : "text-[16px] lg:text-[18px]"}`}>{featured.question}</h2>
                <div className="flex items-center gap-1.5 text-[10px] font-heading font-medium mt-0.5">
                  <span style={{ color: catMeta.color }}>{catMeta.label}</span>
                  {catSub && <><span className="text-white/12">&middot;</span><span className="text-white/25">{catSub}</span></>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isLive && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-red-500/[0.1] text-red-400 border border-red-500/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-live-breathe" />LIVE
                </span>
              )}
            </div>
          </div>

          {/* Category-specific content — key forces remount on market switch */}
          <div className="relative z-[1] px-5 lg:px-6 pt-3 pb-0 flex-1 min-h-0 flex flex-col">
            {category === "sports" && <SportsHero key={featured.id} market={featured} onBet={onBet} />}
            {category === "crypto" && <CryptoHero key={featured.id} market={featured} onBet={onBet} />}
            {category === "politics" && <PoliticsHero key={featured.id} market={featured} onBet={onBet} />}
            {category === "other" && <WorldHero key={featured.id} market={featured} onBet={onBet} />}
            {category !== "sports" && category !== "crypto" && category !== "politics" && category !== "other" && <DefaultHero key={featured.id} market={featured} onBet={onBet} />}
          </div>

          {/* Footer */}
          <div className="relative z-[1] flex items-center justify-between px-5 lg:px-6 py-1.5 border-t border-white/[0.04]">
            <span className="text-[12px] font-mono font-semibold text-white/30 tabular-nums">
              {(() => {
                const pool = Number(safeBigInt(featured.totalPool)) / 1e18;
                if (pool >= 1000) return `$${(pool / 1000).toFixed(1)}K Vol`;
                if (pool > 0) return `$${pool.toFixed(0)} Vol`;
                return "$0 Vol";
              })()}
            </span>
            <div className="flex items-center gap-3">
              {isLive && <span className="flex items-center gap-1 text-red-400/60 text-[11px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-live-breathe" />LIVE</span>}
              <span className="flex items-center gap-2 font-heading font-semibold text-white/30 text-[13px]">
                <TamagotchiBadge autonomousMode={true} marketDataSource="onchain" marketDataStale={false} activeAgents={1} nextTickIn={null} size={16} />
                HiveCaster
              </span>
            </div>
          </div>
        </div>

        {/* ─── Right sidebar — Breaking News + Hot Topics ─── */}
        <div className="hidden xl:flex flex-col gap-0 h-[540px]">
          <div className="neo-card overflow-hidden flex flex-col h-full">
            {/* Breaking News */}
            <div className="px-4 pt-4 pb-3">
              <h3 className="font-heading text-[14px] font-bold text-white/80 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-live-breathe" />Breaking news
                <svg className="w-3.5 h-3.5 text-white/20 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </h3>
              {breakingNews.slice(0, 4).map((item, i) => (
                <Link key={item.market.id} href={`/market/${item.market.id}`} className="flex items-center gap-2.5 no-underline group/item py-2 border-b border-white/[0.04] last:border-0">
                  <span className="text-[11px] text-white/18 font-mono tabular-nums w-3 shrink-0 text-right">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-[12px] text-white/50 leading-snug group-hover/item:text-white/80 transition-colors truncate">{item.market.question}</span>
                  <div className="shrink-0 text-right ml-1.5">
                    <span className="text-[16px] font-heading font-extrabold text-white tabular-nums leading-none">{item.aiProb}%</span>
                  </div>
                  {item.diff !== 0 && <span className={`text-[10px] font-mono font-semibold tabular-nums shrink-0 ${item.diff > 0 ? "text-emerald-400" : "text-red-400"}`}>{item.diff > 0 ? "\u2197" : "\u2198"}{Math.abs(item.diff)}%</span>}
                </Link>
              ))}
            </div>

            <div className="border-t border-dashed border-white/[0.05] mx-4" />

            {/* Hot Topics */}
            <div className="px-4 pt-3 pb-3">
              <h3 className="font-heading text-[14px] font-bold text-white/80 mb-3 flex items-center gap-2">
                Hot topics
                <svg className="w-3.5 h-3.5 text-white/20 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </h3>
              {hotTopics.map((t, i) => (
                <div key={t.label} className="flex items-center gap-2 group/topic cursor-pointer py-2 border-b border-white/[0.04] last:border-0">
                  <span className="text-[11px] text-white/18 font-mono tabular-nums w-3 shrink-0 text-right">{i + 1}</span>
                  <TamagotchiBadge autonomousMode={true} marketDataSource="onchain" marketDataStale={false} activeAgents={1} nextTickIn={null} size={14} />
                  <span className="flex-1 text-[13px] text-white/65 font-heading font-semibold group-hover/topic:text-white/85 transition-colors">{t.label}</span>
                  <span className="text-[10px] text-white/25 font-mono tabular-nums whitespace-nowrap">{fmtVol(t.volume)}</span>
                  <svg className="w-3 h-3 text-white/12 shrink-0 group-hover/topic:text-white/35 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </div>
              ))}
            </div>

            {/* Explore all */}
            <div className="mt-auto px-4 pb-4">
              <button type="button" className="w-full py-2.5 rounded-lg text-[12px] font-heading font-semibold text-white/30 border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:text-white/50 transition-all">
                Explore all
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Carousel dots + nav */}
      {featuredMarkets.length > 1 && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1.5">
            {featuredMarkets.map((_, i) => (
              <button key={i} type="button" onClick={() => setActiveSlide(i)}
                className={`transition-all duration-200 rounded-full ${i === activeSlide ? "w-7 h-2 bg-white/50" : "w-2 h-2 bg-white/[0.12] hover:bg-white/20"}`}
                aria-label={`Slide ${i + 1}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {activeSlide > 0 && (
              <button type="button" onClick={() => setActiveSlide(activeSlide - 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px] text-white/40 font-heading font-medium hover:bg-white/[0.06] hover:text-white/60 transition-all">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                {featuredMarkets[activeSlide - 1].question.slice(0, 22)}...
              </button>
            )}
            {activeSlide < featuredMarkets.length - 1 && (
              <button type="button" onClick={() => setActiveSlide(activeSlide + 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px] text-white/40 font-heading font-medium hover:bg-white/[0.06] hover:text-white/60 transition-all">
                {featuredMarkets[activeSlide + 1].question.slice(0, 22)}...
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
