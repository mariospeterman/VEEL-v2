import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const root='/workspace/scratch/0635fbdaf32f/wevid-complete';
let clock=Date.parse('2026-11-04T14:00:00.000Z');
class ClockDate extends Date {
  constructor(...args){super(...(args.length ? args : [clock]));}
  static now(){return clock;}
}
class PublicKey {
  constructor(value){this.value=value;}
  toBase58(){return this.value;}
  equals(other){return this.value===other.value;}
}
class Transaction {
  add(){return this;}
  serialize(){return Buffer.from('mock-serialized');}
}
const builder=vm.createContext({
  Buffer,Date:ClockDate,BigInt,
  address:x=>x,createNoopSigner:x=>({address:x}),UNKNOWN_INIT_ID:0,
  findSubscriptionAuthorityPda:async()=>['authority'],
  findRecurringDelegationPda:async()=>['delegation'],
  getInitSubscriptionAuthorityOverlayInstructionAsync:async()=>({programAddress:'program'}),
  getCreateRecurringDelegationOverlayInstructionAsync:async()=>({programAddress:'program'}),
  getSubscriptionAuthorityDecoder:()=>({decode:()=>({initId:1})}),
  PublicKey,Transaction,TransactionInstruction:class{constructor(x){Object.assign(this,x);}},
  Connection:class {
    async getAccountInfo(){return null;}
    async getLatestBlockhash(){return {blockhash:'blockhash'};}
  },
  TOKEN_2022_PROGRAM_ID:new PublicKey('token2022'),TOKEN_PROGRAM_ID:new PublicKey('token'),
  deriveAssociatedTokenAddress:()=>new PublicKey('ata'),
  createAssociatedTokenAccountInstruction:()=>({})
});
function load(path,context){
  const js=stripTypeScriptTypes(fs.readFileSync(root+'/'+path,'utf8'),{mode:'transform'})
    .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'')
    .replace(/^export\s+/gm,'');
  vm.runInContext(js,context,{filename:path});
}
load('apps/api/src/modules/subscription/subscription-authorization-transaction.ts',builder);
const context={
  subscriberWallet:'wallet',collectorAddress:'collector',tokenMint:'mint',tokenProgram:'spl_token',
  delegationProgramId:'program',delegationNonce:0,amountAtomic:100,periodSeconds:2592000,setupReference:'setup'
};
const first=await builder.createSubscriptionAuthorizationTransaction({context,rpcUrl:'mock'});
clock+=5000;
const second=await builder.createSubscriptionAuthorizationTransaction({context,rpcUrl:'mock'});
const authority={user:'wallet',tokenMint:'mint'};
const delegation={
  header:{delegator:'wallet',delegatee:'collector'},mint:'mint',subscriptionAuthority:'authority',
  amountPerPeriod:100n,periodLengthS:2592000n,
  expiryTs:BigInt(Math.floor(Date.parse(first.delegationExpiresAt)/1000))
};
const keys=['wallet','program','MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'].map(x=>new PublicKey(x));
const verifier=vm.createContext({
  Buffer,Date:ClockDate,BigInt,PublicKey,
  getRecurringDelegationDecoder:()=>({decode:()=>delegation}),
  getSubscriptionAuthorityDecoder:()=>({decode:()=>authority}),
  bs58:{decode:()=>Buffer.alloc(64)},
  getSubscriptionProviderConfig:()=>({rpcUrl:'mock',programId:'program',collectorWallet:'collector',supportedMints:['mint']}),
  checkSubscriptionProviderReadiness:()=>({ok:true}),isSupportedSubscriptionMint:()=>true,
  TOKEN_2022_PROGRAM_ID:new PublicKey('token2022'),TOKEN_PROGRAM_ID:new PublicKey('token'),
  deriveAssociatedTokenAddress:()=>new PublicKey('ata'),decodeTokenAccount:()=>({owner:'wallet',mint:'mint'}),
  Connection:class {
    async getTransaction(){return {meta:{err:null},blockTime:Math.floor(clock/1000),transaction:{message:{
      getAccountKeys:()=>({staticAccountKeys:keys}),compiledInstructions:[
        {programIdIndex:1,data:Buffer.from('')},
        {programIdIndex:2,data:Buffer.from('wevid:subscription-auth:setup')}
      ]
    }}};}
    async getAccountInfo(key){return {owner:new PublicKey(key.toBase58()==='ata'?'token':'program'),data:Buffer.alloc(0)};}
  }
});
load('apps/api/src/modules/subscription/subscription-verifier.ts',verifier);
const input={...context,signature:'mock64bytes',setupReference:'setup',authorityAddress:'authority',delegationAddress:'delegation',subscriberTokenAccount:'ata',provider:'official_solana_subscription_program',planId:'creator_x_monthly',expiresAt:new Date(clock+600000),delegationExpiresAt:new Date(second.delegationExpiresAt)};
const result=await verifier.createSolanaSubscriptionAuthorizationVerifier({}).verifyAuthorization(input);
const control=await verifier.createSolanaSubscriptionAuthorizationVerifier({}).verifyAuthorization({...input,delegationExpiresAt:new Date(first.delegationExpiresAt)});
const output={
  method:'Actual builder and verifier source transformed by node stripTypeScriptTypes; SDK/RPC/clock mocked; route/SQL overwrite verified statically, no live chain',
  firstExpiry:first.delegationExpiresAt,secondExpiry:second.delegationExpiresAt,
  deltaMs:Date.parse(second.delegationExpiresAt)-Date.parse(first.delegationExpiresAt),
  inputState:'Chain account contains first setup; stored expected facts come from second GET for same intent',
  actual:result,controlUsingOriginalExpectedExpiry:control,expected:'First still-valid signed setup remains verifiable or explicitly superseded before signature'
};
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/verification-subscription-expiry-proof.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
