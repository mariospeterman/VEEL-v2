# Veel V2 DAC7, DAC8/CARF, VAT/MWST System

Status: accepted
Scope: seller reporting, crypto reporting readiness, VAT/MWST determinations, receipts, invoices, compliance ledger
Last updated: 2026-06-05
Source of truth: yes

Owns:
- DAC7 readiness, DAC8/CARF readiness, VAT/MWST determination records, seller-of-record records, receipts, formal invoices, platform fee statements, and compliance export requirements

Defers to:
- qualified EU/Swiss tax and legal counsel for final launch determinations
- `packages/contracts/openapi.yaml` and `packages/database/schema-blueprint.sql` for exact implementation shape

Does not own:
- custody, payment provider classification, or final legal advice

Launch scope:
- compliance-ready system design before production launch

Non-goals:
- unsupported legal guarantees, tax-rate engine implementation, or claims that crypto/noncustody removes reporting duties

Veel is an 18+ creator social platform, marketplace software/access-infrastructure provider, noncustodial settlement layer, and admin/compliance reporting system. Veel must not be documented or implemented as a bank, wallet custodian, payment processor, money transmitter, broker, exchange, escrow provider, payout processor, ticket marketplace, dating platform, or default merchant-of-record for creator sales.

Qualified EU/Swiss tax and legal counsel must review this system before production launch and before enabling any export or filing workflow.

## Official Anchors Checked

- EU DAC7 platform operator rules: `https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/directive-administrative-cooperation-dac/dac7_en`
- EU DAC8 crypto-asset reporting: `https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/directive-administrative-cooperation-dac/dac8_en`
- EU OSS VAT overview: `https://europa.eu/youreurope/business/taxation/vat/one-stop-shop/index_en.htm`
- EU VAT place-of-taxation rules: `https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/place-taxation_en`
- EU invoicing rules: `https://taxation-customs.ec.europa.eu/taxation/vat/vat-businesses/invoicing_en`

## Noncustodial Compliance Rule

```text
No custody.
No Veel-held creator balances.
No internal credits.
No withdrawals.
No escrow.
No platform-controlled payout queue.
No money-based people ranking, feed ranking, recommendation boost, Mutuals boost, or message priority.
```

Preferred creator-commerce settlement:

```text
User wallet
  -> Creator wallet
  -> Veel fee wallet
  -> optional referral wallet

Backend verifies chain evidence.
Backend writes immutable ledger records.
Backend grants entitlement/access state.
```

Veel stores transaction signatures/references, settlement evidence, entitlement/access state, seller-of-record snapshots, fiat value snapshots at transaction time, compliance ledger entries, receipt/invoice metadata, and tax/reporting status. Veel does not store or control funds.

## DAC7 Readiness

Veel likely needs DAC7 readiness if it operates a platform that connects EU buyers/users with creators/sellers in exchange for consideration. Non-EU platform operators can be in scope depending on EU nexus and facilitated relevant activities. Do not claim final DAC7 status without counsel.

The system must be able to produce DAC7 reportable seller data if required:

- seller identity and address
- tax residence and TIN/VAT ID where required
- financial account or wallet settlement identifier where reportable
- consideration by quarter/year
- platform fees, commissions, and taxes withheld or charged by Veel
- seller due-diligence status and evidence version
- report year, reviewed status, exported status, and correction records

Annual DAC7 preparation should target the 31 January filing deadline for the previous calendar year where applicable, but final jurisdiction deadline and registration obligations are legal-ops configuration, not hardcoded product assumptions.

## DAC8/CARF Readiness

DAC8/CARF is separate from DAC7. Noncustodial wallet-to-wallet settlement reduces custody/payment-intermediary risk, but does not by itself prove Veel is outside DAC8/CARF. DAC8 applies from 1 January 2026 to Reporting Crypto-Asset Service Providers as implemented domestically, with first reporting generally in 2027 depending on jurisdiction.

Default feature flag:

```text
carf_reporting_required = false
```

If counsel or operating footprint changes this to true, the system must support:

- customer due diligence and self-certification
- tax residency and TIN capture where required
- wallet address and reportable crypto transaction aggregation
- annual CARF/DAC8 export preparation
- correction records
- admin approval before export

Do not document or implement “noncustodial means no reporting.”

## VAT/MWST Determination Inputs

VAT/MWST depends on product type, seller-of-record, buyer location, seller location, B2B/B2C status, VAT ID/VIES result where applicable, deemed-supplier status, physical vs virtual event access, and whether the product is support, digital access, event admission, membership, platform tier, platform fee, or referral commission.

Do not document:

```text
Crypto means no VAT.
Tips are never taxable.
Veel can always get VAT back from the buyer country.
Platform commission is not a taxable service.
Noncustodial means no reporting.
```

VAT collected from users is output tax to remit. Input VAT recovery applies only to Veel’s own business purchases where law allows. VAT corrections/refunds require adjustment records, not historical recalculation.

## Seller-Of-Record Matrix

| Product | Default seller-of-record | Veel role | Receipt/invoice rule | VAT handling direction |
| --- | ---: | --- | --- | --- |
| Support | Creator | software + settlement verification + platform fee | user receipt naming creator; platform fee statement to creator | do not assume non-taxable donation; tax status determined by product config/jurisdiction |
| Unlock | Creator | access entitlement software | user access receipt naming creator | creator sale unless deemed-supplier config says Veel |
| Paid message / paid media request | Creator | messaging/access tooling | receipt naming creator; no Mutuals priority | creator sale/service; strict safety rules |
| Live Pass | Creator | live access entitlement software | access receipt naming creator | digital/live access; destination rules may apply |
| Event Access Pass - physical | Creator/event owner | event page + access/check-in software | access receipt naming event owner | event-location VAT rules may apply |
| Event Access Pass - virtual/streamed | Creator/event owner | virtual access software | access receipt naming event owner | customer-country VAT may apply for B2C virtual access |
| Creator Membership | Creator | membership entitlement software | membership receipt naming creator | creator recurring supply unless deemed-supplier config says Veel |
| Veel Plus | Veel | seller | Veel VAT receipt/invoice | Veel B2C/B2B platform digital service |
| Veel Studio | Veel | seller | Veel VAT receipt/invoice | Veel B2C/B2B platform digital service; KYC required for creator tools |
| Enterprise | Veel | seller/contracting party | Veel VAT invoice/contract invoice | B2B/KYB, reverse charge or local VAT depending jurisdiction |
| Platform commission | Veel -> creator | Veel service fee | creator fee statement/invoice | B2B service; domestic VAT or reverse charge depending creator status/location |
| Referral commission | Veel -> referrer/partner | marketing/revenue share from Veel fee only | commission statement | report/tax treatment based on referrer status/location |

User/buyer receipts are not always formal VAT invoices. Formal VAT invoices are required where Veel is seller, deemed supplier, or charging a platform service fee. If creator is seller-of-record, Veel may generate a receipt as platform/agent, but docs and UI must not imply Veel sold the creator product.

## Receipts And Invoices

Every confirmed payment must generate a user-visible receipt/access confirmation containing:

- receipt id
- transaction signature/reference
- timestamp
- product type and product title/reference
- seller-of-record snapshot
- buyer user id and wallet
- gross token amount and fiat value snapshot
- tax/VAT treatment summary if known
- platform fee disclosure where required
- entitlement/access id
- refund/cancellation policy link
- support/contact route

Formal creator/platform fee invoices or statements must store:

- invoice/statement id
- creator/seller id
- Veel legal entity
- platform fee amount
- VAT/reverse-charge treatment
- VAT ID/VIES evidence where applicable
- period/transaction references
- referral amounts deducted from Veel fee
- net Veel revenue after referral commission
- export status

Schema names:

```sql
receipts
receipt_lines
platform_fee_statements
vat_invoices
vat_invoice_lines
tax_adjustments
```

Receipts are not proof that Veel is seller unless `seller_of_record = veel`.

## Compliance Ledger

`compliance_ledger_entries` is append-only. Never recalculate historical fiat values years later. Store fiat value at transaction time, the exact rule/version used to determine tax/reportability, and immutable hashes. Corrections are append-only adjustment entries.

Required fields:

```sql
id
event_type
product_type
product_id
seller_of_record_type
seller_user_id
seller_creator_id
seller_wallet_address
buyer_user_id
buyer_wallet_address
transaction_signature
chain_id
token_symbol
token_mint
gross_amount_token
gross_amount_fiat
fiat_currency
fx_rate
fx_rate_source
fx_rate_timestamp
creator_amount_token
creator_amount_fiat
platform_fee_token
platform_fee_fiat
referral_amount_token
referral_amount_fiat
tax_amount_fiat
buyer_country_snapshot
buyer_country_evidence_level
seller_country_snapshot
seller_tax_residence_snapshot
seller_vat_id_snapshot
seller_verification_status_snapshot
buyer_b2b_b2c_snapshot
vat_treatment_code
dac7_reportable_flag
dac8_carf_candidate_flag
receipt_id
entitlement_id
refund_adjustment_id
created_at
immutable_hash
```

Related tables:

```sql
tax_profiles
tax_profile_versions
seller_of_record_determinations
jurisdiction_tax_rules
product_tax_matrix
buyer_location_evidence
vat_determinations
dac7_reports
dac7_report_lines
carf_reports
carf_report_lines
compliance_review_queue
compliance_exports
```

PII and tax data must be encrypted/restricted. Admin actions must be audited.

## Admin Compliance Module

Admin > Compliance must support:

- DAC7 reportable seller dashboard
- missing creator tax data queue
- seller verification status
- country/tax residence snapshots
- annual seller summaries
- DAC7 export preparation
- DAC8/CARF readiness switch and export preparation
- VAT/MWST determinations
- OSS/non-Union OSS export support where applicable
- Swiss MWST review flags
- deemed-supplier review queue
- receipts/invoices search
- transaction ledger drilldown
- platform commission statements
- referral commission statements
- refund/adjustment records
- audit log
- role-based access controls

Admin must clearly separate:

```text
Operational status
Legal determination
Reportable status
Exported status
Reviewed/approved status
```

Frontend must never decide tax, reportability, seller-of-record, fee splits, or entitlement validity.
