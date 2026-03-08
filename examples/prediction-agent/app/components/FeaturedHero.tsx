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
  sports:      { icon: "\u{1F3C8}", label: "Sports",      color: "#10b981" },
  crypto:      { icon: "\u20BF",    label: "Crypto",      color: "#f59e0b", sub: "Markets" },
  politics:    { icon: "\u{1F3DB}\uFE0F", label: "Politics", color: "#6366f1", sub: "Geopolitics" },
  tech:        { icon: "\u{1F4BB}", label: "Tech",        color: "#8b5cf6", sub: "AI \u00B7 Innovation" },
  elections:   { icon: "\u{1F5F3}\uFE0F", label: "Elections", color: "#818cf8" },
  geopolitics: { icon: "\u{1F30D}", label: "Geopolitics", color: "#f472b6" },
  finance:     { icon: "\u{1F4C8}", label: "Finance",     color: "#22d3ee" },
  earnings:    { icon: "\u{1F4B0}", label: "Earnings",    color: "#a78bfa" },
  economy:     { icon: "\u{1F3E6}", label: "Economy",     color: "#fbbf24" },
  climate:     { icon: "\u{1F33F}", label: "Climate",     color: "#4ade80" },
  culture:     { icon: "\u{1F3AC}", label: "Culture",     color: "#fb923c" },
  world:       { icon: "\u{1F310}", label: "World",       color: "#ec4899" },
  other:       { icon: "\u{1F30D}", label: "World",       color: "#ec4899", sub: "Global Events" },
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
        const target = basePrice
          + Math.sin(seed * 3.1 + tick * 0.12) * basePrice * 0.0015
          + Math.cos(seed * 7.7 + tick * 0.07) * basePrice * 0.001;
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
  let v = basePrice;
  for (let i = 0; i < n; i++) {
    const step = (seededRand(seed, i) - 0.5) * basePrice * 0.0008;
    const wave1 = Math.sin(seed * 2.3 + i * 0.15) * basePrice * 0.0006;
    const wave2 = Math.cos(seed * 5.1 + i * 0.08) * basePrice * 0.0004;
    const revert = (basePrice - v) * 0.03;
    v += step + wave1 + wave2 + revert;
    pts.push(v);
  }
  return pts;
}

/* ═══════════════════════════════════════════════════════════
   LIVE SVG CHART — fills container, production-grade
   ═══════════════════════════════════════════════════════════ */
function LiveChart({ initialPoints, color, yUnit, targetPrice, decimals: decProp }: {
  initialPoints: number[]; color: string; yUnit?: "%" | "$"; targetPrice?: number; decimals?: number;
}) {
  const [points, setPoints] = useState(initialPoints);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

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
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.035)" strokeDasharray="2,5" />
            <text x={W - pR + 6} y={toY(v) + 4} fontSize="11" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.35)">
              {fmtY(v)}
            </text>
          </g>
        ))}
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
        {timeLabels.map((t, i) => (
          <text key={i} x={pL + (i / 4) * cW} y={H - 6} fontSize="11" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.3)" textAnchor="middle">{t}</text>
        ))}
        <path d={areaD} fill={`url(#lg-${color.replace('#','')})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="6" fill={color} opacity="0.04">
          <animate attributeName="r" values="6;16;6" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.06;0.01;0.06" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx={lx} cy={ly} r="4" fill={color} opacity="0.08">
          <animate attributeName="r" values="4;10;4" dur="1.8s" repeatCount="indefinite" />
        </circle>
        <circle cx={lx} cy={ly} r="4" fill={color} />
        <circle cx={lx} cy={ly} r="1.5" fill="white" />
        <rect x={lx - 32} y={ly - 22} width="64" height="18" rx="4" fill="rgba(0,0,0,0.75)" stroke={color} strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={lx} y={ly - 10} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fontWeight="700" fill={color}>
          {fmtY(last)}
        </text>
        {hover && hoverVal !== null && (() => {
          const hoverTime = new Date(now.getTime() - ((points.length - 1 - hover.idx) / (points.length - 1)) * 90000);
          const hh = hoverTime.getHours() % 12 || 12;
          const mm = String(hoverTime.getMinutes()).padStart(2, "0");
          const ss = String(hoverTime.getSeconds()).padStart(2, "0");
          const ampm = hoverTime.getHours() >= 12 ? "PM" : "AM";
          const hoverTimeStr = `${hh}:${mm}:${ss} ${ampm}`;
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

/* ── Dual-line chart for head-to-head markets ── */
function DualLiveChart({ pts1, pts2, c1, c2, l1, l2 }: { pts1: number[]; pts2: number[]; c1: string; c2: string; l1: string; l2: string }) {
  const [p1, setP1] = useState(pts1);
  const [p2, setP2] = useState(pts2);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

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

  useEffect(() => {
    const id = setInterval(() => {
      setP1(prev => { const last = prev[prev.length - 1]; const next = [...prev, Math.max(2, Math.min(98, last + (Math.random() - 0.48) * 1.5))]; return next.length > 70 ? next.slice(-70) : next; });
      setP2(prev => { const last = prev[prev.length - 1]; const next = [...prev, Math.max(2, Math.min(98, last + (Math.random() - 0.52) * 1.5))]; return next.length > 70 ? next.slice(-70) : next; });
    }, 1200);
    return () => clearInterval(id);
  }, []);

  const W = dims.w || 600, H = dims.h || 280;
  const pL = 0, pR = 68, pT = 12, pB = 28;
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

  if (dims.w === 0) return <div ref={wrapRef} className="w-full h-full" />;

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-crosshair block"
        onMouseMove={handleMouse} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`area-${c1.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c1} stopOpacity="0.08" />
            <stop offset="100%" stopColor={c1} stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id={`area-${c2.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c2} stopOpacity="0.06" />
            <stop offset="100%" stopColor={c2} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (<g key={i}><line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.03)" strokeDasharray="2,5" /><text x={W - pR + 8} y={toY(v) + 4} fontSize="11" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.25)">{Math.round(v)}%</text></g>))}
        {/* Area fills */}
        <path d={`${mkBezier(p1)} L ${toX(p1.length - 1).toFixed(1)} ${(pT + cH).toFixed(1)} L ${pL.toFixed(1)} ${(pT + cH).toFixed(1)} Z`} fill={`url(#area-${c1.replace('#','')})`} />
        {/* Lines */}
        <path d={mkBezier(p1)} fill="none" stroke={c1} strokeWidth="2.5" strokeLinecap="round" />
        <path d={mkBezier(p2)} fill="none" stroke={c2} strokeWidth="2" strokeLinecap="round" strokeDasharray="6,4" opacity="0.7" />
        {/* Endpoints */}
        <circle cx={toX(p1.length - 1)} cy={toY(last1)} r="8" fill={c1} opacity="0.05"><animate attributeName="r" values="8;16;8" dur="2s" repeatCount="indefinite" /></circle>
        <circle cx={toX(p1.length - 1)} cy={toY(last1)} r="4.5" fill={c1} />
        <circle cx={toX(p1.length - 1)} cy={toY(last1)} r="1.5" fill="white" />
        <circle cx={toX(p2.length - 1)} cy={toY(last2)} r="6" fill={c2} opacity="0.05"><animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" /></circle>
        <circle cx={toX(p2.length - 1)} cy={toY(last2)} r="3.5" fill={c2} />
        {/* Endpoint labels */}
        <rect x={toX(p1.length - 1) + 8} y={toY(last1) - 12} width="54" height="24" rx="6" fill="rgba(0,0,0,0.7)" stroke={c1} strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={toX(p1.length - 1) + 14} y={toY(last1) + 3} fontSize="12" fontFamily="var(--font-mono)" fontWeight="700" fill={c1}>{Math.round(last1)}%</text>
        <rect x={toX(p2.length - 1) + 8} y={toY(last2) - 12} width="54" height="24" rx="6" fill="rgba(0,0,0,0.7)" stroke={c2} strokeWidth="0.5" strokeOpacity="0.4" />
        <text x={toX(p2.length - 1) + 14} y={toY(last2) + 3} fontSize="12" fontFamily="var(--font-mono)" fontWeight="700" fill={c2}>{Math.round(last2)}%</text>
        {/* Hover crosshair */}
        {hover && (() => {
          const v1 = p1[Math.min(hover.idx, p1.length - 1)];
          const v2 = p2[Math.min(hover.idx, p2.length - 1)];
          return (
            <g>
              <line x1={hover.x} y1={pT} x2={hover.x} y2={pT + cH} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={hover.x} cy={toY(v1)} r="4" fill={c1} stroke="white" strokeWidth="1.5" />
              <circle cx={hover.x} cy={toY(v2)} r="4" fill={c2} stroke="white" strokeWidth="1.5" />
              <rect x={hover.x - 28} y={toY(v1) - 20} width="56" height="16" rx="4" fill="rgba(0,0,0,0.8)" stroke={c1} strokeWidth="0.5" strokeOpacity="0.5" />
              <text x={hover.x} y={toY(v1) - 9} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fontWeight="600" fill={c1}>{Math.round(v1)}%</text>
              <rect x={hover.x - 28} y={toY(v2) - 20} width="56" height="16" rx="4" fill="rgba(0,0,0,0.8)" stroke={c2} strokeWidth="0.5" strokeOpacity="0.5" />
              <text x={hover.x} y={toY(v2) - 9} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fontWeight="600" fill={c2}>{Math.round(v2)}%</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

/* ── Multi-line chart for multi-option markets ── */
function MultiLineLiveChart({ lines }: { lines: { initialPoints: number[]; color: string; label: string }[] }) {
  const [allLines, setAllLines] = useState(lines.map(l => ({ ...l, points: [...l.initialPoints] })));
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);

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

  useEffect(() => {
    const id = setInterval(() => {
      setAllLines(prev => prev.map(line => { const last = line.points[line.points.length - 1]; const next = [...line.points, Math.max(2, Math.min(98, last + (Math.random() - 0.5) * 1.8))]; return { ...line, points: next.length > 70 ? next.slice(-70) : next }; }));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const W = dims.w || 600, H = dims.h || 260;
  const pL = 0, pR = 68, pT = 8, pB = 28;
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

  if (dims.w === 0) return <div ref={wrapRef} className="w-full h-full" />;

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-crosshair block"
        onMouseMove={handleMouse} onMouseLeave={() => setHover(null)}>
        {ticks.map((v, i) => (<g key={i}><line x1={pL} y1={toY(v)} x2={W - pR} y2={toY(v)} stroke="rgba(255,255,255,0.035)" strokeDasharray="2,5" /><text x={W - pR + 8} y={toY(v) + 4} fontSize="12" fontFamily="var(--font-mono)" fill="rgba(255,255,255,0.35)">{Math.round(v)}%</text></g>))}
        {allLines.map((line, li) => {
          const last = line.points[line.points.length - 1];
          return (<g key={li}><path d={mkBezier(line.points)} fill="none" stroke={line.color} strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            <circle cx={toX(line.points.length - 1)} cy={toY(last)} r="6" fill={line.color} opacity="0.06"><animate attributeName="r" values="6;12;6" dur="2s" repeatCount="indefinite" /></circle>
            <circle cx={toX(line.points.length - 1)} cy={toY(last)} r="3.5" fill={line.color} /></g>);
        })}
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
    </div>
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
  if (/ufc|mma|boxing|bellator|pfl/.test(q)) return "Combat Sports";
  if (/premier league|arsenal|manchester|liverpool|chelsea|tottenham/.test(q)) return "Football \u00B7 Premier League";
  if (/la liga|real madrid|barcelona|atletico/.test(q)) return "Football \u00B7 La Liga";
  if (/serie a|inter milan|ac milan|juventus|napoli/.test(q)) return "Football \u00B7 Serie A";
  if (/bundesliga|bayern|dortmund|leverkusen/.test(q)) return "Football \u00B7 Bundesliga";
  if (/ligue 1|psg|marseille|monaco|lille/.test(q)) return "Football \u00B7 Ligue 1";
  if (/liga mx|club america|monterrey|tigres/.test(q)) return "Football \u00B7 Liga MX";
  if (/champions league|europa league/.test(q)) return "Football \u00B7 UEFA";
  if (/world cup|copa america|euro 20/.test(q)) return "Football \u00B7 International";
  if (/formula 1|f1|grand prix/.test(q)) return "Motorsport \u00B7 F1";
  if (/nascar|indycar|daytona/.test(q)) return "Motorsport";
  if (/tennis|wimbledon|us open|australian open|french open|roland garros/.test(q)) return "Tennis";
  if (/golf|pga|masters|british open/.test(q)) return "Golf";
  if (/cricket|ipl|test match|t20/.test(q)) return "Cricket";
  if (/rugby|six nations/.test(q)) return "Rugby";
  if (/ncaa|ncaaf|march madness|college/.test(q)) return "College Sports";
  if (/nhl|hockey|stanley cup/.test(q)) return "Hockey \u00B7 NHL";
  if (/mls|inter miami|la galaxy|lafc/.test(q)) return "Football \u00B7 MLS";
  if (/olympics|paralympics/.test(q)) return "Olympics";
  if (/esports|league of legends|valorant|dota/.test(q)) return "Esports";
  if (/cycling|tour de france/.test(q)) return "Cycling";
  if (/horse racing|kentucky derby/.test(q)) return "Horse Racing";
  return "Live Sports";
}

function fmtVol(poolWei: bigint): string {
  const w = poolWei / 10n ** 18n; const n = Number(w);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n > 0) return `${n} STRK`;
  return "\u2014";
}

/** Extract two sides from a prediction question */
function extractMatchup(question: string): { team1: string; team2: string; sport: string } {
  const q = question;
  // "X vs Y" or "X vs. Y"
  const vsMatch = q.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+[-\u2013]|\s+winner|\?|$)/i);
  if (vsMatch) {
    return { team1: vsMatch[1].trim(), team2: vsMatch[2].trim(), sport: detectSportSub(q) };
  }
  // "Will X beat Y" / "Will X win against Y"
  const beatMatch = q.match(/Will (?:the )?(.+?)\s+(?:beat|win against|defeat)\s+(?:the )?(.+?)[\s?]/i);
  if (beatMatch) {
    return { team1: beatMatch[1].trim(), team2: beatMatch[2].trim(), sport: detectSportSub(q) };
  }
  // "Will X win [the thing]"
  const winMatch = q.match(/Will (?:the )?(.+?)\s+(?:win|cover|score)/i);
  if (winMatch) {
    return { team1: winMatch[1].trim(), team2: "Opponent", sport: detectSportSub(q) };
  }
  return { team1: "Team A", team2: "Team B", sport: detectSportSub(q) };
}

/** Get sport-specific icon */
function getSportIcon(sport: string): string {
  if (/NBA|Basketball/i.test(sport)) return "\u{1F3C0}";
  if (/NFL|Football(?! \u00B7)/i.test(sport)) return "\u{1F3C8}";
  if (/MLB|Baseball/i.test(sport)) return "\u26BE";
  if (/Combat|UFC|MMA|Boxing/i.test(sport)) return "\u{1F94A}";
  if (/Premier|La Liga|Serie|Bundesliga|Ligue|Liga MX|UEFA|MLS|International|Football/i.test(sport)) return "\u26BD";
  if (/F1|Motorsport|NASCAR/i.test(sport)) return "\u{1F3CE}\uFE0F";
  if (/Tennis/i.test(sport)) return "\u{1F3BE}";
  if (/Golf/i.test(sport)) return "\u26F3";
  if (/Cricket/i.test(sport)) return "\u{1F3CF}";
  if (/Rugby/i.test(sport)) return "\u{1F3C9}";
  if (/Hockey|NHL/i.test(sport)) return "\u{1F3D2}";
  if (/Olympics/i.test(sport)) return "\u{1F3C5}";
  if (/Esports/i.test(sport)) return "\u{1F3AE}";
  if (/Cycling/i.test(sport)) return "\u{1F6B4}";
  if (/Horse/i.test(sport)) return "\u{1F3C7}";
  return "\u{1F3C6}";
}

/* ═══════════════════════════════════════════════════════════
   SPORTS HERO — Polymarket-style matchup card
   Prominent dual-line chart, team avatars, live scoreboard,
   clean bet buttons with odds
   ═══════════════════════════════════════════════════════════ */
function SportsHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  const { pct: yesPct, ticked } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const noPct = 100 - yesPct;
  const { team1, team2, sport } = extractMatchup(market.question);
  const sportIcon = getSportIcon(sport);

  const secsToResolve = market.resolutionTime - Date.now() / 1000;
  const isLive = secsToResolve > 0 && secsToResolve < 3600;

  // Team colors — consistent from market ID
  const t1Hue = (market.id * 47) % 360;
  const t2Hue = (t1Hue + 180) % 360;
  const t1Color = `hsl(${t1Hue}, 70%, 55%)`;
  const t2Color = `hsl(${t2Hue}, 65%, 50%)`;

  // Live scores
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

  // Dual chart data
  const chart1 = useMemo(() => genChartData(market.impliedProbYes, market.id, 55), [market.id, market.impliedProbYes]);
  const chart2 = useMemo(() => genChartData(1 - market.impliedProbYes, market.id + 999, 55), [market.id, market.impliedProbYes]);

  const t1Short = team1.length > 12 ? team1.slice(0, 10) + "." : team1;
  const t2Short = team2.length > 12 ? team2.slice(0, 10) + "." : team2;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* ── Matchup header: Team avatars + scoreboard ── */}
      <div className="shrink-0 flex items-center justify-center gap-4 sm:gap-8 py-3 mb-2">
        {/* Team 1 */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-[18px] sm:text-[20px] font-heading font-black text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${t1Color}, ${t1Color}dd)`, boxShadow: `0 4px 20px ${t1Color}40` }}
          >
            {team1.slice(0, 3).toUpperCase()}
          </div>
          <span className="text-[11px] sm:text-[12px] text-white/60 font-heading font-semibold text-center max-w-[100px] truncate">{t1Short}</span>
        </div>

        {/* Score / Live indicator */}
        <div className="text-center">
          {isLive ? (
            <>
              <div className="text-[28px] sm:text-[36px] font-heading font-black text-white tabular-nums tracking-tight leading-none">
                <span key={`h-${score1}`} className="animate-count-up">{score1}</span>
                <span className="text-white/15 mx-2">&ndash;</span>
                <span key={`a-${score2}`} className="animate-count-up">{score2}</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                <span className="w-2 h-2 rounded-full bg-neo-red animate-live-breathe" />
                <span className="text-[10px] font-heading font-bold text-neo-red uppercase tracking-wide">Live</span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center">
              <span className="text-[28px] sm:text-[36px] font-heading font-black text-white/15">vs</span>
              <span className="text-[10px] text-white/25 font-heading font-semibold mt-0.5">{sport}</span>
            </div>
          )}
        </div>

        {/* Team 2 */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-[18px] sm:text-[20px] font-heading font-black text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${t2Color}, ${t2Color}dd)`, boxShadow: `0 4px 20px ${t2Color}40` }}
          >
            {team2.slice(0, 3).toUpperCase()}
          </div>
          <span className="text-[11px] sm:text-[12px] text-white/60 font-heading font-semibold text-center max-w-[100px] truncate">{t2Short}</span>
        </div>
      </div>

      {/* ── Bet buttons — two colored side-by-side ── */}
      <div className="shrink-0 flex gap-3 mb-3 px-1">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
          className={`flex-1 py-3 rounded-xl text-center transition-all active:scale-[0.97] ${ticked ? "animate-prob-tick" : ""}`}
          style={{
            background: `${t1Color}18`,
            border: `1.5px solid ${t1Color}35`,
          }}
        >
          <span className="block text-[14px] font-heading font-bold" style={{ color: t1Color }}>{t1Short}</span>
          <span className="block text-[20px] font-heading font-black tabular-nums leading-none mt-0.5" style={{ color: t1Color }}>{yesPct}%</span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
          className="flex-1 py-3 rounded-xl text-center transition-all active:scale-[0.97]"
          style={{
            background: `${t2Color}18`,
            border: `1.5px solid ${t2Color}35`,
          }}
        >
          <span className="block text-[14px] font-heading font-bold" style={{ color: t2Color }}>{t2Short}</span>
          <span className="block text-[20px] font-heading font-black tabular-nums leading-none mt-0.5" style={{ color: t2Color }}>{noPct}%</span>
        </button>
      </div>

      {/* ── Chart — prominent, fills remaining space ── */}
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="h-full px-2 py-1">
          <DualLiveChart pts1={chart1} pts2={chart2} c1={t1Color} c2={t2Color} l1={t1Short} l2={t2Short} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CRYPTO HERO — Price-to-beat cycle with live chart
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
  const pricePts = useMemo(() => genPricePath(startPrice, market.id, 60), [startPrice, market.id]);

  const priceDec = basePrice < 10 ? 4 : 2;
  const fmtP = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`;

  const effectiveYes = yesPct >= 5 && yesPct <= 95 ? yesPct : 50;
  const upMult = Math.min(10, 100 / effectiveYes).toFixed(1);
  const downMult = Math.min(10, 100 / (100 - effectiveYes)).toFixed(1);

  const beatDelta = currentPrice - priceToBeat;
  const beating = beatDelta >= 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <p className="text-[11px] text-white/25 font-mono mb-2 shrink-0">{timeWindow}</p>

      {/* Price hero row */}
      <div className="shrink-0 flex items-end justify-between mb-3 flex-wrap gap-y-2">
        <div className="flex items-end gap-5 lg:gap-8">
          <div>
            <span className="text-[11px] text-white/35 font-heading font-semibold tracking-wide">Price to Beat</span>
            <p className="text-[28px] lg:text-[34px] font-heading font-extrabold text-white/50 tabular-nums leading-none tracking-tight">{fmtP(priceToBeat)}</p>
          </div>
          <div>
            <span className="text-[11px] font-heading font-semibold tracking-wide" style={{ color: "#f59e0b" }}>
              Current Price
              <span className={`ml-1.5 text-[13px] font-mono font-bold ${beating ? "text-neo-green" : "text-neo-red"}`}>
                {beating ? "\u25B2" : "\u25BC"} {fmtP(Math.abs(beatDelta))}
              </span>
            </span>
            <p className={`text-[28px] lg:text-[34px] font-heading font-extrabold tabular-nums leading-none tracking-tight ${flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : ""} ${beating ? "text-neo-green" : "text-neo-red"}`}
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

      {/* UP/DOWN buttons */}
      <div className="shrink-0 flex gap-3 mb-3">
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
          className={`flex-1 py-3 rounded-xl text-center font-heading font-extrabold bg-neo-orange/[0.18] border border-neo-orange/30 hover:bg-neo-orange/[0.28] hover:border-neo-orange/45 active:scale-[0.97] transition-all ${ticked ? "animate-prob-tick" : ""}`}>
          <span className="text-neo-orange text-[17px]">UP <span className="tabular-nums">{upMult}x</span></span>
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
          className="flex-1 py-3 rounded-xl text-center font-heading font-extrabold bg-white/[0.06] border border-white/[0.10] hover:bg-white/[0.10] hover:border-white/[0.16] active:scale-[0.97] transition-all">
          <span className="text-white/50 text-[17px]">DOWN <span className="tabular-nums">{downMult}x</span></span>
        </button>
      </div>

      {/* Chart — fills remaining space */}
      <div className="flex-1 min-h-0">
        <LiveChart initialPoints={pricePts} color="#f59e0b" yUnit="$" targetPrice={priceToBeat} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   POLITICS / ELECTIONS HERO — Multi-candidate chart
   ═══════════════════════════════════════════════════════════ */
const POLITICS_OPTION_COLORS = ["#3b82f6", "#60a5fa", "#f59e0b", "#f97316"];

const POLITICS_OPTION_POOL: Record<number, string[]> = {
  904: ["James Talarico", "Jasmine Crockett", "Emily Morgul", "Colin Allred"],
  905: ["Republican wins Senate", "Democrat wins Senate", "Independent kingmaker", "No majority"],
};
const POLITICS_OPTION_FALLBACK = ["Candidate A", "Candidate B", "Candidate C", "Candidate D"];

function PoliticsHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
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
      {/* Left: candidates */}
      <div className="lg:w-[42%] shrink-0 flex flex-col h-full min-h-0 overflow-hidden lg:pr-4">
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
        <div className="flex-1 min-h-0 overflow-hidden mt-2 border-t border-white/[0.04] pt-2">
          <LiveNewsFeed question={market.question} marketId={market.id} />
        </div>
      </div>
      {/* Right: chart */}
      <div className="flex-1 min-w-0 flex flex-col lg:pl-3 mt-2 lg:mt-0 h-full">
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
        <div className="flex-1 min-h-0">
          <MultiLineLiveChart lines={chartLines} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DEFAULT HERO — Generic Yes/No with chat + chart
   ═══════════════════════════════════════════════════════════ */
function DefaultHero({ market, onBet }: { market: Market; onBet: (id: number, o?: 0 | 1) => void }) {
  const { pct: yesPct, ticked } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const noPct = 100 - yesPct;
  const category = categorizeMarket(market.question);
  const chartPts = useMemo(() => genChartData(market.impliedProbYes, market.id, 60), [market.id, market.impliedProbYes]);
  const chartColor = yesPct >= 50 ? "#10b981" : "#3b82f6";
  const countdown = useLiveCountdown(market.resolutionTime);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Prob + countdown row */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-[32px] font-heading font-extrabold tabular-nums leading-none ${yesPct >= 50 ? "text-neo-green" : "text-neo-red"} ${ticked ? "animate-prob-tick" : ""}`} key={yesPct}>{yesPct}%</span>
          <span className="text-[12px] text-white/25 font-heading font-medium">chance</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] text-white/25 uppercase font-heading font-semibold tracking-widest">Ends</span>
          <p className="text-[16px] font-heading font-extrabold text-orange-400/80 tabular-nums font-mono leading-tight" key={countdown}>{countdown}</p>
        </div>
      </div>

      {/* Bet buttons */}
      <div className="shrink-0 flex gap-2.5 mb-3">
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 1); }}
          className={`flex-1 py-2.5 rounded-xl text-center font-heading font-bold bg-neo-green/[0.1] border border-neo-green/20 hover:bg-neo-green/[0.18] hover:border-neo-green/30 active:scale-[0.97] transition-all ${ticked ? "animate-prob-tick" : ""}`}>
          <span className="text-neo-green text-[14px]">Yes <span className="tabular-nums">{yesPct}&cent;</span></span>
        </button>
        <button type="button" onClick={(e) => { e.preventDefault(); onBet(market.id, 0); }}
          className="flex-1 py-2.5 rounded-xl text-center font-heading font-bold bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] active:scale-[0.97] transition-all">
          <span className="text-white/40 text-[14px]">No <span className="tabular-nums">{noPct}&cent;</span></span>
        </button>
      </div>

      {/* Chat + Chart side by side on lg */}
      <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0 overflow-hidden">
        <div className="lg:w-[260px] shrink-0 flex flex-col h-full min-h-0 lg:pr-3 lg:border-r lg:border-white/[0.04]">
          <div className="flex-1 min-h-0 overflow-hidden">
            <LiveChatFeed category={category} question={market.question} marketId={market.id} />
          </div>
        </div>
        <div className="flex-1 min-w-0 lg:pl-2 mt-2 lg:mt-0 h-full">
          <LiveChart initialPoints={chartPts} color={chartColor} yUnit="%" />
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
    const sorted = [...markets]
      .sort((a, b) => Number(safeBigInt(b.totalPool) / 10n ** 18n) - Number(safeBigInt(a.totalPool) / 10n ** 18n));
    const top = sorted.slice(0, Math.min(6, sorted.length));

    // Ensure a sports market is always featured (first position)
    const sportsIdx = top.findIndex(m => categorizeMarket(m.question) === "sports");
    if (sportsIdx > 0) {
      // Move sports market to front
      const [sports] = top.splice(sportsIdx, 1);
      top.unshift(sports);
    } else if (sportsIdx === -1) {
      // No sports in top 6 — find one and swap it in at position 0
      const sportsMarket = sorted.find(m => categorizeMarket(m.question) === "sports");
      if (sportsMarket) {
        top.pop();
        top.unshift(sportsMarket);
      }
    }
    return top;
  }, [markets]);

  const breakingNews = useMemo(() => {
    return markets
      .map(m => {
        const wp = typeof weightedProbs[m.id] === "number" ? (weightedProbs[m.id] as number) : m.impliedProbYes;
        const aiProb = Math.round(wp * 100) || Math.round(30 + seededRand(m.id, 99) * 50);
        const rawDiff = typeof weightedProbs[m.id] === "number"
          ? Math.round((wp - m.impliedProbYes) * 100)
          : Math.round((seededRand(m.id, 77) - 0.5) * 8);
        const diff = Math.max(-5, Math.min(5, rawDiff));
        return { market: m, aiProb, diff };
      })
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 7);
  }, [markets, weightedProbs]);

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
      [/premier league|la liga|serie a|champions league/i, "Football"],
      [/ufc|boxing|mma/i, "Combat Sports"],
      [/nba|basketball/i, "NBA"],
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
    return topics.sort((a, b) => b.count - a.count).slice(0, 6);
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
  const poolVol = fmtVol(safeBigInt(featured.totalPool));
  const featuredSecsLeft = featured.resolutionTime - Date.now() / 1000;
  const isLive = featuredSecsLeft > 0 && featuredSecsLeft < 3600;

  // Pick sport icon for sports category
  const displayIcon = category === "sports" ? getSportIcon(detectSportSub(featured.question)) : catMeta.icon;

  // Category-specific hero renderer
  function renderHero() {
    const key = featured.id;
    if (category === "sports") return <SportsHero key={key} market={featured} onBet={onBet} />;
    if (category === "crypto") return <CryptoHero key={key} market={featured} onBet={onBet} />;
    if (category === "politics" || category === "elections") return <PoliticsHero key={key} market={featured} onBet={onBet} />;
    return <DefaultHero key={key} market={featured} onBet={onBet} />;
  }

  return (
    <div className="mb-6 animate-card-enter">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-stretch">
        {/* ─── Hero card ─── */}
        <div className={`market-card overflow-hidden relative flex flex-col h-[560px] ${isLive ? "market-card-live" : ""}`}>
          {/* Subtle dot-grid texture */}
          <div className="absolute inset-0 pointer-events-none z-0" style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }} />

          {/* Title bar */}
          <div className="relative z-[1] flex items-center justify-between px-5 lg:px-6 pt-4 pb-0 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px] shrink-0"
                   style={{ background: `${catMeta.color}12`, border: `1px solid ${catMeta.color}20` }}>
                {displayIcon}
              </div>
              <div className="min-w-0">
                <h2 className="font-heading font-bold text-white leading-snug text-[16px] lg:text-[18px] line-clamp-2">{featured.question}</h2>
                <div className="flex items-center gap-1.5 text-[10px] font-heading font-medium mt-0.5">
                  <span style={{ color: catMeta.color }}>{catMeta.label}</span>
                  {catSub && <><span className="text-white/12">&middot;</span><span className="text-white/25">{catSub}</span></>}
                  <span className="text-white/12">&middot;</span>
                  <span className="text-white/20 font-mono tabular-nums">{poolVol} Vol</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isLive && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase bg-neo-red/[0.1] text-neo-red border border-neo-red/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-red animate-live-breathe" />LIVE
                </span>
              )}
              <Link
                href={`/market/${featured.id}`}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors no-underline"
              >
                <svg className="w-4 h-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Category-specific content */}
          <div className="relative z-[1] px-5 lg:px-6 pt-3 pb-3 flex-1 min-h-0 flex flex-col">
            {renderHero()}
          </div>

          {/* Footer */}
          <div className="relative z-[1] flex items-center justify-between px-5 lg:px-6 py-2 border-t border-white/[0.04]">
            <div className="flex items-center gap-4">
              <span className="text-[12px] font-mono font-semibold text-white/25 tabular-nums">
                {poolVol} Vol
              </span>
              {isLive && <span className="flex items-center gap-1 text-neo-red/60 text-[11px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-neo-red animate-live-breathe" />LIVE</span>}
            </div>
            <span className="flex items-center gap-2 font-heading font-semibold text-white/25 text-[12px]">
              <TamagotchiBadge autonomousMode={true} marketDataSource="onchain" marketDataStale={false} activeAgents={1} nextTickIn={null} size={14} />
              HiveCaster
            </span>
          </div>
        </div>

        {/* ─── Right sidebar — Breaking News + Hot Topics ─── */}
        <div className="hidden xl:flex flex-col gap-0 h-[560px]">
          <div className="neo-card overflow-hidden flex flex-col h-full">
            {/* Breaking News */}
            <div className="px-4 pt-4 pb-2">
              <h3 className="font-heading text-[13px] font-bold text-white/70 mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-neo-red/10 border border-neo-red/20 flex items-center justify-center">
                  <svg className="w-3 h-3 text-neo-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                </div>
                Breaking news
                <span className="ml-auto flex items-center gap-1 rounded-md border border-neo-red/15 bg-neo-red/[0.06] px-1.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-red animate-live-breathe" />
                  <span className="text-[9px] font-bold text-neo-red/80">LIVE</span>
                </span>
              </h3>
              <div className="space-y-0">
                {breakingNews.slice(0, 5).map((item, i) => (
                  <Link key={item.market.id} href={`/market/${item.market.id}`} className="flex items-center gap-2.5 no-underline group/item py-2.5 border-b border-white/[0.04] last:border-0">
                    <span className="text-[11px] text-white/15 font-mono tabular-nums w-3 shrink-0 text-right">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-[12px] text-white/45 leading-snug group-hover/item:text-white/75 transition-colors line-clamp-2">{item.market.question}</span>
                    <div className="shrink-0 text-right ml-1">
                      <span className="text-[15px] font-heading font-extrabold text-white tabular-nums leading-none">{item.aiProb}%</span>
                    </div>
                    {item.diff !== 0 && (
                      <span className={`text-[10px] font-mono font-semibold tabular-nums shrink-0 ${item.diff > 0 ? "text-neo-green" : "text-neo-red"}`}>
                        {item.diff > 0 ? "\u2197" : "\u2198"}{Math.abs(item.diff)}%
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>

            <div className="border-t border-dashed border-white/[0.04] mx-4" />

            {/* Hot Topics */}
            <div className="px-4 pt-3 pb-2 flex-1">
              <h3 className="font-heading text-[13px] font-bold text-white/70 mb-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-neo-orange/10 border border-neo-orange/20 flex items-center justify-center">
                  <svg className="w-3 h-3 text-neo-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" /></svg>
                </div>
                Hot topics
              </h3>
              {hotTopics.map((t, i) => (
                <div key={t.label} className="flex items-center gap-2 group/topic cursor-pointer py-2 border-b border-white/[0.04] last:border-0">
                  <span className="text-[11px] text-white/15 font-mono tabular-nums w-3 shrink-0 text-right">{i + 1}</span>
                  <TamagotchiBadge autonomousMode={true} marketDataSource="onchain" marketDataStale={false} activeAgents={1} nextTickIn={null} size={14} />
                  <span className="flex-1 text-[13px] text-white/55 font-heading font-semibold group-hover/topic:text-white/80 transition-colors">{t.label}</span>
                  <span className="text-[10px] text-white/20 font-mono tabular-nums whitespace-nowrap">{fmtVol(t.volume)}</span>
                  <svg className="w-3 h-3 text-white/10 shrink-0 group-hover/topic:text-white/30 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </div>
              ))}
            </div>

            {/* Explore all */}
            <div className="px-4 pb-4 mt-auto">
              <button type="button" className="w-full py-2.5 rounded-xl text-[12px] font-heading font-semibold text-white/25 border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:text-white/45 transition-all">
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px] text-white/35 font-heading font-medium hover:bg-white/[0.06] hover:text-white/55 transition-all">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                {featuredMarkets[activeSlide - 1].question.slice(0, 22)}...
              </button>
            )}
            {activeSlide < featuredMarkets.length - 1 && (
              <button type="button" onClick={() => setActiveSlide(activeSlide + 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.02] text-[12px] text-white/35 font-heading font-medium hover:bg-white/[0.06] hover:text-white/55 transition-all">
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
