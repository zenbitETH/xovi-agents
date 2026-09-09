import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import type { EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";

/**
 * Paying from the reader's own wallet, in their browser.
 *
 * Nothing here is a second implementation of the payment. It is the same
 * @x402/core client the agent uses server side, given a different signer, so the
 * wire format, the spend control and the challenge parsing are one implementation
 * with two signers rather than two implementations that must agree.
 *
 * No wagmi and no connector library. viem is already a dependency, an injected
 * provider is an EIP-1193 object, and adding a connector stack to a repository
 * that has none would be a large change for one button.
 */
export class NoWallet extends Error {}
export class WrongChain extends Error {}

/** Base Sepolia, as the wallet wants it: hex, not decimal. */
const CHAIN_HEX = `0x${baseSepolia.id.toString(16)}`;

function injected(): EIP1193Provider {
  const p = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!p) throw new NoWallet("no injected wallet was found in this browser");
  return p;
}

export async function connect(): Promise<`0x${string}`> {
  const provider = injected();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  const address = accounts?.[0];
  if (!address) throw new NoWallet("the wallet returned no account");
  return address;
}

/**
 * Put the wallet on Base Sepolia, because the authorization is signed for a chain.
 *
 * EIP-3009 signing touches no chain and needs no RPC, but the typed data domain
 * names one, and a wallet asked to sign a domain for a chain it is not on refuses
 * rather than signing something misleading. So this is not a formality: without it
 * the signature step fails with a message about the domain, which reads like a bug
 * in the payment rather than a wallet on the wrong network.
 */
export async function ensureBaseSepolia(): Promise<void> {
  const provider = injected();
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === CHAIN_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] as never });
  } catch {
    // 4902 is "unrecognised chain", but wallets disagree about where the code
    // lives on the error, so the add is attempted on any switch failure and its
    // own failure is what gets reported.
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_HEX,
            chainName: baseSepolia.name,
            nativeCurrency: baseSepolia.nativeCurrency,
            rpcUrls: [baseSepolia.rpcUrls.default.http[0]],
            blockExplorerUrls: [baseSepolia.blockExplorers.default.url],
          },
        ] as never,
      });
    } catch {
      throw new WrongChain(`this wallet is not on ${baseSepolia.name} and would not switch`);
    }
  }
}

/**
 * The signer contract, from a browser wallet.
 *
 * ClientEvmSigner is `{ address, signTypedData(message) }`. A viem WalletClient is
 * not one: it has no `address` of its own, and its `signTypedData` takes the
 * account as an argument. Four lines reconcile that, and no cast is needed, which
 * was checked rather than assumed.
 *
 * The optional `readContract` is not provided and is not missing. It is required
 * only for allowance enrichment on tokens that need it; Base Sepolia USDC is
 * EIP-3009, so signing needs no chain read, no public client and no RPC URL.
 */
export function walletSigner(address: `0x${string}`) {
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom(injected()) });
  return {
    address,
    signTypedData: (m: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => wallet.signTypedData({ account: address, ...m }),
  };
}

export type SignedPayment = {
  headers: Record<string, string>;
  /** What the server will charge, as it stated it. */
  amount: string;
  token: string;
  payTo: string;
  network: string;
  /** The resource the challenge names. The signature is bound to it, so the run
   *  route must present this payment for the same URL or verification fails. */
  resource: string;
};

/**
 * The charge, in something a person can read before they sign it.
 *
 * The challenge states `amount` in atomic units, "10000", and carries the token
 * name in `extra` but no decimals. Six is applied only when the token says it is
 * USDC, which is the only asset this route is configured for; anything else is
 * shown in the units the server actually sent rather than scaled by a guess.
 */
function readableAmount(amount: string, token: string): string {
  if (token !== "USDC") return `${amount} (atomic units of ${token})`;
  const atomic = BigInt(amount);
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `$${whole}.${frac.padEnd(2, "0")} USDC`;
}

/**
 * Read the live challenge and sign it, without paying anything yet.
 *
 * The price, the recipient and the network are taken from the challenge the server
 * actually sent rather than from anything this page believes, because the value
 * worth showing a person before they sign is the one the server will charge.
 */
export async function signChallenge(windowsUrl: string, address: `0x${string}`, maxPerPayment = "$0.05"): Promise<SignedPayment> {
  const core = new x402Client();
  registerExactEvmScheme(core, { signer: walletSigner(address) });
  // A client that signs whatever it is told is one typo away from paying it.
  core.setSpendControls({ maxAmountPerPayment: maxPerPayment });
  const http = new x402HTTPClient(core);

  const challenge = await fetch(windowsUrl, { headers: { accept: "application/json" } });
  if (challenge.status !== 402) {
    throw new Error(`expected a 402 challenge and got ${challenge.status}`);
  }
  const body = await challenge.json().catch(() => ({}));
  const required = http.getPaymentRequiredResponse(name => challenge.headers.get(name), body);
  const accepted = required.accepts[0];
  if (!accepted) throw new Error("the challenge names no payment option");
  const token = String((accepted.extra as { name?: unknown } | undefined)?.name ?? "an unnamed token");
  const payload = await http.createPaymentPayload(required);
  return {
    headers: http.encodePaymentSignatureHeader(payload) as Record<string, string>,
    amount: readableAmount(accepted.amount, token),
    token,
    payTo: accepted.payTo,
    network: accepted.network,
    resource: String(required.resource ?? windowsUrl),
  };
}
