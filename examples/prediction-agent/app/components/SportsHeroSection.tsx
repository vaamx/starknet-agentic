"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import type { Market } from "./dashboard/types";

/* ─── Helpers ───────────────────────────────────────────── */

function seededRand(seed: number, i: number): number {
  return ((Math.sin(seed * 13.731 + i * 2.317) * 43758.5453) % 1 + 1) % 1;
}

function detectSportSub(q: string): string {
  const s = q.toLowerCase();
  if (/nba|lakers|celtics|warriors|bucks|nuggets|76ers|knicks|nets|suns|clippers|mavericks|grizzlies|cavaliers|timberwolves|thunder|heat|bulls|pacers|magic|rockets|spurs|pistons|hornets|hawks|raptors/.test(s)) return "NBA";
  if (/nfl|super bowl|seahawks|patriots|chiefs|eagles|49ers|ravens|bills|cowboys|packers|dolphins|lions|bengals|steelers|jets|rams|bears|saints|cardinals|falcons|buccaneers|colts|texans|jaguars|titans|commanders|vikings|browns|sb lx/.test(s)) return "NFL";
  if (/mlb|yankees|dodgers|astros|braves|phillies|world series/.test(s)) return "MLB";
  if (/ufc|mma|boxing|bellator|pfl/.test(s)) return "MMA";
  if (/premier league|arsenal|manchester|liverpool|chelsea|tottenham|newcastle|aston villa|brighton|west ham/.test(s)) return "EPL";
  if (/la liga|real madrid|barcelona|atletico/.test(s)) return "La Liga";
  if (/champions league|europa league/.test(s)) return "UCL";
  if (/serie a|inter milan|ac milan|juventus|napoli/.test(s)) return "Serie A";
  if (/bundesliga|bayern|dortmund|leverkusen/.test(s)) return "Bundesliga";
  if (/formula 1|f1|grand prix/.test(s)) return "F1";
  if (/tennis|wimbledon|us open|australian open|french open/.test(s)) return "Tennis";
  if (/golf|pga|masters/.test(s)) return "Golf";
  if (/nhl|hockey|stanley cup/.test(s)) return "NHL";
  if (/cricket|ipl|t20/.test(s)) return "Cricket";
  if (/ncaa|march madness|college/.test(s)) return "NCAA";
  return "Sports";
}

function getSportIcon(sport: string): string {
  if (/NBA/i.test(sport)) return "\u{1F3C0}";
  if (/NFL/i.test(sport)) return "\u{1F3C8}";
  if (/MLB/i.test(sport)) return "\u26BE";
  if (/MMA/i.test(sport)) return "\u{1F94A}";
  if (/EPL|La Liga|UCL|Serie|Bundesliga|MLS/i.test(sport)) return "\u26BD";
  if (/F1/i.test(sport)) return "\u{1F3CE}\uFE0F";
  if (/Tennis/i.test(sport)) return "\u{1F3BE}";
  if (/Golf/i.test(sport)) return "\u26F3";
  if (/NHL/i.test(sport)) return "\u{1F3D2}";
  if (/Cricket/i.test(sport)) return "\u{1F3CF}";
  if (/NCAA/i.test(sport)) return "\u{1F3C6}";
  return "\u{1F3C6}";
}

function extractMatchup(question: string): { team1: string; team2: string } {
  const q = question;
  const vsMatch = q.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s+[-\u2013]|\s+winner|\?|$)/i);
  if (vsMatch) return { team1: vsMatch[1].trim(), team2: vsMatch[2].trim() };
  const beatMatch = q.match(/Will (?:the )?(.+?)\s+(?:beat|win against|defeat)\s+(?:the )?(.+?)[\s?]/i);
  if (beatMatch) return { team1: beatMatch[1].trim(), team2: beatMatch[2].trim() };
  const winMatch = q.match(/Will (?:the )?(.+?)\s+(?:win|cover|score)/i);
  if (winMatch) return { team1: winMatch[1].trim(), team2: "" };
  return { team1: "", team2: "" };
}

function fmtVol(poolWei: bigint): string {
  const w = poolWei / 10n ** 18n; const n = Number(w);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n > 0) return `${n} STRK`;
  return "\u2014";
}

function fmtUsdVol(v: number | undefined): string {
  if (!v || v <= 0) return "";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/* ─── Inline sparkline ─── */
function MiniSparkline({ prob, seed, color }: { prob: number; seed: number; color: string }) {
  const pts: number[] = [];
  let v = prob * 60 + 20;
  for (let i = 0; i < 16; i++) {
    v += Math.sin(seed * 7.3 + i * 2.1) * 5 + Math.cos(seed * 3.7 + i) * 3;
    v = Math.max(5, Math.min(95, v));
    pts.push(v);
  }
  const w = 80, h = 28;
  const max = Math.max(...pts), min = Math.min(...pts);
  const range = max - min || 1;
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((pts[i] - min) / range) * (h - 4) - 2;
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/* ─── Live Probability ─── */
function useLiveProb(basePct: number, seed: number) {
  const [pct, setPct] = useState(basePct);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const move = Math.round((Math.random() - 0.48) * 2);
      if (move !== 0) {
        setPct(prev => Math.max(1, Math.min(99, prev + move)));
        setFlash(true);
        setTimeout(() => setFlash(false), 300);
      }
    }, 3000 + Math.random() * 3000);
    return () => clearInterval(id);
  }, [seed]);
  return { pct, flash };
}

/* ─── Matchup Card ─── */
function MatchupCard({ market, onBet, index }: {
  market: Market;
  onBet: (id: number, outcome?: 0 | 1) => void;
  index: number;
}) {
  const { team1, team2 } = extractMatchup(market.question);
  const sport = detectSportSub(market.question);
  const sportIcon = getSportIcon(sport);
  const { pct: yesPct, flash } = useLiveProb(Math.round(market.impliedProbYes * 100), market.id);
  const noPct = 100 - yesPct;
  const isPolymarket = market.source === "polymarket";

  const t1Hue = (market.id * 47) % 360;
  const t2Hue = (t1Hue + 160) % 360;
  const t1Color = `hsl(${t1Hue}, 65%, 55%)`;
  const t2Color = `hsl(${t2Hue}, 60%, 50%)`;

  const secsLeft = market.resolutionTime - Date.now() / 1000;
  const isLive = secsLeft > 0 && secsLeft < 3600;
  const timeLabel = secsLeft <= 0 ? "Ended" : secsLeft < 3600 ? `${Math.floor(secsLeft / 60)}m` : secsLeft < 86400 ? `${Math.floor(secsLeft / 3600)}h` : `${Math.floor(secsLeft / 86400)}d`;

  const vol = isPolymarket && market.volume24h
    ? fmtUsdVol(market.volume24h)
    : fmtVol(safeBigInt(market.totalPool));

  const displayTeam1 = team1 || market.question.slice(0, 18);
  const displayTeam2 = team2 || "Opponent";
  const t1Short = displayTeam1.length > 14 ? displayTeam1.slice(0, 12) + "." : displayTeam1;
  const t2Short = displayTeam2.length > 14 ? displayTeam2.slice(0, 12) + "." : displayTeam2;

  return (
    <div
      className="animate-card-enter flex flex-col"
      style={{ animationDelay: `${Math.min(index * 0.06, 0.5)}s` }}
    >
      <Link href={`/market/${market.id}`} className="no-underline group/card">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#181b23] hover:border-white/[0.12] transition-all w-[280px] sm:w-[300px]">
          {/* Sport accent strip */}
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${t1Color}80, transparent 40%, transparent 60%, ${t2Color}80)` }} />

          {/* Header */}
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[14px]">{sportIcon}</span>
              <span className="text-[10px] font-heading font-bold text-white/40 uppercase tracking-wider">{sport}</span>
              {isLive && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase bg-neo-red/[0.12] text-neo-red border border-neo-red/15">
                  <span className="w-1 h-1 rounded-full bg-neo-red animate-live-breathe" />
                  LIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isPolymarket && (
                <span className="text-[8px] font-bold text-blue-300/50 uppercase tracking-wider">PM</span>
              )}
              <span className="text-[10px] font-mono text-white/20 tabular-nums">{timeLabel}</span>
            </div>
          </div>

          {/* Matchup */}
          <div className="px-4 pb-2 flex items-center justify-between gap-2">
            {/* Team 1 */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-heading font-black text-white shrink-0"
                style={{ background: `linear-gradient(135deg, ${t1Color}, ${t1Color}cc)`, boxShadow: `0 2px 12px ${t1Color}30` }}
              >
                {displayTeam1.slice(0, 3).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-heading font-semibold text-white/70 truncate">{t1Short}</p>
                <p className={`text-[18px] font-heading font-black tabular-nums leading-none ${flash ? "animate-prob-tick" : ""}`} style={{ color: t1Color }}>{yesPct}%</p>
              </div>
            </div>

            {/* VS divider */}
            <div className="shrink-0 flex flex-col items-center px-1">
              <span className="text-[10px] font-heading font-black text-white/10">vs</span>
              {/* Sparkline */}
              <div className="w-[48px] h-[16px] mt-0.5 opacity-50">
                <MiniSparkline prob={market.impliedProbYes} seed={market.id} color={t1Color} />
              </div>
            </div>

            {/* Team 2 */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0 justify-end text-right">
              <div className="min-w-0">
                <p className="text-[12px] font-heading font-semibold text-white/70 truncate">{t2Short}</p>
                <p className="text-[18px] font-heading font-black tabular-nums leading-none" style={{ color: t2Color }}>{noPct}%</p>
              </div>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-heading font-black text-white shrink-0"
                style={{ background: `linear-gradient(135deg, ${t2Color}, ${t2Color}cc)`, boxShadow: `0 2px 12px ${t2Color}30` }}
              >
                {displayTeam2.slice(0, 3).toUpperCase()}
              </div>
            </div>
          </div>

          {/* Probability bar */}
          <div className="mx-4 mb-2.5 flex h-[4px] rounded-full overflow-hidden">
            <div className="h-full rounded-l-full transition-all duration-500" style={{ width: `${yesPct}%`, background: t1Color, opacity: 0.6 }} />
            <div className="h-full flex-1 rounded-r-full" style={{ background: t2Color, opacity: 0.3 }} />
          </div>

          {/* Bet buttons */}
          <div className="px-4 pb-3 flex gap-2">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 1); }}
              className="flex-1 py-2 rounded-xl text-center transition-all active:scale-[0.97]"
              style={{ background: `${t1Color}14`, border: `1.5px solid ${t1Color}30` }}
            >
              <span className="text-[12px] font-heading font-bold" style={{ color: t1Color }}>{t1Short} {yesPct}\u00A2</span>
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 0); }}
              className="flex-1 py-2 rounded-xl text-center transition-all active:scale-[0.97]"
              style={{ background: `${t2Color}14`, border: `1.5px solid ${t2Color}30` }}
            >
              <span className="text-[12px] font-heading font-bold" style={{ color: t2Color }}>{t2Short} {noPct}\u00A2</span>
            </button>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.04] flex items-center justify-between">
            <span className="text-[10px] font-mono text-white/15 tabular-nums">{vol} vol</span>
            <span className="text-[10px] text-white/15 font-heading font-medium">
              {market.tradeCount ?? 0} trades
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SPORTS HERO SECTION — Horizontal scrolling matchup strip
   ═══════════════════════════════════════════════════════════ */

interface SportsHeroSectionProps {
  markets: Market[];
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

export default function SportsHeroSection({ markets, onBet }: SportsHeroSectionProps) {
  const sportsMarkets = useMemo(() => {
    return markets
      .filter((m) => {
        const cat = m.category ?? categorizeMarket(m.question);
        return cat === "sports";
      })
      .filter((m) => m.status === 0 && m.resolutionTime > Date.now() / 1000)
      .sort((a, b) => {
        // Sort by: live first, then volume
        const aLive = a.resolutionTime - Date.now() / 1000 < 3600 ? 1 : 0;
        const bLive = b.resolutionTime - Date.now() / 1000 < 3600 ? 1 : 0;
        if (bLive !== aLive) return bLive - aLive;
        const aVol = a.volume24h ?? Number(safeBigInt(a.totalPool) / 10n ** 18n);
        const bVol = b.volume24h ?? Number(safeBigInt(b.totalPool) / 10n ** 18n);
        return bVol - aVol;
      })
      .slice(0, 12);
  }, [markets]);

  // Group by sport league
  const leagues = useMemo(() => {
    const groups = new Map<string, Market[]>();
    for (const m of sportsMarkets) {
      const sport = detectSportSub(m.question);
      const existing = groups.get(sport) ?? [];
      existing.push(m);
      groups.set(sport, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [sportsMarkets]);

  if (sportsMarkets.length === 0) return null;

  const liveCount = sportsMarkets.filter(m => m.resolutionTime - Date.now() / 1000 < 3600 && m.resolutionTime > Date.now() / 1000).length;

  return (
    <div className="mb-6 animate-card-enter">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neo-green/10 border border-neo-green/20 flex items-center justify-center">
            <span className="text-[18px]">{"\u{1F3C8}"}</span>
          </div>
          <div>
            <h2 className="font-heading text-[16px] font-bold text-white tracking-tight flex items-center gap-2">
              Sports
              {liveCount > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase bg-neo-red/[0.08] text-neo-red border border-neo-red/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-neo-red animate-live-breathe" />
                  {liveCount} Live
                </span>
              )}
            </h2>
            <p className="text-[11px] text-white/25 font-heading font-medium">
              {sportsMarkets.length} matchups across {leagues.length} leagues
            </p>
          </div>
        </div>

        {/* League pills */}
        <div className="hidden md:flex items-center gap-1.5">
          {leagues.slice(0, 5).map(([league, lMarkets]) => (
            <span
              key={league}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-heading font-semibold border border-white/[0.06] bg-white/[0.02] text-white/35"
            >
              <span className="text-[11px]">{getSportIcon(league)}</span>
              {league}
              <span className="text-white/15 font-mono tabular-nums">{lMarkets.length}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Horizontal scrolling matchup cards */}
      <div className="relative -mx-4 sm:-mx-6">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#12141a] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#12141a] to-transparent z-10 pointer-events-none" />

        <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 pb-2 hide-scrollbar snap-x snap-mandatory">
          {sportsMarkets.map((market, i) => (
            <div key={market.id} className="snap-start shrink-0">
              <MatchupCard market={market} onBet={onBet} index={i} />
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      {sportsMarkets.length > 3 && (
        <div className="flex items-center justify-center mt-3 gap-1">
          <div className="w-8 h-[3px] rounded-full bg-white/10" />
          <div className="w-3 h-[3px] rounded-full bg-white/[0.04]" />
          <div className="w-3 h-[3px] rounded-full bg-white/[0.04]" />
        </div>
      )}
    </div>
  );
}
