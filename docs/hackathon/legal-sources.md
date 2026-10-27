# Legal sources

Retrieved and verified: 27 October 2026.

This is compliance analysis that supports "Check this" findings. It is not legal advice. A qualified Nigerian data protection lawyer should confirm the NDPA entries before they are shown to customers as statements of law.

## Sources

### 1. Nigeria Data Protection Act, 2023 (Act No. 37)

- URL: https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf
- Publisher: Nigeria Data Protection Commission (linked from https://ndpc.gov.ng/resources/).
- What it is: Federal Republic of Nigeria Official Gazette, Extraordinary No. 119, Vol. 110, 1 July 2023, Government Notice No. 82; the Act runs on gazette pages A719 to A758. Commencement: 12 June 2023.
- Retrieved: 27 October 2026.
- Supports: all 12 NDPA entries.
- Page references below give the gazette page, then the PDF page (PDF page = gazette page minus 716).

### 2. PCI SSC FAQ 1319, "Are merchants allowed to request card-verification codes/values from cardholders?"

- URL: https://www.pcisecuritystandards.org/faqs/1319/
- Dated on page: June 2025. Retrieved: 27 October 2026.
- Supports: `pci-no-cvv-storage` (Requirement 3.3.1.2: no storage of card verification codes after authorisation, even if encrypted).

### 3. PCI SSC FAQ 1588, "How does an e-commerce merchant meet the SAQ A eligibility criteria for scripts?"

- URL: https://www.pcisecuritystandards.org/faqs/1588/
- Dated on page: February 2025. Retrieved: 27 October 2026.
- Supports: `pci-hosted-payment-page` (PCI DSS v4.0.1 SAQ A r1 eligibility criterion for scripts on pages that embed a provider's payment form; Requirements 6.4.3 and 11.6.1 named as example techniques; not applicable to redirects).

### 4. PCI SSC FAQ 1085, "Can unencrypted PANs be sent over e-mail, instant messaging, SMS, or chat?"

- URL: https://www.pcisecuritystandards.org/faqs/1085/
- Dated on page: August 2025. Retrieved: 27 October 2026.
- Supports: `pci-encrypt-in-transit` (Requirement 4.2.1 strong cryptography over open, public networks; Requirement 4.2.2 no unprotected PANs via end-user messaging).

The PCI DSS v4.0.1 standard itself was not read; the requirement numbers are as stated on the FAQ pages above. They should be checked against the standard from https://www.pcisecuritystandards.org/document_library/ before customer-facing use.

## Where each entry is found

- `ndpa-lawful-basis`: Section 25(1) and 25(2)(a). NDPA s.25 "Lawful basis of personal data processing", A733 (PDF p.17).
- `ndpa-valid-consent`: Section 26(1), (3), (4), (6) and (7)(a). NDPA s.26 "Consent": (1) at A733 (PDF p.17); (3) to (7) at A734 (PDF p.18).
- `ndpa-withdraw-consent`: Section 35(1) and (2). NDPA s.35 "Withdrawal of consent", A739 (PDF p.23).
- `ndpa-purpose-limitation`: Section 24(1)(b). NDPA s.24 "Principles of personal data processing", A732 (PDF p.16); compatibility test in s.24(4), A733 (PDF p.17).
- `ndpa-data-minimisation`: Section 24(1)(c). NDPA s.24, A732 (PDF p.16).
- `ndpa-storage-limitation`: Section 24(1)(d). NDPA s.24, A732 (PDF p.16).
- `ndpa-privacy-notice`: Section 27(1) and (3). NDPA s.27 "Provision of information to the data subject": (1) at A734 (PDF p.18); (3) at A735 (PDF p.19).
- `ndpa-right-of-access`: Section 34(1)(a) and (b). NDPA s.34 "Rights of a data subject": (1)(a)(i) to (v) at A738 (PDF p.22); (1)(a)(vi) to (viii) and (1)(b) at A739 (PDF p.23).
- `ndpa-correction-erasure`: Section 34(1)(c), (d) and 34(2). NDPA s.34, A739 (PDF p.23).
- `ndpa-security-of-processing`: Section 39(1) and (2). NDPA s.39 "Security, integrity, and confidentiality", A741 (PDF p.25).
- `ndpa-breach-notification`: Section 40(2), (3) and (8). NDPA s.40 "Personal data breaches": (2) and (3) at A742 (PDF p.26); (8) at A743 (PDF p.27).
- `ndpa-processor-agreement`: Section 29(1) and (2). NDPA s.29 "Obligations of the data controller and data processor": (1)(a) and (b) at A735 (PDF p.19); (1)(c) to (e) and (2) at A736 (PDF p.20).
- `pci-no-cvv-storage`: Requirement 3.3.1.2. FAQ 1319, answer body.
- `pci-hosted-payment-page`: SAQ A r1 eligibility criterion for scripts, with Requirements 6.4.3 and 11.6.1 as example techniques. FAQ 1588, answer body.
- `pci-encrypt-in-transit`: Requirement 4.2.1 and 4.2.2. FAQ 1085, answer body.
