import { spawn } from "node:child_process";
import { startFakeFacilitator } from "../test/facilitator";
import { startFakeIngest } from "../test/ingest";

/**
 * The app on localhost, with both counterparties faked, so clicking spends nothing.
 *
 *   npm run local        then open http://localhost:3001
 *
 * Why this is committed rather than a script someone keeps in a scratch directory:
 * a demo only one machine can reproduce is not a demo. Anyone with a clean
 * checkout can serve the whole delegation loop from here, with no funded wallet,
 * no testnet USDC, no facilitator account and no ingest credential.
 *
 * What is faked and what is real. The signature is real: the wallet signs a real
 * EIP-3009 authorization over the real challenge this server issues. The
 * facilitator is the one from the checks, which verifies and settles by agreeing,
 * so no USDC moves and no chain is touched; the transaction hash it reports is a
 * constant and will not resolve on an explorer. The ingest route is faked the
 * same way, so a proposal is received and answered without reaching Xovi, and
 * without deduplicating, which real Xovi does.
 *
 * It BUILDS before it serves, and that is deliberate rather than slow. `next dev`
 * does not minify, and this project has already shipped a stylesheet that looked
 * perfect in dev and was broken in every production deployment for weeks, because
 * the minifier collapsed a hand written prefix pair. A local review that runs a
 * different pipeline from the deployed one can only tell you about the pipeline
 * it ran.
 *
 * Nothing here is reachable from a production build: no file under app/ or lib/
 * imports this or the fakes it uses, and the payment configuration below is
 * passed to a child process rather than written anywhere.
 */
const PORT = Number(process.env.PORT ?? 3001);

/** A recipient that is not the payer, so a settlement is a payment and not a loop. */
const PAY_TO = "0x000000000000000000000000000000000000dEaD";

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawn(command, args, { env, stdio: "inherit" });
}

async function main() {
  const facilitator = await startFakeFacilitator();
  const ingest = await startFakeIngest();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    X402_PAY_TO: PAY_TO,
    X402_NETWORK: "eip155:84532",
    X402_FACILITATOR_URL: facilitator.url,
    X402_PRICE: "$0.01",
    WINDOWS_SNAPSHOT: "fixtures/windows.synthetic.jsonl",
    XOVI_INGEST_URL: ingest.url,
    // Local only, and it never leaves this process tree. The run reads it server
    // side and it appears in no step and in no page.
    XOVI_INGEST_KEY: "local-only-not-a-credential",
  };

  await new Promise<void>((resolve, reject) => {
    console.log("\n  building, because next dev does not minify and the deployed page does\n");
    const build = run("npx", ["next", "build"], env);
    build.on("exit", code => (code === 0 ? resolve() : reject(new Error(`next build exited ${code}`))));
  });

  /*
   * Respawned rather than started once.
   *
   * This has been killed by the OS under memory pressure from unrelated servers
   * on the same machine, each time leaving a URL somebody had been told to open.
   * An instance that dies quietly is worse than one that was never offered, so
   * the child is restarted unless the stop was deliberate, with a backoff so a
   * genuine failure to boot does not spin.
   */
  let stopping = false;
  let restarts = 0;
  let server = run("npx", ["next", "start", "-p", String(PORT)], env);

  const supervise = (child: ReturnType<typeof spawn>) => {
    child.on("exit", code => {
      if (stopping) return;
      restarts++;
      const wait = Math.min(30_000, 2_000 * restarts);
      console.log(`\n  next exited (${code}). restart ${restarts} in ${wait / 1000}s\n`);
      setTimeout(() => {
        server = run("npx", ["next", "start", "-p", String(PORT)], env);
        supervise(server);
      }, wait);
    });
  };
  supervise(server);

  const report = () =>
    console.log(
      `\n  app          http://localhost:${PORT}\n` +
        `  facilitator  ${facilitator.url}  (fake: verifies and settles by agreeing)\n` +
        `  ingest       ${ingest.url}  (fake: accepts, and does not deduplicate)\n` +
        `  settled ${facilitator.hits.settle}   proposed ${ingest.hits}   restarts ${restarts}\n`,
    );
  setTimeout(report, 2_000);
  const ticker = setInterval(report, 30_000);

  const stop = async () => {
    stopping = true;
    clearInterval(ticker);
    server.kill("SIGTERM");
    await facilitator.close();
    await ingest.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(err => {
  console.error("  local demo failed:", err);
  process.exitCode = 1;
});
