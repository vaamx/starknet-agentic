import { fetchTokenByAddress, fetchVerifiedTokenBySymbol } from '@avnu/avnu-sdk';

export type TokenInfo = {
  address: string;
  symbol: string;
  decimals: number;
};

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    symbol: 'ETH',
    decimals: 18,
  },
  STRK: {
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    symbol: 'STRK',
    decimals: 18,
  },
  USDC: {
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    symbol: 'USDC',
    decimals: 6,
  },
  USDT: {
    address: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
    symbol: 'USDT',
    decimals: 6,
  },
};

const KNOWN_TOKENS_BY_ADDRESS = new Map<string, TokenInfo>(
  Object.values(KNOWN_TOKENS).map((token) => [normalizeAddress(token.address), token])
);

export function normalizeAddress(value: string): string {
  try {
    return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  } catch {
    return value.toLowerCase();
  }
}

export async function resolveToken(input?: string): Promise<TokenInfo> {
  if (!input || input.trim().length === 0) {
    return KNOWN_TOKENS.ETH;
  }

  const trimmed = input.trim();
  if (trimmed.startsWith('0x')) {
    const normalized = normalizeAddress(trimmed);
    const known = KNOWN_TOKENS_BY_ADDRESS.get(normalized);
    if (known) {
      return known;
    }
    const token = await fetchTokenByAddress(trimmed);
    return {
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
    };
  }

  const symbol = trimmed.toUpperCase();
  const known = KNOWN_TOKENS[symbol];
  if (known) {
    return known;
  }

  const token = await fetchVerifiedTokenBySymbol(symbol);
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
  };
}

export function parseDecimalToBigInt(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount "${value}". Use a non-negative number like "0.1" or "25".`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const adjustedFraction = fraction.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(whole + adjustedFraction);
}

export function formatAmount(amount: bigint, decimals: number, precision = 6): string {
  if (decimals === 0) {
    return amount.toString();
  }
  const amountStr = amount.toString().padStart(decimals + 1, '0');
  const whole = amountStr.slice(0, -decimals) || '0';
  const fraction = amountStr.slice(-decimals).slice(0, Math.max(0, precision)).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatRoutes(
  routes: Array<{ name: string; percent: number }> | undefined
): string {
  if (!routes || routes.length === 0) {
    return 'N/A';
  }
  return routes
    .map((route) => `${route.name} (${(route.percent * 100).toFixed(0)}%)`)
    .join(', ');
}

export function toBigIntSafe(value: unknown): bigint {
  try {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string') {
      return BigInt(value);
    }
    if (
      value &&
      typeof value === 'object' &&
      'low' in value &&
      'high' in value &&
      typeof (value as { low: unknown }).low !== 'undefined'
    ) {
      const casted = value as { low: string | number | bigint; high: string | number | bigint };
      const low = BigInt(casted.low);
      const high = BigInt(casted.high);
      return low + (high << 128n);
    }
  } catch {
    return 0n;
  }
  return 0n;
}

export function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('INSUFFICIENT_BALANCE') || message.includes('insufficient balance')) {
    return 'Insufficient balance for this operation.';
  }
  if (message.includes('INSUFFICIENT_LIQUIDITY') || message.includes('No quotes available')) {
    return 'No liquidity for this pair/size. Try a smaller amount or a different pair.';
  }
  if (message.includes('SLIPPAGE') || message.includes('Insufficient tokens received')) {
    return 'Slippage exceeded. Refresh quote and retry with a wider slippage setting if needed.';
  }
  if (message.includes('QUOTE_EXPIRED') || message.includes('quote expired')) {
    return 'Quote expired. Fetch a fresh quote and retry.';
  }
  return message;
}

export function shortAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2 + 2) {
    return address;
  }
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
