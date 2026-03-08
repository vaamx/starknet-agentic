/**
 * Market Discovery Pipeline — Discovers and generates prediction markets
 * from real-world data sources with LLM-powered question generation.
 *
 * 13 topic categories matching UI tabs:
 *   Politics, Elections, Geopolitics, Sports, Crypto, Finance, Earnings,
 *   Tech, Economy, Climate & Science, Culture, World, Other
 *
 * Sources: Polymarket events API, CoinGecko, News/RSS, ESPN, Tavily, X/Social
 * Each source respects per-source toggles and tick cadence from config.
 */

import {
  fetchPolymarketData,
  fetchPolymarketEvents,
  fetchPolymarketTrending,
  fetchPolymarketNew,
  POLYMARKET_TAG_MAP,
} from "./data-sources/polymarket";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchRssFeeds } from "./data-sources/rss-feeds";
import { fetchEspnScores } from "./data-sources/espn-live";
import { fetchTavilySearch } from "./data-sources/tavily";
import { fetchXTrends } from "./data-sources/x-trends";
import type { DataPoint } from "./data-sources";
import { config } from "./config";
import {
  categorizeMarket,
  estimateEngagementScore,
  type MarketCategory,
} from "./categories";
import { completeText } from "./llm-provider";

export interface SuggestedMarket {
  question: string;
  category: MarketCategory;
  suggestedResolutionDays: number;
  sourceUrl?: string;
  estimatedProbability?: number;
  reasoning?: string;
}

// ── Validation & normalization ──────────────────────────────────────────────

const LEGACY_SUFFIX_REGEX = /\s+\d+d\s+[0-9a-f]{4}$/i;
const GARBLED_SUFFIX_REGEX = /\s+[a-z]?\d[a-z0-9]{2,}$/i;
const TRAILING_TIME_HASH_REGEX = /\s+\d{1,3}d\s+[0-9a-f]{4,8}$/i;
const TRAILING_HASH_REGEX = /\s+[0-9a-f]{4,8}$/i;
const TRAILING_FRAGMENT_REGEX = /\s+(?:in|i|win|t|clo)$/i;
const GENERIC_PREDICATE_END_REGEX = /\b(?:win|lose|reach|hit|close|rise|fall)\?$/i;

function isValidMarketQuestion(question: string): boolean {
  const normalized = question.trim();
  if (normalized.length < 18 || normalized.length > 180) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  if (!normalized.endsWith("?")) return false;
  if (normalized.startsWith("Market #")) return false;
  if (/^spread:/i.test(normalized)) return false;
  if (/\(-?\d+(?:\.\d+)?\)/.test(normalized)) return false;
  if (LEGACY_SUFFIX_REGEX.test(normalized)) return false;
  if (TRAILING_TIME_HASH_REGEX.test(normalized)) return false;
  if (/\bwin t\b/i.test(normalized)) return false;
  if (TRAILING_FRAGMENT_REGEX.test(normalized.replace(/\?$/, ""))) return false;
  if (GENERIC_PREDICATE_END_REGEX.test(normalized)) return false;
  if (GARBLED_SUFFIX_REGEX.test(normalized) && !/\d{4}/.test(normalized)) {
    return false;
  }
  const words = normalized.split(/\s+/);
  return words.length >= 4;
}

function normalizeQuestion(text: string): string {
  const cleaned = text
    .replace(LEGACY_SUFFIX_REGEX, "")
    .replace(TRAILING_TIME_HASH_REGEX, "")
    .replace(TRAILING_HASH_REGEX, "")
    .replace(/\bwin t\b/gi, "win")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
}

export function questionFingerprint(question: string): string {
  return normalizeQuestion(question)
    .toLowerCase()
    .replace(LEGACY_SUFFIX_REGEX, "")
    .replace(TRAILING_TIME_HASH_REGEX, "")
    .replace(TRAILING_HASH_REGEX, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bwill\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Mechanical headline → question fallback ─────────────────────────────────

function headlineToQuestion(title: string): string {
  const cleaned = title.replace(/[.!]+$/, "").trim();
  if (/^will\b/i.test(cleaned)) return normalizeQuestion(cleaned);
  if (/^(who|which|what|when|how)\b/i.test(cleaned)) {
    return normalizeQuestion(cleaned);
  }
  return normalizeQuestion(`Will ${cleaned}`);
}

// ── LLM-powered question generation ─────────────────────────────────────────

const LLM_QUESTION_GEN_PROMPT = `You are a prediction market question generator. Given raw headlines or trending topics, generate a single high-quality binary prediction market question.

Rules:
- Start with "Will" and end with "?"
- Must resolve to YES or NO with an objective criterion
- Include a specific time bound (e.g., "by July 2026", "before Q3 2026", "within 30 days")
- Be specific and measurable — avoid ambiguous terms like "significant" or "major"
- Keep under 140 characters
- Focus on what's most interesting/tradeable about the topic

Output ONLY the question, nothing else.`;

let llmQuestionGenFailures = 0;
const LLM_QUESTION_GEN_MAX_FAILURES = 5;

async function llmGenerateQuestion(
  headlines: string[],
  category: MarketCategory
): Promise<string | null> {
  if (!config.discoveryLlmQuestionGen) return null;
  if (llmQuestionGenFailures >= LLM_QUESTION_GEN_MAX_FAILURES) return null;

  const input = headlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join("\n");
  const userMessage = `Category: ${category}\n\nHeadlines/topics:\n${input}\n\nGenerate one prediction market question:`;

  try {
    const result = await completeText({
      task: "triage",
      systemPrompt: LLM_QUESTION_GEN_PROMPT,
      userMessage,
      maxTokens: 120,
    });
    llmQuestionGenFailures = 0;
    const question = result.trim().replace(/^["']|["']$/g, "");
    if (!question || question.length < 20 || !question.endsWith("?")) return null;
    return normalizeQuestion(question);
  } catch (err: any) {
    llmQuestionGenFailures++;
    console.warn(`[discovery] LLM question gen failed (${llmQuestionGenFailures}/${LLM_QUESTION_GEN_MAX_FAILURES}):`, err?.message);
    return null;
  }
}

// ── Smart resolution duration ───────────────────────────────────────────────

function estimateResolutionDays(question: string, category: MarketCategory): number {
  const q = question.toLowerCase();

  // Extract explicit time references from the question itself
  const weekMatch = q.match(/(\d+)\s*weeks?/);
  if (weekMatch) return Math.min(90, parseInt(weekMatch[1], 10) * 7);

  const dayMatch = q.match(/(\d+)\s*days?/);
  if (dayMatch) return Math.min(90, parseInt(dayMatch[1], 10));

  const monthMatch = q.match(/(\d+)\s*months?/);
  if (monthMatch) return Math.min(180, parseInt(monthMatch[1], 10) * 30);

  // "by [Month] [Year]" or "before [Month] [Year]"
  const dateMatch = q.match(/(?:by|before)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (dateMatch) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const targetMonth = months.indexOf(dateMatch[1].toLowerCase());
    const targetYear = parseInt(dateMatch[2], 10);
    const target = new Date(targetYear, targetMonth + 1, 0);
    const days = Math.ceil((target.getTime() - Date.now()) / 86_400_000);
    if (days > 0 && days <= 365) return days;
  }

  // "Q1/Q2/Q3/Q4 [Year]"
  const quarterMatch = q.match(/q([1-4])\s*(\d{4})/i);
  if (quarterMatch) {
    const qEnd = parseInt(quarterMatch[1], 10) * 3;
    const year = parseInt(quarterMatch[2], 10);
    const target = new Date(year, qEnd, 0);
    const days = Math.ceil((target.getTime() - Date.now()) / 86_400_000);
    if (days > 0 && days <= 365) return days;
  }

  // Category-based defaults
  switch (category) {
    case "sports":
      if (/today|tonight|this game|this match/i.test(q)) return 1;
      if (/this season|this year|championship|playoffs/i.test(q)) return 30;
      return 3;
    case "crypto":
      if (/price|above|below|\$\d/i.test(q)) return 60;
      if (/launch|upgrade|fork|airdrop/i.test(q)) return 14;
      return 30;
    case "politics":
    case "geopolitics":
      if (/ceasefire|peace|war/i.test(q)) return 30;
      return 30;
    case "elections":
      if (/primary|caucus/i.test(q)) return 60;
      if (/nominee|nomination/i.test(q)) return 90;
      return 45;
    case "earnings":
      return 7;
    case "finance":
      if (/ipo|merger|acquisition/i.test(q)) return 30;
      if (/rate.*cut|rate.*hike/i.test(q)) return 45;
      return 21;
    case "economy":
      if (/cpi|jobs report|payroll/i.test(q)) return 14;
      if (/recession|gdp/i.test(q)) return 90;
      return 30;
    case "tech":
      if (/earnings|revenue|quarterly/i.test(q)) return 7;
      if (/launch|release|announce/i.test(q)) return 30;
      return 21;
    case "climate":
      if (/hurricane|wildfire|storm/i.test(q)) return 7;
      if (/paris agreement|carbon|emissions/i.test(q)) return 90;
      return 30;
    case "culture":
      if (/box office|opening weekend/i.test(q)) return 7;
      if (/album|oscar|grammy|emmy/i.test(q)) return 30;
      return 14;
    case "world":
      return 21;
    default:
      return 14;
  }
}

// ── Source helpers ───────────────────────────────────────────────────────────

function extractUsdPrice(value: string): number | null {
  const match = value.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

function buildSportsQuestionFromEspn(result: {
  summary: string;
  data: DataPoint[];
}): string | null {
  const teamRows = result.data.filter((point) =>
    /\(home\)|\(away\)/i.test(point.label)
  );
  if (teamRows.length < 2) return null;

  const teamNames = teamRows
    .map((point) => point.label.replace(/\s+\((home|away)\)/i, "").trim())
    .filter(Boolean);
  if (teamNames.length < 2) return null;

  const [teamA, teamB] = teamNames;
  const summary = result.summary.toLowerCase();
  if (summary.includes("final:")) return null;
  if (summary.includes("live:")) {
    return normalizeQuestion(`Will ${teamA} beat ${teamB} in this NFL game`);
  }
  return normalizeQuestion(`Will ${teamA} beat ${teamB} in their next NFL matchup`);
}

// ── Discovery tick tracking ─────────────────────────────────────────────────

let discoveryTickCount = 0;
let marketsCreatedToday = 0;
let lastDayReset = new Date().toDateString();

function checkDailyLimit(): boolean {
  const today = new Date().toDateString();
  if (today !== lastDayReset) {
    marketsCreatedToday = 0;
    lastDayReset = today;
  }
  return marketsCreatedToday < config.discoveryMaxMarketsPerDay;
}

export function recordMarketCreated(): void {
  marketsCreatedToday++;
}

export function incrementDiscoveryTick(): void {
  discoveryTickCount++;
}

function shouldRunSource(sourceEveryTicks: number): boolean {
  return discoveryTickCount % sourceEveryTicks === 0;
}

// ── Deep topic queries ──────────────────────────────────────────────────────
// Each category has 8-12 specific, real-world queries that rotate by tick.

const DISCOVERY_TOPICS: Record<string, string[]> = {
  politics: [
    "White House executive orders policy 2026",
    "congressional legislation bills vote floor",
    "Supreme Court rulings decisions pending cases",
    "governor approval ratings controversy scandal",
    "federal regulation enforcement actions SEC FTC",
    "political scandal investigation DOJ probe",
    "cabinet nominations confirmations hearing",
    "bipartisan deal compromise infrastructure",
    "state legislature abortion gun rights immigration",
    "political party leadership changes speaker",
    "attorney general special counsel indictment",
    "lobbying ethics reform campaign finance",
    "presidential approval rating polling trends",
    "government shutdown budget continuing resolution",
    "executive privilege subpoena oversight hearing",
  ],
  elections: [
    "2026 midterm election predictions polls",
    "2028 presidential race candidates announcement",
    "swing state polling Pennsylvania Wisconsin Michigan",
    "senate race predictions Arizona Nevada Georgia",
    "gubernatorial election primary results governors",
    "voter registration turnout trends early voting",
    "campaign fundraising records super PAC spending",
    "electoral map projection forecast 270towin",
    "ballot measures initiatives referendum state",
    "political endorsement party nomination convention",
    "debate schedule presidential primary candidates",
    "Iowa New Hampshire South Carolina primary calendar",
    "third party independent candidate ballot access",
    "redistricting gerrymandering court challenges",
    "election security voting machines paper ballots",
    "ranked choice voting reform open primaries",
    "UK general election Labour Conservative polls",
    "France Germany Italy Spain elections European",
    "Brazil Mexico Argentina Colombia elections Latin America",
    "India Lok Sabha election Modi BJP Congress",
    "Japan South Korea Australia elections Asia Pacific",
  ],
  geopolitics: [
    "Ukraine Russia conflict ceasefire negotiations Donbas",
    "China Taiwan tensions military exercises strait",
    "Middle East Israel Gaza ceasefire hostage deal",
    "NATO expansion defense spending Article 5",
    "Iran nuclear deal IAEA enrichment sanctions",
    "North Korea missile ICBM provocation summit",
    "Africa Sahel coup regime change military junta",
    "US China trade war tariffs technology ban",
    "UN Security Council resolution veto reform",
    "refugee crisis Mediterranean migration Europe",
    "Arctic territorial dispute sovereignty resources",
    "South China Sea freedom of navigation military",
    "India Pakistan border Kashmir tensions",
    "Venezuela Guyana territorial dispute Essequibo",
    "Ethiopia Tigray Sudan conflict humanitarian",
    "Myanmar civil war resistance NUG military",
    "BRICS expansion influence Global South",
    "European Union enlargement Western Balkans",
    "nuclear weapons proliferation disarmament treaty",
    "cyber warfare state-sponsored attacks attribution",
    "global arms race defense spending military budget",
    "Red Sea Houthis shipping disruption trade routes",
    "Syria Assad regime reconstruction sanctions",
    "Afghanistan Taliban governance humanitarian crisis",
  ],
  sports: [
    // ── American Football ───────────────────────
    "NFL draft picks mock trades quarterback predictions",
    "NFL free agency signings trades blockbuster deals",
    "NFL season predictions Super Bowl odds favorites",
    "NFL weekly matchups point spreads betting lines",
    "NFL MVP race quarterback passing yards touchdowns",
    "college football playoff rankings CFP predictions",
    "college football Heisman Trophy race candidates",
    // ── Basketball ──────────────────────────────
    "NBA playoffs bracket predictions championship odds",
    "NBA finals MVP race scoring leaders statistics",
    "NBA trade deadline deals rumors blockbuster",
    "NBA draft lottery picks prospects mock draft",
    "NBA regular season standings playoff picture",
    "EuroLeague basketball Final Four predictions",
    "FIBA World Cup basketball national teams",
    "college basketball March Madness bracket predictions",
    // ── Soccer / Football Global ────────────────
    "Premier League title race Manchester City Arsenal Liverpool",
    "Premier League relegation battle survival odds",
    "Premier League golden boot top scorer predictions",
    "Champions League knockout round predictions draw",
    "Champions League final winner odds predictions",
    "Europa League Conference League results predictions",
    "La Liga title race Real Madrid Barcelona Atletico",
    "La Liga relegation standings predictions Spain",
    "Serie A title race Inter Milan Juventus Napoli",
    "Bundesliga title race Bayern Dortmund Leverkusen",
    "Ligue 1 title race PSG Monaco Marseille Lyon",
    "Liga MX Apertura Clausura final America Monterrey Tigres",
    "Liga MX liguilla playoff bracket predictions Mexico",
    "Copa Libertadores final South American clubs predictions",
    "Copa Sudamericana results knockout rounds",
    "Brazilian Serie A Flamengo Palmeiras championship",
    "Argentine Primera Division Boca River Plate",
    "Colombian Primera Liga BetPlay results predictions",
    "Eredivisie Dutch league Ajax PSV Feyenoord",
    "Scottish Premiership Celtic Rangers Old Firm",
    "Portuguese Primeira Liga Porto Benfica Sporting",
    "Turkish Super Lig Galatasaray Fenerbahce Besiktas",
    "Saudi Pro League Al Hilal Al Nassr Ronaldo",
    "MLS Cup playoffs Inter Miami LAFC predictions",
    "World Cup qualifying standings predictions",
    "Copa America results bracket predictions",
    "Euro Championship qualifying standings predictions",
    "Africa Cup of Nations AFCON results predictions",
    "Asian Cup AFC Champions League results",
    "women's football World Cup NWSL WSL predictions",
    "transfer window deadline day signings rumors record",
    "Ballon d'Or FIFA Best Player award candidates",
    // ── Tennis ──────────────────────────────────
    "Australian Open draw predictions winner odds",
    "French Open Roland Garros clay court predictions",
    "Wimbledon draw predictions grass court champion",
    "US Open tennis draw predictions hard court winner",
    "ATP rankings race number one Djokovic Sinner Alcaraz",
    "WTA rankings race Swiatek Sabalenka Gauff",
    "ATP Finals year-end championship predictions",
    "Davis Cup Billie Jean King Cup national teams",
    // ── Combat Sports ──────────────────────────
    "UFC fight night main event predictions odds",
    "UFC championship title fight predictions belt",
    "boxing heavyweight championship fight predictions",
    "boxing pound for pound rankings title unification",
    "PFL Bellator MMA event predictions results",
    "WWE wrestling premium live events predictions",
    // ── Motorsport ─────────────────────────────
    "Formula 1 championship standings Verstappen predictions",
    "F1 race winner predictions qualifying results",
    "F1 constructors championship Red Bull Ferrari Mercedes",
    "NASCAR Cup Series race predictions standings",
    "IndyCar Indianapolis 500 predictions results",
    "MotoGP championship standings race predictions",
    "Rally WRC championship standings results",
    "Formula E electric racing results predictions",
    // ── Golf ────────────────────────────────────
    "Masters Tournament Augusta predictions winner odds",
    "PGA Championship predictions winner golf odds",
    "US Open golf predictions course winner favorites",
    "British Open golf predictions links course winner",
    "Ryder Cup Solheim Cup team predictions",
    "LIV Golf PGA Tour merger negotiations results",
    // ── Cricket ─────────────────────────────────
    "IPL Indian Premier League results predictions",
    "Cricket Test match series Ashes predictions",
    "T20 World Cup cricket predictions winner odds",
    "ODI World Cup cricket standings predictions",
    "Big Bash League BBL cricket results Australia",
    "Caribbean Premier League CPL cricket results",
    "Pakistan Super League PSL cricket results",
    // ── Rugby ───────────────────────────────────
    "Six Nations rugby championship predictions",
    "Rugby World Cup predictions winner odds",
    "Super Rugby Pacific results predictions",
    "English Premiership rugby Top 14 France",
    // ── Olympics & Athletics ────────────────────
    "Olympics medal count predictions host city records",
    "World Athletics Championship records predictions",
    "marathon world record attempt running predictions",
    "swimming world championships records predictions",
    "gymnastics world championships predictions",
    // ── Other Sports ───────────────────────────
    "horse racing Kentucky Derby Preakness Belmont predictions",
    "Grand National Cheltenham horse racing UK predictions",
    "Tour de France cycling GC predictions stage winners",
    "esports League of Legends Worlds championship predictions",
    "esports Dota International CS2 Major Valorant Champions",
    "NHL Stanley Cup playoffs predictions hockey",
    "figure skating world championships predictions",
    "skiing World Cup biathlon cross-country standings",
    "surfing WSL championship tour predictions",
    "skateboarding climbing Olympic qualifying results",
  ],
  crypto: [
    "Bitcoin price prediction next month 2026 target",
    "Bitcoin ETF flows institutional BlackRock Fidelity",
    "Ethereum price target merge staking withdrawals",
    "Ethereum ETF approval flows institutional adoption",
    "Solana ecosystem growth TVL DeFi activity",
    "Starknet TVL ecosystem growth Cairo dApps",
    "crypto regulation SEC enforcement lawsuits Ripple",
    "DeFi protocol hack exploit vulnerability millions",
    "stablecoin market cap USDC USDT DAI regulation",
    "Bitcoin halving cycle price analysis bull market",
    "altcoin season rotation momentum market cap",
    "crypto exchange volume Binance Coinbase OKX Bybit",
    "NFT market sales OpenSea Blur collections floor",
    "layer 2 scaling wars rollup competition Base Arbitrum",
    "memecoin launches trending tokens Pump.fun Solana",
    "crypto derivatives futures options open interest",
    "Bitcoin mining hashrate difficulty revenue miners",
    "central bank digital currency CBDC digital euro dollar",
    "cross-chain bridges interoperability LayerZero Wormhole",
    "real world assets RWA tokenization treasuries",
    "AI crypto tokens intersection artificial intelligence",
    "gaming crypto tokens metaverse virtual worlds",
    "Cardano Polkadot Cosmos ecosystem development",
    "DePIN decentralized physical infrastructure Helium Render",
  ],
  finance: [
    "S&P 500 index target prediction year end 2026",
    "Federal Reserve interest rate decision FOMC meeting",
    "IPO market upcoming listings 2026 unicorn startups",
    "merger acquisition deal announcement hostile takeover",
    "stock market correction bear bull crash rally",
    "treasury yield curve inversion recession signal",
    "hedge fund activism short squeeze GameStop meme",
    "oil price Brent WTI OPEC production cut forecast",
    "gold price record all-time high safe haven prediction",
    "silver copper commodity supercycle prediction",
    "forex dollar euro yen exchange rate prediction",
    "real estate housing market mortgage rates forecast",
    "bond market credit spreads high yield default rate",
    "venture capital startup valuations AI funding rounds",
    "private equity buyout leveraged deal announcement",
    "commercial real estate office vacancy crisis",
    "insurance market catastrophe losses reinsurance",
    "emerging markets bonds stocks investment flows",
    "Japan Nikkei stock market all-time high yen",
    "European stocks DAX FTSE CAC performance outlook",
    "China A-shares Hong Kong Hang Seng market outlook",
    "India Sensex Nifty stock market all-time high",
    "sovereign wealth fund investment strategy allocation",
    "bank stress test results capital adequacy",
  ],
  earnings: [
    "Apple quarterly earnings revenue iPhone services guidance",
    "NVIDIA earnings data center AI GPU revenue guidance",
    "Tesla delivery numbers production Cybertruck earnings",
    "Microsoft cloud Azure revenue growth AI Copilot",
    "Amazon AWS e-commerce earnings Prime advertising",
    "Google Alphabet search AI revenue YouTube Cloud",
    "Meta quarterly results advertising Reality Labs losses",
    "Netflix subscriber growth content spend ad tier",
    "bank earnings JPMorgan Goldman Sachs Morgan Stanley",
    "semiconductor earnings TSMC Intel AMD Broadcom Qualcomm",
    "retail earnings Walmart Target Costco Home Depot",
    "pharma earnings Pfizer Moderna Eli Lilly Novo Nordisk",
    "Disney earnings streaming parks box office results",
    "Uber Lyft ride-sharing earnings profitability",
    "Airbnb Booking earnings travel demand revenue",
    "Salesforce CRM earnings cloud enterprise software",
    "Adobe Snowflake Palantir earnings AI enterprise",
    "oil company earnings Exxon Chevron Shell BP",
    "airline earnings United Delta American Southwest",
    "automaker earnings GM Ford Toyota Volkswagen",
    "luxury brand earnings LVMH Hermes Kering Prada",
    "food delivery DoorDash Instacart grocery earnings",
    "Spotify Roblox Pinterest Snap social media earnings",
    "SpaceX Starlink revenue valuation private market",
  ],
  tech: [
    "OpenAI GPT-5 model release capabilities announcement",
    "Apple iPhone launch event WWDC new products",
    "Google Gemini AI search update Pixel products",
    "autonomous vehicle Waymo Cruise self-driving approval",
    "AI regulation legislation EU AI Act safety bill",
    "semiconductor TSMC Intel Samsung foundry chip shortage",
    "quantum computing IBM Google breakthrough qubit error",
    "robotics humanoid Tesla Optimus Figure deployment",
    "social media TikTok ban legislation X Twitter changes",
    "cybersecurity breach ransomware major incident attack",
    "SpaceX Starship launch Falcon Heavy mission Mars",
    "foundation model Claude GPT Gemini Llama benchmark",
    "Anthropic Claude AI safety research funding round",
    "Meta AI open source Llama model release weights",
    "Microsoft Copilot Windows AI PC integration",
    "Amazon Alexa AI assistant upgrade AGI research",
    "Samsung Galaxy AI smartphone features launch",
    "virtual reality Apple Vision Pro Meta Quest headset",
    "autonomous drone delivery regulation approval",
    "biotech CRISPR gene editing clinical trial approval",
    "nuclear fusion energy milestone reactor experiment",
    "brain-computer interface Neuralink Synchron trial",
    "satellite internet Starlink OneWeb Kuiper coverage",
    "AI coding assistant GitHub Copilot Cursor Devin",
  ],
  economy: [
    "CPI inflation report consumer prices monthly data",
    "jobs report nonfarm payrolls unemployment rate",
    "GDP growth rate quarterly advance estimate revision",
    "consumer confidence index spending retail sales",
    "housing market home sales prices Case-Shiller",
    "manufacturing PMI ISM factory output orders",
    "trade deficit surplus balance imports exports",
    "debt ceiling government shutdown deadline funding",
    "wage growth average hourly earnings labor cost",
    "recession probability indicators yield curve model",
    "Federal budget deficit spending fiscal year",
    "supply chain disruption recovery shipping freight",
    "student loan debt forgiveness repayment default",
    "social security Medicare trust fund solvency",
    "minimum wage increase state federal policy",
    "gig economy workers classification regulation",
    "China GDP growth rate economic slowdown stimulus",
    "Eurozone inflation ECB interest rate decision",
    "Japan economy BOJ rate decision negative rates end",
    "emerging markets growth India Brazil Indonesia",
    "global trade volume WTO container shipping",
    "food prices agricultural commodities grain wheat",
    "energy prices electricity natural gas household bills",
    "child care costs affordability crisis policy",
  ],
  climate: [
    "hurricane season forecast Atlantic named storms major",
    "wildfire California Oregon western states acres burned",
    "renewable energy solar panel installations record capacity",
    "electric vehicle EV sales market share mandate",
    "carbon emissions reduction target net zero pledge",
    "nuclear energy plant approval restart construction",
    "Paris Agreement climate summit COP targets progress",
    "extreme weather heat dome temperature record broken",
    "ocean temperature coral reef bleaching marine crisis",
    "CRISPR gene therapy clinical trial FDA approval",
    "NASA Artemis Moon mission James Webb discovery",
    "fusion energy ITER NIF breakthrough net energy gain",
    "battery technology solid state lithium sodium",
    "hydrogen green fuel cell infrastructure development",
    "offshore wind farm construction approval capacity",
    "deforestation Amazon Congo rainforest satellite data",
    "glacier ice sheet melting sea level rise forecast",
    "biodiversity species extinction endangered protection",
    "carbon capture direct air technology deployment",
    "weather forecast La Nina El Nino ENSO prediction",
    "tornado season severe weather outbreak prediction",
    "flooding monsoon river levels displacement",
    "drought water shortage reservoir levels California",
    "asteroid defense DART mission near-Earth object",
  ],
  culture: [
    // ── Film & TV ──────────────────────────────
    "box office movie opening weekend domestic worldwide",
    "Oscar nominations Best Picture predictions Academy Awards",
    "Emmy nominations winners predictions television",
    "Golden Globe nominations winners predictions",
    "Cannes Film Festival Palme d'Or Venice Lion predictions",
    "Marvel MCU movie release box office predictions",
    "Disney Pixar animated movie release box office",
    "streaming platform subscriber numbers Netflix Disney HBO",
    "TV show premiere finale ratings viewership records",
    "Bollywood box office hit release India collections",
    "Korean drama K-drama Netflix top 10 ratings",
    "anime movie release Dragon Ball One Piece Demon Slayer",
    // ── Music ───────────────────────────────────
    "album release first week sales Billboard 200 chart",
    "Grammy nominations winners predictions categories",
    "Billboard Hot 100 number one song predictions",
    "Taylor Swift Eras Tour concert dates revenue records",
    "Drake Kendrick Lamar rap beef diss track response",
    "Bad Bunny Latin Grammy reggaeton album release",
    "BTS K-pop comeback album world tour announcement",
    "Beyonce Renaissance tour concert revenue records",
    "Spotify wrapped most streamed artist song records",
    "music festival Coachella Glastonbury Lollapalooza lineup",
    "Latin music awards Billboard Latin Premio Lo Nuestro",
    "Afrobeats Burna Boy Wizkid Davido global crossover",
    // ── Gaming ──────────────────────────────────
    "video game release date launch sales predictions",
    "GTA 6 release date gameplay trailer Rockstar",
    "PlayStation Xbox Nintendo Switch 2 console sales",
    "Elden Ring sequel DLC FromSoftware release",
    "Call of Duty Fortnite Minecraft player count records",
    "Steam sale gaming PC hardware GPU availability",
    "esports tournament prize pool viewership records",
    // ── Social Media & Internet ─────────────────
    "TikTok trend viral challenge creator earnings",
    "YouTube MrBeast subscriber milestone record",
    "Instagram Threads Twitter X user growth numbers",
    "influencer controversy cancellation brand deal",
    "AI generated content deepfake viral detection",
    // ── Celebrity & Pop Culture ─────────────────
    "celebrity wedding engagement divorce announcement",
    "celebrity controversy legal case trial verdict",
    "royal family monarchy news succession event",
    "fashion Met Gala Paris Fashion Week Milan trend",
    "art auction record sale Sotheby's Christie's NFT",
    "podcast chart topper Joe Rogan Alex Cooper numbers",
    "reality TV show premiere finale Bachelor Love Island",
    "Broadway West End theater Tony Awards opening night",
    "book bestseller literary prize Booker Pulitzer Nobel",
    // ── Food & Lifestyle ────────────────────────
    "restaurant Michelin star guide awards predictions",
    "food trend viral recipe TikTok food challenge",
  ],
  world: [
    "global pandemic outbreak health emergency WHO declaration",
    "earthquake tsunami natural disaster magnitude casualties",
    "humanitarian crisis famine aid response emergency",
    "world population milestone demographic transition",
    "water crisis drought emergency rationing infrastructure",
    "global migration refugee numbers UNHCR displacement",
    "G7 G20 summit outcomes communique agreements",
    "space exploration Mars lunar discovery habitable",
    "poverty inequality Gini coefficient development goals",
    "digital divide internet access connectivity rural",
    "global food security grain export crisis supply",
    "volcanic eruption seismic activity evacuation alert",
    "airline aviation incident safety investigation",
    "maritime shipping incident Suez Panama canal traffic",
    "global education literacy enrollment rates progress",
    "infectious disease outbreak containment vaccination",
    "ocean pollution plastic waste cleanup initiative",
    "endangered species conservation recovery success",
    "international space station ISS deorbit successor",
    "deep sea exploration discovery species ocean floor",
    "antibiotic resistance superbug drug development",
    "artificial intelligence ethics governance global",
    "nuclear waste storage disposal Yucca Mountain",
    "global internet outage infrastructure disruption",
  ],
};

// ── Polymarket category queries ─────────────────────────────────────────────

function getPolymarketTagsForCategory(category: string): string[] {
  return POLYMARKET_TAG_MAP[category] ?? POLYMARKET_TAG_MAP["politics"] ?? ["politics"];
}

function getPolymarketKeywordQueries(category: string): string[] {
  const topics = DISCOVERY_TOPICS[category];
  if (!topics || topics.length === 0) return ["prediction market trending"];
  // Pick 2 queries that rotate
  const idx = discoveryTickCount % topics.length;
  return [
    topics[idx],
    topics[(idx + Math.floor(topics.length / 2)) % topics.length],
  ];
}

// ── Discovery query generators for Tavily / Social ──────────────────────────

function getTavilyDiscoveryQueries(requestedCategory: string): string[] {
  const topics = DISCOVERY_TOPICS[requestedCategory];
  if (topics && topics.length > 0) {
    const idx = discoveryTickCount % topics.length;
    return [topics[idx]];
  }
  // Auto mode: rotate across all categories
  const allCategories = Object.keys(DISCOVERY_TOPICS);
  const catIdx = discoveryTickCount % allCategories.length;
  const cat = allCategories[catIdx];
  const catTopics = DISCOVERY_TOPICS[cat];
  const topicIdx = Math.floor(discoveryTickCount / allCategories.length) % catTopics.length;
  return [catTopics[topicIdx]];
}

function getSocialDiscoveryQueries(requestedCategory: string): string[] {
  const topics = DISCOVERY_TOPICS[requestedCategory];
  if (topics && topics.length > 0) {
    // Pick a different offset than Tavily for variety
    const idx = (discoveryTickCount + 3) % topics.length;
    return [topics[idx]];
  }
  const allCategories = Object.keys(DISCOVERY_TOPICS);
  const catIdx = (discoveryTickCount + 1) % allCategories.length;
  const cat = allCategories[catIdx];
  const catTopics = DISCOVERY_TOPICS[cat];
  const topicIdx = Math.floor(discoveryTickCount / allCategories.length) % catTopics.length;
  return [catTopics[topicIdx]];
}

function getNewsDiscoveryQuery(requestedCategory: string): string {
  const topics = DISCOVERY_TOPICS[requestedCategory];
  if (topics && topics.length > 0) {
    return topics[(discoveryTickCount + 1) % topics.length];
  }
  return "breaking news prediction trending";
}

// ── Main discovery function ─────────────────────────────────────────────────

/**
 * Discover suggested markets from all enabled data sources.
 * Respects per-source toggles and tick cadence.
 * Uses LLM question generation when available, falls back to mechanical.
 */
export async function discoverMarkets(
  category?: string,
  limit = 8
): Promise<SuggestedMarket[]> {
  if (!config.discoveryEnabled) return [];
  if (!checkDailyLimit()) return [];

  const suggestions: SuggestedMarket[] = [];
  const seen = new Set<string>();
  const requestedCategory = (category ?? "").trim().toLowerCase();

  const pushSuggestion = (suggestion: SuggestedMarket) => {
    const question = normalizeQuestion(suggestion.question);
    if (!question || !isValidMarketQuestion(question)) return;
    const key = questionFingerprint(question);
    if (seen.has(key)) return;
    if (
      requestedCategory &&
      requestedCategory !== "all" &&
      suggestion.category !== requestedCategory
    ) {
      return;
    }
    seen.add(key);
    suggestions.push({
      ...suggestion,
      question,
    });
  };

  // Collect headlines for LLM question generation
  const headlinesByCategory: Record<string, string[]> = {};
  const collectHeadline = (title: string, cat: MarketCategory) => {
    if (!headlinesByCategory[cat]) headlinesByCategory[cat] = [];
    headlinesByCategory[cat].push(title);
  };

  // ── Polymarket events API (tag-based discovery) ─────────────────────────
  if (config.discoveryPolymarketEnabled) {
    const tagSlugs = requestedCategory
      ? getPolymarketTagsForCategory(requestedCategory)
      : [
          // Rotate across categories in auto mode
          ...getPolymarketTagsForCategory(
            Object.keys(POLYMARKET_TAG_MAP)[discoveryTickCount % Object.keys(POLYMARKET_TAG_MAP).length]
          ).slice(0, 2),
        ];

    // Fetch events by tag + trending + keyword search in parallel
    const polyPromises: Promise<any>[] = [
      ...tagSlugs.slice(0, 2).map((tag) => fetchPolymarketEvents(tag, 8)),
      fetchPolymarketTrending(6),
      ...getPolymarketKeywordQueries(requestedCategory || "politics").map((q) =>
        fetchPolymarketData(q)
      ),
    ];

    const polyResults = await Promise.allSettled(polyPromises);
    for (const settled of polyResults) {
      if (settled.status !== "fulfilled") continue;
      const poly = settled.value;
      for (const item of poly.data) {
        const question = normalizeQuestion(String(item.label));
        const cat = categorizeMarket(question);
        const resolutionDays = estimateResolutionDays(question, cat);
        collectHeadline(String(item.label), cat);
        pushSuggestion({
          question,
          category: cat,
          suggestedResolutionDays: resolutionDays,
          sourceUrl: item.url,
          estimatedProbability: item.confidence,
          reasoning: poly.summary,
        });
      }
    }
  }

  // ── Crypto price-based suggestions ──────────────────────────────────────
  if (config.discoveryCryptoEnabled && (!category || category === "crypto")) {
    try {
      const prices = await fetchCryptoPrices("BTC ETH STRK SOL");
      for (const point of prices.data) {
        if (!String(point.label).toLowerCase().includes("price")) continue;
        const price = extractUsdPrice(String(point.value));
        if (!price) continue;
        const token = String(point.label).replace(/\s+Price/i, "").trim();
        const target = Math.round(price * 1.2);
        const question = normalizeQuestion(
          `Will ${token} be above $${target.toLocaleString()} in 60 days`
        );
        pushSuggestion({
          question,
          category: "crypto",
          suggestedResolutionDays: 60,
          reasoning: `Derived from live ${token} price data ($${price.toLocaleString()}).`,
        });
        collectHeadline(`${token} trading at $${price.toLocaleString()}`, "crypto");
      }
    } catch {
      // Ignore if price data unavailable
    }
  }

  // ── News-driven suggestions ─────────────────────────────────────────────
  if (
    config.discoveryNewsEnabled &&
    shouldRunSource(config.discoveryNewsEveryTicks)
  ) {
    try {
      const newsQuery = getNewsDiscoveryQuery(requestedCategory);
      const news = await fetchNewsData(newsQuery);
      for (const item of news.data) {
        const title = String(item.label || item.value || "").trim();
        if (!title) continue;
        const cat = categorizeMarket(title);
        collectHeadline(title, cat);
        const question = headlineToQuestion(title);
        if (!question) continue;
        pushSuggestion({
          question,
          category: cat,
          suggestedResolutionDays: estimateResolutionDays(question, cat),
          sourceUrl: item.url,
          reasoning: news.summary,
        });
      }
    } catch {
      // Ignore if news unavailable
    }
  }

  // ── Tavily web search suggestions ───────────────────────────────────────
  if (
    config.discoveryTavilyEnabled &&
    shouldRunSource(config.discoveryTavilyEveryTicks)
  ) {
    const tavilyQueries = getTavilyDiscoveryQueries(requestedCategory);
    const tavilyResults = await Promise.allSettled(
      tavilyQueries.map((q) => fetchTavilySearch(q))
    );
    for (const settled of tavilyResults) {
      if (settled.status !== "fulfilled") continue;
      const tavily = settled.value;
      for (const item of tavily.data) {
        const title = String(item.label || item.value || "").trim();
        if (!title || title.length < 10) continue;
        const cat = categorizeMarket(title);
        collectHeadline(title, cat);
        const question = headlineToQuestion(title);
        if (!question) continue;
        pushSuggestion({
          question,
          category: cat,
          suggestedResolutionDays: estimateResolutionDays(question, cat),
          sourceUrl: item.url,
          reasoning: tavily.summary,
        });
      }
    }
  }

  // ── X/Social trending suggestions ───────────────────────────────────────
  if (
    config.discoverySocialEnabled &&
    shouldRunSource(config.discoverySocialEveryTicks)
  ) {
    const socialQueries = getSocialDiscoveryQueries(requestedCategory);
    const socialResults = await Promise.allSettled(
      socialQueries.map((q) => fetchXTrends(q))
    );
    for (const settled of socialResults) {
      if (settled.status !== "fulfilled") continue;
      const social = settled.value;
      for (const item of social.data) {
        const title = String(item.value || item.label || "").trim();
        if (!title || title.length < 15) continue;
        collectHeadline(title, categorizeMarket(title));
      }
    }
  }

  // ── Sports suggestions from ESPN ────────────────────────────────────────
  if (
    config.discoverySportsEnabled &&
    shouldRunSource(config.discoverySportsEveryTicks) &&
    (!category || category === "sports")
  ) {
    const espnQueries = [
      "NFL live games",
      "NBA live games",
      "MLB live games",
      "NHL live games",
      "MLS live games",
      "Premier League live games",
      "La Liga live games",
      "Serie A live games",
      "Bundesliga live games",
      "Champions League live games",
      "Liga MX live games",
      "college football live games",
      "college basketball live games",
      "UFC fight night results",
      "tennis ATP WTA live results",
      "Formula 1 race results",
      "golf PGA tournament results",
      "cricket live matches results",
      "rugby live matches results",
    ];
    const espnIdx = discoveryTickCount % espnQueries.length;
    try {
      const espn = await fetchEspnScores(espnQueries[espnIdx]);
      const question = buildSportsQuestionFromEspn(espn);
      if (question) {
        pushSuggestion({
          question,
          category: "sports",
          suggestedResolutionDays: estimateResolutionDays(question, "sports"),
          reasoning: espn.summary,
        });
      }
    } catch {
      // Ignore ESPN failures.
    }
  }

  // ── RSS-driven suggestions ──────────────────────────────────────────────
  if (!category || category === "other" || category === "world") {
    try {
      const rss = await fetchRssFeeds(category ?? "rss");
      for (const item of rss.data) {
        const title = String(item.value || item.label || "").trim();
        if (!title) continue;
        const cat = categorizeMarket(title);
        collectHeadline(title, cat);
        const question = headlineToQuestion(title);
        if (!question) continue;
        pushSuggestion({
          question,
          category: cat,
          suggestedResolutionDays: estimateResolutionDays(question, cat),
          sourceUrl: item.url,
          reasoning: rss.summary,
        });
      }
    } catch {
      // Ignore if RSS unavailable
    }
  }

  // ── LLM-powered question generation from collected headlines ────────────
  if (config.discoveryLlmQuestionGen && Object.keys(headlinesByCategory).length > 0) {
    const llmCategories = Object.entries(headlinesByCategory)
      .filter(([, headlines]) => headlines.length >= 2)
      .sort(([, a], [, b]) => b.length - a.length) // prioritize categories with most data
      .slice(0, 4); // limit to 4 LLM calls per discovery cycle

    const llmResults = await Promise.allSettled(
      llmCategories.map(async ([cat, headlines]) => {
        const question = await llmGenerateQuestion(headlines, cat as MarketCategory);
        if (!question) return null;
        const finalCat = categorizeMarket(question);
        return {
          question,
          category: finalCat,
          suggestedResolutionDays: estimateResolutionDays(question, finalCat),
          reasoning: `LLM-generated from ${headlines.length} ${cat} headlines.`,
        } as SuggestedMarket;
      })
    );

    for (const settled of llmResults) {
      if (settled.status !== "fulfilled" || !settled.value) continue;
      pushSuggestion(settled.value);
    }
  }

  // ── Scoring & diversity balancing ─────────────────────────────────────────

  const scored = suggestions
    .map((suggestion) => {
      const resolutionTime =
        Math.floor(Date.now() / 1000) +
        Math.max(1, suggestion.suggestedResolutionDays) * 86_400;
      let score = estimateEngagementScore(suggestion.question, resolutionTime);
      if (!requestedCategory && suggestion.category === "crypto") {
        score -= 0.08;
      }
      // Boost LLM-generated questions (better phrasing)
      if (suggestion.reasoning?.startsWith("LLM-generated")) {
        score += 0.06;
      }
      // Boost questions with resolution time bounds
      if (/\b(by|before|within|in \d+)\b/i.test(suggestion.question)) {
        score += 0.04;
      }
      return { suggestion, score };
    })
    .sort((a, b) => b.score - a.score);

  // Preserve topic diversity with non-crypto floor when category is auto.
  if (!requestedCategory) {
    const selected: SuggestedMarket[] = [];
    const selectedKeys = new Set<string>();

    const allCats = [
      "politics", "elections", "geopolitics", "sports", "tech",
      "finance", "earnings", "economy", "climate", "culture",
      "world", "crypto", "other",
    ] as const;

    const byCategory: Record<string, SuggestedMarket[]> = {};
    for (const cat of allCats) byCategory[cat] = [];
    for (const entry of scored) {
      const cat = entry.suggestion.category === "all" ? "other" : entry.suggestion.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(entry.suggestion);
    }

    const take = (candidate?: SuggestedMarket): boolean => {
      if (!candidate) return false;
      const key = questionFingerprint(candidate.question);
      if (!key || selectedKeys.has(key)) return false;
      selected.push(candidate);
      selectedKeys.add(key);
      return true;
    };

    const nonCryptoCategories = allCats.filter((c) => c !== "crypto");
    const availableNonCrypto = nonCryptoCategories.reduce(
      (sum, cat) => sum + (byCategory[cat]?.length ?? 0),
      0
    );
    const nonCryptoFloor = Math.min(
      availableNonCrypto,
      Math.max(0, Math.ceil(limit * 0.7))
    );

    // Round-robin non-crypto categories
    while (selected.length < nonCryptoFloor) {
      let added = false;
      for (const cat of nonCryptoCategories) {
        const candidate = byCategory[cat]?.shift();
        if (take(candidate)) {
          added = true;
          if (selected.length >= nonCryptoFloor) break;
        }
      }
      if (!added) break;
    }

    // Fill remaining with highest-scored regardless of category
    const remaining = scored.map((entry) => entry.suggestion);
    for (const candidate of remaining) {
      if (selected.length >= limit) break;
      take(candidate);
    }

    return selected.slice(0, limit);
  }

  return scored.map((entry) => entry.suggestion).slice(0, limit);
}

/**
 * Get all available categories.
 */
export function getCategories(): string[] {
  return [
    "crypto", "politics", "elections", "geopolitics", "sports",
    "tech", "finance", "earnings", "economy", "climate",
    "culture", "world", "other",
  ];
}
