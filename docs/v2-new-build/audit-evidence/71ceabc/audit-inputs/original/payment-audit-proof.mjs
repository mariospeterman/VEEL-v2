import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const repo = '/workspace/scratch/0635fbdaf32f/wevid-audit';
function load(path, context) {
  const js = stripTypeScriptTypes(readFileSync(`${repo}/${path}`, 'utf8'), { mode: 'transform' })
    .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];\s*/gm, '')
    .replace(/^export\s+/gm, '');
  vm.runInContext(js, context, { filename: path });
}
const context = vm.createContext({ Buffer, Date, BigInt, console,
  bs58: { decode: () => Buffer.alloc(64) },
  PublicKey: class { constructor(value) { this.value = value; } toBase58() { return this.value; } }
});
load('apps/api/src/modules/payment/payment-amounts.ts', context);
load('apps/api/src/modules/payment/solana-payment.ts', context);
const buyer = 'buyer', seller = 'same-creator-enterprise-recipient', platform = 'platform';
const blockTime = Math.floor(Date.now()/1000);
const transfer = (destination, lamports) => ({ program: 'system', parsed: { type: 'transfer', info: { source: buyer, destination, lamports } } });
const actualTransfers = [transfer(seller, 4500), transfer(platform, 1000), { program: 'spl-memo', parsed: 'veel:intent' }];
const actual = await context.verifySolanaTransfer({ async getParsedTransaction() { return { meta:{err:null}, blockTime,
  transaction:{message:{accountKeys:[{pubkey:{toBase58:()=> 'reference'}}],instructions:actualTransfers}}
}; } }, { signature:'valid-64-byte-base58-signature', referenceAddress:'reference', memo:'veel:intent',
  settlementKind:'creator_split', buyerWallet:buyer, creatorWallet:seller, enterpriseWallet:seller,
  platformFeeWallet:platform, referralWallet:null, treasuryWallet:'different-treasury',
  totalAmountMinor:10000, creatorAmountMinor:4500, enterpriseManagementAmountMinor:4500,
  platformFeeAmountMinor:1000, referralAmountMinor:0, currency:'SOL', expiresAt:new Date(Date.now()+100000)
});

let emailPayload;
const emailContext = vm.createContext({ Date, URL, console, fetch: async () => { throw Error('unused'); } });
load('apps/worker/src/payment-confirmation-email.ts', emailContext);
const sender = emailContext.createResendPaymentConfirmationEmailProvider({apiKey:'test', from:'test@example.test', webUrl:'https://example.test',
  fetchImpl: async (_url, init) => { emailPayload=JSON.parse(init.body);return {ok:true, json:async()=>({id:'receipt'})}; }
});
await sender.send({deliveryId:'proof', to:'reader@example.test', receiptNumber:'PROOF', productType:'support', amountMinor:1000000000,
 currency:'SOL', termsVersion:'v1',withdrawalWaiverVersion:'v1',withdrawalWaiverAcceptedAt:null});
const result = {
  splitUnderpayment: { quotedAtomic:10000, actualTransferredAtomic:5500, expectedConfirmed:false, actualConfirmed:actual.confirmed,
    note:'Actual verifier source evaluated with mocked RPC and native-only dependency stubs; identical creator/enterprise recipient is permitted by schema.' },
  emailAtomicDisplay: {actualAmountText:emailPayload.text.split('\n').find(x=>x.startsWith('Amount:')), expectedAmountText:'Amount: 1 SOL'}
};
writeFileSync('/workspace/scratch/0635fbdaf32f/payment-audit-proof-results.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
