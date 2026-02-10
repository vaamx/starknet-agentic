import {
  ec,
  CallData,
  byteArray,
  PaymasterRpc,
  encode,
  type RpcProvider,
  type Account,
} from "starknet";
import type { StarknetNetworkConfig } from "../config.js";

export interface DeployAccountResult {
  accountAddress: string;
  agentId: string;
  publicKey: string;
  privateKey: string;
  deployTxHash: string;
}

export async function deployAccount(args: {
  provider: RpcProvider;
  deployerAccount: Account;
  networkConfig: StarknetNetworkConfig;
  network: string;
  tokenUri: string;
  gasfree?: boolean;
  paymasterUrl?: string;
  paymasterApiKey?: string;
  salt?: string;
}): Promise<DeployAccountResult> {
  const { provider, deployerAccount, networkConfig, network, tokenUri, gasfree = false } = args;

  const privateKeyBytes = ec.starkCurve.utils.randomPrivateKey();
  const privateKey = "0x" + encode.buf2hex(privateKeyBytes);
  const publicKey = ec.starkCurve.getStarkKey(privateKeyBytes);
  const salt = args.salt || "0x" + encode.buf2hex(ec.starkCurve.utils.randomPrivateKey());

  const calldata = CallData.compile({
    public_key: publicKey,
    salt,
    token_uri: byteArray.byteArrayFromString(tokenUri),
  });

  const deployCall = {
    contractAddress: networkConfig.factory,
    entrypoint: "deploy_account",
    calldata,
  };

  let tx: { transaction_hash: string };
  if (!gasfree) {
    tx = await deployerAccount.execute(deployCall);
  } else {
    if (!args.paymasterApiKey) {
      throw new Error("Gasfree mode requires AVNU_PAYMASTER_API_KEY.");
    }

    const paymasterUrl =
      args.paymasterUrl ||
      (network === "sepolia"
        ? "https://sepolia.paymaster.avnu.fi"
        : "https://starknet.paymaster.avnu.fi");

    const paymaster = new PaymasterRpc({
      nodeUrl: paymasterUrl,
      headers: {
        "x-paymaster-api-key": args.paymasterApiKey,
      },
    });

    tx = await deployerAccount.execute([deployCall], {
      paymaster: {
        provider: paymaster,
        params: {
          version: "0x1",
          feeMode: { mode: "sponsored" },
        },
      },
    } as never);
  }

  const receipt = await provider.waitForTransaction(tx.transaction_hash);
  const events = (receipt as { events?: Array<{ from_address?: string; data?: string[] }> }).events;

  let accountAddress = "";
  let agentId = "";

  if (events) {
    for (const event of events) {
      if (
        event.from_address?.toLowerCase() === networkConfig.factory.toLowerCase() &&
        event.data &&
        event.data.length >= 4
      ) {
        accountAddress = event.data[0];
        const low = BigInt(event.data[2]);
        const high = BigInt(event.data[3]);
        agentId = (low + (high << 128n)).toString();
        break;
      }
    }
  }

  if (!accountAddress || !agentId) {
    throw new Error("Failed to parse AccountDeployed event from factory tx receipt.");
  }

  return {
    accountAddress,
    agentId,
    publicKey,
    privateKey,
    deployTxHash: tx.transaction_hash,
  };
}
