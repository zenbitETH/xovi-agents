import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import type { EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { MAX_PER_PAYMENT } from "./spend";

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

/** Base Sepolia's identifier as the wallet reports it, for a caller that wants to
 *  compare rather than switch. */
export const BASE_SEPOLIA_HEX = CHAIN_HEX;

/** The chain the wallet is on, or null when there is no wallet to ask. */
export async function currentChain(): Promise<string | null> {
  try {
    const current = (await injected().request({ method: "eth_chainId" })) as string;
    return current?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * What a wallet does when it changes underneath the page.
 *
 * A page that reads the account once and never listens shows the previous account
 * after the person switches, which on a surface about paying from your own wallet
 * is the worst thing it could be wrong about. Both events are standard EIP-1193
 * and both are ignored by most pages.
 *
 * Returns its own unsubscribe, so a component can listen for as long as it exists
 * and no longer.
 */
export function onWalletChange(handlers: {
  accounts?: (accounts: string[]) => void;
  chain?: (chainId: string) => void;
}): () => void {
  let provider: EIP1193Provider;
  try {
    provider = injected();
  } catch {
    return () => undefined;
  }
  const listenable = provider as unknown as {
    on?: (event: string, cb: (...args: never[]) => void) => void;
    removeListener?: (event: string, cb: (...args: never[]) => void) => void;
  };
  if (typeof listenable.on !== "function") return () => undefined;

  const onAccounts = (...args: never[]) => handlers.accounts?.((args[0] as unknown as string[]) ?? []);
  const onChain = (...args: never[]) => handlers.chain?.(String(args[0] ?? ""));
  listenable.on("accountsChanged", onAccounts);
  listenable.on("chainChanged", onChain);
  return () => {
    listenable.removeListener?.("accountsChanged", onAccounts);
    listenable.removeListener?.("chainChanged", onChain);
  };
}

/**
 * Let go of the wallet, and say which of the two things happened.
 *
 * There is no disconnect in EIP-1193. A page can forget the account, and the
 * wallet goes on considering the site connected, which is why "Disconnect" on most
 * dapps is a lie the size of a button: the next visit reconnects with no prompt.
 * `wallet_revokePermissions` actually withdraws the grant and some wallets
 * implement it. Both outcomes are real and they are different, so the caller is
 * told which one it got rather than being left to assume the stronger one.
 */
export async function disconnect(): Promise<"revoked" | "forgotten"> {
  try {
    await injected().request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }] as never,
    });
    return "revoked";
  } catch {
    return "forgotten";
  }
}

/**
 * The account the wallet already grants, without asking for it.
 *
 * `eth_accounts` reads a permission that has been given; `eth_requestAccounts`
 * asks for one and opens the wallet. A page that only knows the second treats
 * every reload as a first visit, so a person who connected a minute ago is asked
 * again, and the prompt teaches them that the button does nothing they can rely
 * on.
 *
 * Null on anything at all: no wallet, no grant, a provider that throws. None of
 * those is an error worth a message, they are all the same fact, which is that
 * there is nobody connected yet.
 */
export async function restoreConnection(): Promise<`0x${string}` | null> {
  try {
    const accounts = (await injected().request({ method: "eth_accounts" })) as `0x${string}`[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
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
  // No currency sign. The amount is a token quantity, and the dollar sign came in
  // from x402's `maxAmountPerPayment`, which is a fiat denominated spend control
  // and a different thing. USDC is not dollars and the page should not say it is.
  return `${whole}.${frac.padEnd(2, "0")} USDC`;
}

/**
 * Read the live challenge and sign it, without paying anything yet.
 *
 * The price, the recipient and the network are taken from the challenge the server
 * actually sent rather than from anything this page believes, because the value
 * worth showing a person before they sign is the one the server will charge.
 */
export async function signChallenge(
  windowsUrl: string,
  address: `0x${string}`,
  maxPerPayment = MAX_PER_PAYMENT,
  onChallenge?: (challenge: { description: string; amount: string; asset: string; payTo: string; network: string }) => void,
): Promise<SignedPayment> {
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
  // Handed over BEFORE the wallet opens, which is the only moment it is worth
  // anything: after the prompt the person has already decided. These are the
  // counterparty's own words rather than a sentence of this page's, so what a person
  // reads before signing cannot drift from what the server actually charges for. If
  // the challenge's description changes, this changes with it and nothing here is
  // edited.
  onChallenge?.({
    // `resource.description`, not `accepted.description`. The x402 version 2
    // requirements entry has no description field: measured against the live
    // challenge, `accepts[0]` carries amount, asset, extra, maxTimeoutSeconds,
    // network, payTo and scheme and nothing else. Reading it there yielded "" on
    // every run, so the branch that shows it never fired while the price beside it
    // did, which is why the feature looked half alive rather than absent.
    description: String(required.resource?.description ?? ""),
    amount: readableAmount(accepted.amount, token),
    // The token by itself as well as inside the amount, so the card can draw the
    // asset as its own value rather than making a reader parse a sentence for it.
    asset: token,
    payTo: accepted.payTo,
    network: accepted.network,
  });

  const payload = await http.createPaymentPayload(required);
  return {
    headers: http.encodePaymentSignatureHeader(payload) as Record<string, string>,
    amount: readableAmount(accepted.amount, token),
    token,
    payTo: accepted.payTo,
    network: accepted.network,
  };
}
