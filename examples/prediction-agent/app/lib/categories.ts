/**
 * Market categorization — 13 topic categories matching UI tabs.
 *
 * Category precedence (highest → lowest):
 *   sports > elections > geopolitics > politics > earnings > finance > economy
 *   > climate > tech > culture > crypto > world > other
 */

export type MarketCategory =
  | "all"
  | "sports"
  | "crypto"
  | "politics"
  | "tech"
  | "finance"
  | "geopolitics"
  | "earnings"
  | "culture"
  | "world"
  | "economy"
  | "climate"
  | "elections"
  | "other";

/** The 5 legacy "base" categories used by agent-loop bucket counts. */
export type BaseCategory = "sports" | "crypto" | "politics" | "tech" | "other";

/** Map any MarketCategory to one of the 5 base buckets for backward-compat. */
export function toBaseCategory(category: MarketCategory): BaseCategory {
  switch (category) {
    case "sports": return "sports";
    case "crypto":
    case "finance":
    case "earnings": return "crypto";
    case "politics":
    case "geopolitics":
    case "elections":
    case "economy": return "politics";
    case "tech": return "tech";
    case "culture":
    case "world":
    case "climate":
    case "other":
    case "all":
    default: return "other";
  }
}

// ── Regex patterns ──────────────────────────────────────────────────────────

const SPORTS_REGEX =
  /super bowl|nfl|seahawks|patriots|chiefs|eagles|49ers|ravens|bills|cowboys|packers|dolphins|lions|bengals|steelers|broncos|jets|giants|raiders|chargers|rams|bears|saints|cardinals|falcons|panthers|buccaneers|colts|texans|jaguars|titans|commanders|vikings|browns|touchdown|quarterback|mvp|halftime|spread|overtime|rush(ing)?|first score|defensive|total score|SB LX|nba|lakers|celtics|warriors|bucks|nuggets|76ers|heat|knicks|nets|suns|clippers|mavericks|grizzlies|cavaliers|timberwolves|thunder|kings|pelicans|hawks|bulls|raptors|pacers|magic|rockets|spurs|blazers|pistons|hornets|wizards|jazz|mlb|yankees|dodgers|astros|braves|phillies|orioles|rangers|padres|mariners|twins|guardians|rays|red sox|cubs|mets|cardinals|brewers|diamondbacks|marlins|reds|pirates|rockies|royals|tigers|angels|athletics|white sox|nationals|world cup|champions league|boxing|ufc|mma|bellator|pfl|tennis|wimbledon|us open|australian open|french open|roland garros|formula 1|f1 grand prix|monaco gp|silverstone|monza|spa|suzuka|singapore gp|olympics|paralympics|ncaa|march madness|college football playoff|cfp|premier league|arsenal|manchester city|man city|manchester united|man utd|liverpool|chelsea|tottenham|spurs|newcastle|aston villa|brighton|west ham|crystal palace|brentford|wolves|bournemouth|nottingham forest|everton|fulham|burnley|luton|sheffield|la liga|real madrid|barcelona|atletico madrid|real sociedad|athletic bilbao|villarreal|betis|sevilla|valencia|girona|celta vigo|rayo vallecano|getafe|osasuna|mallorca|alaves|cadiz|almeria|granada|las palmas|serie a|inter milan|ac milan|juventus|napoli|roma|lazio|atalanta|fiorentina|bologna|torino|monza|genoa|cagliari|empoli|verona|udinese|sassuolo|lecce|frosinone|salernitana|bundesliga|bayern munich|borussia dortmund|bayer leverkusen|rb leipzig|union berlin|freiburg|eintracht frankfurt|wolfsburg|hoffenheim|werder bremen|stuttgart|augsburg|mainz|monchengladbach|cologne|bochum|heidenheim|darmstadt|ligue 1|psg|paris saint-germain|marseille|monaco|lille|lyon|nice|lens|rennes|strasbourg|toulouse|montpellier|nantes|reims|le havre|brest|lorient|metz|clermont|liga mx|club america|guadalajara|chivas|monterrey|tigres|cruz azul|pumas|santos laguna|toluca|leon|atlas|necaxa|pachuca|puebla|queretaro|mazatlan|tijuana|juarez|san luis|brasileirao|flamengo|palmeiras|atletico mineiro|botafogo|gremio|sao paulo|corinthians|internacional|fluminense|cruzeiro|fortaleza|bahia|bragantino|cuiaba|athletico paranaense|santos|vasco|goias|coritiba|america mineiro|eredivisie|ajax|psv|feyenoord|az alkmaar|twente|scottish premiership|celtic|rangers|primeira liga|porto|benfica|sporting|j-league|k-league|a-league|mls|inter miami|la galaxy|atlanta united|lafc|new york city fc|colombian primera|argentine primera|indian super league|isl|saudi pro league|al hilal|al nassr|al ahli|al ittihad|pga|golf|masters|british open|ryder cup|lpga|cricket|ipl|test match|ashes|t20 world cup|odi|big bash|cpl|rugby|six nations|rugby world cup|super rugby|top 14|cycling|tour de france|giro|vuelta|esports|league of legends|dota|counter-strike|valorant|overwatch|nascar|indycar|daytona|indy 500|horse racing|kentucky derby|preakness|belmont|cheltenham|grand national|swimming|athletics|track and field|world championships|skiing|biathlon|figure skating|handball|volleyball|water polo|table tennis|badminton|surfing|skateboarding|climbing|predators|kraken|sharks|ducks|coyotes|wild|avalanche|bruins|canadiens|oilers|flames|canucks|senators|blue jackets|red wings|panthers|islanders|devils|flyers|penguins|capitals|hurricanes|lightning|maple leafs|sabres|blackhawks|blues|stars|jets|golden knights|seattle kraken|BNP Paribas|indian wells|atp|wta|win on 20\d{2}|FC /i;

const ELECTIONS_REGEX =
  /\belection\b|primary|caucus|electoral college|swing state|ballot|polling|presidential race|presidential nominee|midterm|runoff|recount|voter turnout|popular vote|delegate|gubernatorial|senate race|house race|DNC|RNC|convention|nominee 20\d{2}/i;

const GEOPOLITICS_REGEX =
  /\bceasefire\b|sanction|nato|invasion|territorial|annexation|sovereignty|un security council|G7|G20|nuclear.*deal|arms.*treaty|missile|drone strike|border conflict|diplomatic|embassy|peace talks|alliance|bloc|proxy war|ukraine.*russia|israel.*gaza|taiwan.*china|south china sea|iran.*nuclear|north korea|regime|coup|civil war|\biran\b|strait of hormuz|khamenei|pahlavi|israel.*strike|strike.*iran|invade.*iran|enter.*iran|saudi.*strike|ben gurion/i;

const POLITICS_REGEX =
  /president|congress|senate|vote|policy|regulation|government|fed\b|tariff|legislation|supreme court|parliament|white house|prime minister|impeachment|cabinet|campaign|trump|biden|executive order|attorney general|veto|filibuster|oversight|subpoena|indictment|special counsel|political|bipartisan/i;

const EARNINGS_REGEX =
  /\bearnings\b|quarterly results|revenue beat|EPS|profit margin|guidance|forecast.*quarter|financial results|annual report|10-K|10-Q|beat expectations|miss expectations|revenue growth|net income|operating income|same-store sales|comparable sales|EBITDA/i;

const FINANCE_REGEX =
  /\bIPO\b|stock.*split|market cap|S&P 500|nasdaq|dow jones|treasury yield|bond.*rate|interest rate|rate.*cut|rate.*hike|federal reserve|ECB|bank of japan|credit.*rating|default.*bond|merger|acquisition|buyout|hedge fund|short squeeze|options|derivatives|forex|commodity|oil price|gold price|silver|copper|wheat|natural gas|crude oil|\bCL\b.*hit|acquired before|\bBP\b.*acqui/i;

const ECONOMY_REGEX =
  /\bCPI\b|inflation|GDP|recession|unemployment|jobs report|nonfarm payroll|consumer spending|retail sales|housing starts|trade deficit|trade surplus|debt ceiling|fiscal|stimulus|supply chain|manufacturing PMI|services PMI|wage growth|cost of living|economic growth|central bank/i;

const CLIMATE_REGEX =
  /climate change|global warming|carbon|emissions|renewable energy|solar|wind.*energy|EV mandate|electric vehicle|green.*deal|paris agreement|wildfire|hurricane|drought|sea level|glacier|deforestation|biodiversity|endangered species|space.*launch|nasa|spacex.*mission|mars|asteroid|james webb|crispr|gene.*therapy|quantum.*computing|fusion.*energy|nuclear.*reactor|vaccine|pandemic|WHO/i;

const CRYPTO_REGEX =
  /bitcoin|btc|ethereum|eth|starknet|strk|solana|sol|crypto|token|defi|nft|blockchain|tps|gas fee|layer\s?2|zk|rollup|airdrop|memecoin|stablecoin|bridge|wallet|DEX|AMM|liquidity pool|staking|yield|TVL|halving|microstrategy|saylor|coinbase|binance/i;

const TECH_REGEX =
  /\bai\b|artificial intelligence|gpt|llm|openai|google|apple|microsoft|semiconductor|chip|quantum|robot|self.?driving|tesla|spacex|launch|nvidia|meta|anthropic|tiktok|youtube|xai|datacenter|robotaxi|autonomous|machine learning|transformer|foundation model|AGI|regulation.*ai|AI.*safety|AI.*act/i;

const CULTURE_REGEX =
  /movie|film|box office|oscars|grammy|emmy|golden globe|bafta|cannes|sundance|venice film|berlin film|tony award|streaming|netflix|disney\+|hbo max|amazon prime|hulu|peacock|paramount\+|apple tv|spotify|album|concert|tour|celebrity|influencer|viral|meme|social media|tiktok.*trend|youtube.*trend|twitch|podcast|bestseller|broadway|west end|festival|coachella|lollapalooza|glastonbury|sxsw|burning man|fashion|met gala|fashion week|paris fashion|milan fashion|art exhibit|museum|auction.*sotheby|auction.*christie|cultural|k-pop|bts|blackpink|anime|manga|comic con|gaming|playstation|xbox|nintendo|steam|epic games|roblox|minecraft|fortnite|gta|call of duty|zelda|mario|final fantasy|elden ring|baldur|starfield|hogwarts|spider-man|marvel|dc|star wars|barbie|oppenheimer|avatar|pixar|bollywood|telenovela|reggaeton|latin grammy|billboard|mtv|vma|bet awards|american music|country music|rap|hip hop|pop music|rock|edm|dj|taylor swift|drake|beyonce|bad bunny|shakira|karol g|travis scott|kanye|kendrick|adele|ed sheeran|harry styles|olivia rodrigo|dua lipa|the weeknd|ariana grande|billie eilish|bts|stray kids|seventeen|twice|newjeans|ateez|aespa|le sserafim|itzy|nct|exo|txt|enhypen|ive|gidle|academy awards|best picture|best actor|best actress|best director|mrbeast|views on day|tweets from/i;

const WORLD_REGEX =
  /\bunited nations\b|global|international|humanitarian|refugee|migration|earthquake|tsunami|volcanic|flood|pandemic.*global|WHO.*declare|world health|famine|water crisis|population|birth rate|life expectancy|poverty|inequality|development|foreign aid|measles|aliens exist|confirm.*aliens|outbreak|epidemic/i;

const CONTROVERSY_REGEX =
  /will|ban|lawsuit|investigation|impeach|ceasefire|war|rate cut|recession|approval|protest|wins?|loses?|default|hack|exploit|crash|surge/i;

const HIGH_PROFILE_REGEX =
  /trump|biden|harris|desantis|vance|musk|elon|powell|yellen|putin|zelensky|netanyahu|xi jinping|modi|macron|scholz|sunak|starmer|trudeau|lula|milei|openai|nvidia|bitcoin|ethereum|super bowl|olympics|taylor swift|bezos|zuckerberg|altman|pichai|cook|nadella|tim cook|jensen huang|lisa su|satya nadella|sam altman|mark zuckerberg|jeff bezos|warren buffett|bill gates|jamie dimon|larry fink|cathie wood|michael saylor|changpeng zhao|vitalik|lebron|messi|ronaldo|mbappé|haaland|mahomes|ohtani|curry|giannis|djokovic|sinner|alcaraz|verstappen|hamilton|drake|beyonce|bad bunny|rihanna/i;

// ── Categorization ──────────────────────────────────────────────────────────

export function categorizeMarket(question: string): MarketCategory {
  const normalized = String(question ?? "");

  // High-specificity categories first
  if (SPORTS_REGEX.test(normalized)) return "sports";
  if (ELECTIONS_REGEX.test(normalized)) return "elections";
  if (GEOPOLITICS_REGEX.test(normalized)) return "geopolitics";
  if (EARNINGS_REGEX.test(normalized)) return "earnings";
  if (FINANCE_REGEX.test(normalized)) return "finance";
  if (ECONOMY_REGEX.test(normalized)) return "economy";
  if (CLIMATE_REGEX.test(normalized)) return "climate";

  // Mixed-signal categories — handle overlaps
  const isPolitics = POLITICS_REGEX.test(normalized);
  const isTech = TECH_REGEX.test(normalized);
  const isCrypto = CRYPTO_REGEX.test(normalized);
  const isCulture = CULTURE_REGEX.test(normalized);
  const isWorld = WORLD_REGEX.test(normalized);

  if (isPolitics && !isCrypto) return "politics";
  if (isTech && !isCrypto) return "tech";
  if (isCulture) return "culture";
  if (isCrypto) return "crypto";
  if (isWorld) return "world";
  if (isPolitics) return "politics";
  if (isTech) return "tech";

  return "other";
}

export function getCategoryCounts(
  markets: { question: string; category?: string }[]
): Record<MarketCategory, number> {
  const counts: Record<MarketCategory, number> = {
    all: markets.length,
    sports: 0,
    crypto: 0,
    politics: 0,
    tech: 0,
    finance: 0,
    geopolitics: 0,
    earnings: 0,
    culture: 0,
    world: 0,
    economy: 0,
    climate: 0,
    elections: 0,
    other: 0,
  };
  for (const m of markets) {
    // Use pre-assigned category (e.g. from Polymarket) when available
    const cat = (m.category as MarketCategory) ?? categorizeMarket(m.question);
    const key = cat in counts ? cat : "other";
    counts[key as MarketCategory]++;
  }
  return counts;
}

/**
 * Lightweight "engagement potential" estimate used for feed sorting and
 * autonomous market focus. Higher means more likely to draw attention/disagreement.
 */
export function estimateEngagementScore(
  question: string,
  resolutionTime?: number
): number {
  const normalized = question.toLowerCase();
  const category = categorizeMarket(question);

  let score = 0.3;

  // Category engagement weights
  switch (category) {
    case "elections": score += 0.28; break;
    case "geopolitics": score += 0.26; break;
    case "politics": score += 0.25; break;
    case "sports": score += 0.22; break;
    case "earnings": score += 0.2; break;
    case "economy": score += 0.19; break;
    case "finance": score += 0.18; break;
    case "tech": score += 0.16; break;
    case "climate": score += 0.15; break;
    case "culture": score += 0.14; break;
    case "world": score += 0.13; break;
    case "crypto": score += 0.1; break;
    default: score += 0.12; break;
  }

  if (HIGH_PROFILE_REGEX.test(normalized)) score += 0.16;
  if (CONTROVERSY_REGEX.test(normalized)) score += 0.12;

  if (typeof resolutionTime === "number" && Number.isFinite(resolutionTime)) {
    const secsLeft = resolutionTime - Math.floor(Date.now() / 1000);
    const daysLeft = secsLeft / 86_400;
    if (daysLeft > 0 && daysLeft <= 14) score += 0.12;
    if (daysLeft > 14 && daysLeft <= 45) score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}
