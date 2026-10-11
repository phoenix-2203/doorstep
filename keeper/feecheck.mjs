// Prints keeper fee vs. actual gas cost for every landing/bounce of a Doorstep deployment.
import fs from 'node:fs';
import { createPublicClient, http, decodeEventLog } from 'viem';
const { Doorstep: A } = JSON.parse(fs.readFileSync(new URL('./abi.json', import.meta.url)));
const pub = createPublicClient({ transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') });
const logs = await pub.getLogs({ address: process.env.DOORSTEP, fromBlock: BigInt(process.env.FROM_BLOCK ?? 0) });
for (const l of logs) {
  let e; try { e = decodeEventLog({ abi: A, data: l.data, topics: l.topics }); } catch { continue; }
  if (!['Landed', 'Bounced'].includes(e.eventName)) continue;
  const r = await pub.getTransactionReceipt({ hash: l.transactionHash });
  const cost = r.gasUsed * r.effectiveGasPrice;
  console.log(`${e.eventName.padEnd(8)} gasUsed ${r.gasUsed}  fee/cost ${(Number(e.args.keeperFee) / Number(cost)).toFixed(3)}  (fee pays for ${e.args.keeperFee / r.effectiveGasPrice} gas)`);
}
