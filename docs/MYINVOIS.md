# Malaysian e-Invoice preparation

The Square Box MVP supports an **internal draft export only**. It does not
submit to LHDN/IRBM MyInvois, create an officially validated e-Invoice, or generate
an IRBM UUID or validation link. The exported status is always
`draft_not_submitted`, with `readyForSubmission: false`.

## What the current draft does

- Exports an existing paid order, its RM/MYR line items, service charge, tax and
  total. Integer sen arithmetic checks that all amounts reconcile.
- Accepts optional individual buyer details. An anonymous internal draft does
  not require a customer's personal data.
- For a business draft export, requires name, TIN, BRN identification number and
  address. This is local completeness checking, **not** verification of a TIN,
  identity, eligibility or official schema compliance.
- Lists missing supplier details explicitly. The restaurant name alone is not
  sufficient for a live submission.

This internal JSON is not a UBL document. An anonymous draft must not be treated
as an individual or consolidated e-Invoice accepted by LHDN. Consolidated
invoicing rules, customer-requested invoice requirements and submission deadlines
are not implemented.

The configured zero service charge follows the owner's instruction. A zero tax
amount in the MVP is a configuration value; it does not establish that The Square
Box is exempt from SST or any other obligation. Confirm applicable tax rules
before real trading or submission.

## Before a live integration

The following is an implementation checklist, not a claim that this MVP meets
current regulatory requirements. Verify the current official rules and SDK
version before implementation:

1. Confirm the restaurant's legal supplier identity, TIN, business registration
   number, relevant tax registrations, business classification/MSIC, business
   activity, structured address, contact details and applicable tax treatment.
2. Register/authorize the taxpayer system in the official MyInvois environment.
   Obtain the appropriate **sandbox** client ID and client secret through the
   authorized taxpayer account. Check the current identity and access workflow.
   Production registration/authorization and credentials must be managed
   separately; a sandbox pass is not production acceptance.
3. Check the current official invoice schema/version and applicable requirements
   for buyer information, identification, classification, units, tax fields,
   document dates and signing/certificates. Map the order into that supported UBL
   structure. Do not submit this internal export unchanged.
4. Implement authenticated submission, expiry/token handling, document hashes,
   deduplication, asynchronous validation tracking, rejection handling, retrieval
   of the official identifiers, and the applicable cancellation, credit-note and
   refund workflows. Persist the actual platform results.
5. Validate representative cases in the sandbox and reconcile amounts with POS
   records. Only enable production after authorization and acceptance testing.
   Never label a pending, rejected or unsubmitted document as validated.
6. Implement staff authorization, HTTPS, customer-data access controls, retention
   and deletion policies, and a secure credential store. Keep client secrets out
   of the browser, source control, exports and logs. Do not ask customers or the
   owner to paste secrets into chat.

No credentials are needed for the current local draft functionality, and this
MVP does not request or store MyInvois credentials.

## Official starting points

- LHDN/IRBM: <https://www.hasil.gov.my/>
- Official MyInvois SDK: <https://sdk.myinvois.hasil.gov.my/>
- MyInvois production portal: <https://myinvois.hasil.gov.my/>
- MyInvois sandbox portal: <https://preprod.myinvois.hasil.gov.my/>

During implementation in this environment, HTTPS requests to the official SDK
were blocked by the network proxy with `403 Forbidden`. Consequently, current
SDK content, endpoint paths, production signing requirements and onboarding
steps have **not** been independently verified here. Use the official SDK and
LHDN guidance to resolve them before building the live connector. Network access
to `sdk.myinvois.hasil.gov.my` will be needed for that verification; live API
hosts must be determined from the current official SDK and added to environment
settings as needed.
