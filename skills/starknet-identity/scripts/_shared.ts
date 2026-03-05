import { Account, Contract, RpcProvider, hash } from 'starknet';

type ReceiptEvent = {
  from_address?: string;
  keys?: string[];
};

export function requiredEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  throw new Error(`Missing environment variable. Set one of: ${keys.join(', ')}`);
}

export function getProvider(): RpcProvider {
  const rpcUrl = requiredEnv('STARKNET_RPC_URL');
  return new RpcProvider({ nodeUrl: rpcUrl });
}

export function getAccount(provider: RpcProvider): Account {
  const address = requiredEnv('AGENT_ADDRESS', 'STARKNET_ACCOUNT_ADDRESS');
  const privateKey = requiredEnv('AGENT_PRIVATE_KEY', 'STARKNET_PRIVATE_KEY');
  const AccountCtor = Account as unknown as {
    new (...args: unknown[]): Account;
  };
  try {
    return new AccountCtor({
      provider,
      address,
      signer: privateKey,
      transactionVersion: '0x3',
    });
  } catch {
    return new AccountCtor(provider, address, privateKey);
  }
}

export function getContract(
  abi: unknown,
  address: string,
  providerOrAccount: unknown
): Contract {
  const ContractCtor = Contract as unknown as {
    new (...args: unknown[]): Contract;
  };
  try {
    return new ContractCtor({
      abi,
      address,
      providerOrAccount,
    });
  } catch {
    return new ContractCtor(abi, address, providerOrAccount);
  }
}

export function parseAgentId(value: string): bigint {
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    throw new Error(`Invalid agent ID "${value}". Use decimal or hex (0x...).`);
  }
  return BigInt(value);
}

export function shortAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2 + 2) {
    return address;
  }
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
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
      'high' in value
    ) {
      const casted = value as { low: string | number | bigint; high: string | number | bigint };
      return BigInt(casted.low) + (BigInt(casted.high) << 128n);
    }
  } catch {
    return 0n;
  }
  return 0n;
}

export function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('NOT_AGENT_OWNER') || message.includes('not owner')) {
    return 'Caller is not authorized for this agent ID.';
  }
  if (message.includes('Agent not found') || message.includes('AGENT_NOT_FOUND')) {
    return 'Agent not found. Verify the agent ID and registry address.';
  }
  if (message.includes('Invalid signature') || message.includes('INVALID_SIGNATURE')) {
    return 'Invalid signature for this operation.';
  }
  if (message.includes('INSUFFICIENT_BALANCE') || message.includes('insufficient balance')) {
    return 'Insufficient balance to pay fees.';
  }
  return message;
}

export function parseRegisteredAgentIdFromReceipt(
  receipt: unknown,
  identityRegistryAddress: string
): string | null {
  const events = (receipt as { events?: ReceiptEvent[] })?.events;
  if (!events || events.length === 0) {
    return null;
  }

  const identity = identityRegistryAddress.toLowerCase();
  const selector = hash.getSelectorFromName('Registered').toLowerCase();

  for (const event of events) {
    const from = event.from_address?.toLowerCase();
    const keys = event.keys;
    if (from !== identity || !keys || keys.length < 3 || keys[0]?.toLowerCase() !== selector) {
      continue;
    }
    try {
      const low = BigInt(keys[1]!);
      const high = BigInt(keys[2]!);
      return (low + (high << 128n)).toString();
    } catch {
      continue;
    }
  }

  return null;
}

export function txHashOf(result: unknown): string {
  const tx = result as { transaction_hash?: string; transactionHash?: string };
  return tx.transaction_hash ?? tx.transactionHash ?? 'UNKNOWN';
}
