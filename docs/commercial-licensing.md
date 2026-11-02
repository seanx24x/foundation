# Foundation commercial licensing review

2 November 2026 · Foundation source 0.47 · Public source authorized; legal and commercial-distribution review remains open

## Selected business and source policy

The user selected **publish source for inspection under restricted terms**. Foundation-original material now uses the custom [Foundation Source Inspection License 1.0](../LICENSE.txt), with matching [extension terms](../desktop/extension/LICENSE.txt) and package metadata. The owner has authorized a separate [public source snapshot](publication.md); earlier development history remains private. This policy supports a commercial product while withholding a general code-reuse grant; it is not an OSI open-source license.

The terms permit source access, verbatim copies, inspection, security review and business due diligence. They do not grant building/running, modification, redistribution outside the stated hosting exceptions, incorporation into another product, or commercial exploitation of Foundation-original material. Separate written agreements can authorize developers, evaluators and customers. Third-party permissions, prior valid grants, applicable hosting-service rights and nonrestrictable legal rights are explicitly preserved. The license does not establish ownership or claim trademark registration.

These are prepared custom terms, not a legal opinion or a guarantee against copying. Have qualified IP counsel review the terms, ownership/provenance, public-source scope and intended commercial distribution for the public source and before commercial application distribution. Publication authorization does not establish legal clearance. An application EULA, company ownership/assignments and customer/provider terms are separate work; the source-inspection license is not a customer app license.

## The two different questions

1. **Can Foundation build a business using Code OSS and dependencies?** The upstream MIT grant expressly allows commercial redistribution under its conditions. Exact other component obligations still apply. Foundation does not have to grant everyone an MIT license to its own separate code merely because it uses Code OSS. [Code OSS license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).
2. **What may other people do with Foundation's own code?** That depends on Foundation's chosen grant. MIT/Apache allow commercial reuse; open-source licenses cannot prohibit commercial fields of use. The chosen inspection-only policy is source-available, not open source. [Open Source Definition](https://opensource.org/osd).

GitHub public visibility itself grants service-specific viewing/forking rights. A restrictive license cannot promise to eliminate those platform rights or erase copies already made. [GitHub licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Publication history matters

The private initial commit `1ab8538ee2972104d913ed4ba96651abd8b96c13` declares `MIT` for the Foundation extension despite lacking a complete extension license file. Today's metadata correction does not remove that earlier revision or establish that earlier grants never existed. No Git history has been rewritten.

**The earlier development repository stays private.** The owner authorized public source on 2 November 2026. A reviewed source snapshot begins a separate public Git history at `seanx24x/foundation`; the private development history is retained at `seanx24x/foundation-development`. A clean snapshot avoids exposing ambiguous historical declarations; it does not revoke prior rights, relicense third-party code, or cure missing ownership authority. Earlier recipients/grants and source provenance still need legal review. See the [publication record](publication.md).

The three canvas-capture host patch files have existing Microsoft/MIT headers. They remain within the separate MIT boundary. Confirm whether those headers reflect actual derivation or a copied template; do not assert Foundation owns them exclusively without evidence.

## Current audit findings

| Scope | Evidence | Result / limit |
| --- | --- | --- |
| Foundation-original metadata | Root + extension packages, root lock metadata and copied extension license | Now consistently point to `LICENSE.txt`; npm `private: true` remains an accidental-publication guard, not the legal grant. |
| Root production npm dependencies | Fifteen exact lock entries; full installed notices and hashes archived in [inventory](../licenses/inventory.json) | MIT, ISC, BSD-3-Clause and DOMPurify's MPL/Apache alternative. No noncommercial-only restriction identified in this bounded set. No whole-app clearance implied. |
| Fonts and specimen icons | Geist 1.8.2 hashes and both OFL records; Lucide full ISC/MIT notice | Notices present; separately licensed assets retain their rights. |
| Pinned Code OSS | 1.143.1, commit `e646868227c3e3a9e3f24277c8c7220be42c0be7` | Exact upstream MIT and third-party notice archive preserved. Installed app copies match the upstream records. |
| Browser distribution | Current Vite output configuration | Complete generated browser notice bundle is not yet assembled; preserve and ship applicable notices before distributing compiled browser assets. |
| Foundation extension packaging | Extension copy list and fixture tests | Future refresh/build includes exact source license; missing terms refuse replacement and license-only changes trigger refresh. This increment does not reinstall the running app. |
| Product license link | Product overlay | Future builds identify Foundation source terms and link to them. Code OSS's root `LICENSE.txt` is retained. Current installed 0.47 still has its earlier metadata. |
| Native binaries | Upstream notices, packaged extension folders and Chromium credits | Partial inventory only; full dependency/source-obligation mapping remains open. |

The [third-party notice index](../THIRD_PARTY_NOTICES.md) identifies component boundaries and complete copied texts. The npm license-file convention is documented by [npm](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license).

## Native components requiring explicit release review

- Downloaded GitHub-release built-ins: `ms-vscode.js-debug` 1.140.0, `ms-vscode.js-debug-companion` 1.1.3 and `ms-vscode.vscode-js-profile-table` 1.0.11. All declare MIT; the first two include their own MIT text. Profile-table's installed folder lacks a dedicated upstream license file, although third-party notices exist. Retrieve and verify the exact release's applicable copyright/license before redistribution.
- Copilot is absent from the inspected application. Bootstrap acquires pinned upstream GitHub assets before configuring Open VSX. Open VSX availability does not itself establish redistribution permission, and Microsoft's Marketplace/proprietary extension terms remain distinct. [Microsoft guidance](https://code.visualstudio.com/docs/supporting/faq).
- The Code OSS notice archive includes **Codicons CC BY 4.0** and **Git logo CC BY 3.0**. Keep attribution and relevant license/trademark treatment.
- The Mermaid extension resolves **elkjs 0.9.3 / EPL-2.0**; ELK identifiers occur in its installed notebook, chat and Markdown-preview JavaScript. Review the exact distributed portions and corresponding source obligations.
- `terminal-suggest/cgmanifest.json` registers **fish-shell 3.7.1**, commit `6627d403d33b4e74b49aa4db2a4f17709628cdc8`. Fish-derived command-description material occurs in the installed terminal suggestions. Review the applicable GPL-related notices, derivation and distribution obligations for that material.
- Electron/Chromium credits are present in the installed app; presence alone does not verify every binary dependency, attribution or source requirement.

Those component findings do not by themselves determine a GPL/EPL license for all Foundation-original code. They do prevent a blanket claim that every shipped component is MIT or that commercial distribution is fully cleared.

## Release decisions and remaining work

| Gate | State | Required outcome |
| --- | --- | --- |
| L1 — Original-source policy | Implemented; legal review pending | User-selected inspection-only terms, separate-license boundaries and matching metadata are prepared. Confirm licensors, authority, contributor agreements and enforceability for the public source and before commercial application distribution. |
| L2 — Public source snapshot | Authorized; separate snapshot published | Owner explicitly authorized public inspection access. Current source is published with separate history; earlier MIT-labelled development commits remain private. This does not resolve earlier grants or provenance/ownership review. [Publication](publication.md). |
| L3 — Notice coverage | In progress | Root production notices and pinned upstream archive retained. Assemble notices for each actual browser/app output and verify release inclusion. |
| L4 — Exact native dependency obligations | Pending | Resolve profile-table notice gap and EPL/GPL/CC/Electron component obligations, with counsel as needed. Include applicable corresponding source/offer mechanisms. |
| L5 — Product/customer terms | Pending | Confirm company/rightsholder arrangements, customer EULA, branding/trademark review and relevant provider terms. Source access is not an app-use license. |
| L6 — Distribution acceptance | Pending | Build a new candidate with its intended license metadata and notices, inspect actual packaged output, and retain exact versioned evidence before public release. |

This licensing work belongs to M5.09. Public source access was explicitly authorized while the documented legal and commercial-distribution reviews remain open. It does not advance the SwiftUI/runtime milestone or replace the final new visual/motion system work.
