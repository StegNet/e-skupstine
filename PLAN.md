# e-Skupština: plan

> **Status (2026-11-08):** M1–M4 and most of M6 are built; see [README.md](README.md). Differences from this plan:
> roles use a plain `role` field instead of the Better Auth admin plugin; the Certilia OIB is stored as the account
> subject (not a user field); guests watch without host approval; `certilia_api` sealing (M5) and the M0 spikes are
> still open.

Online voting for Croatian *udruge*: Next.js + shadcn/ui + Better Auth + Bun, in Docker.
Draft, 2026-11-07. Decisions are recorded in §9. This plan is not legal advice. Have the udruga's *statut* checked.

---

## 1. Research findings

### 1.1 What the law requires (Zakon o udrugama, NN 74/14, 70/17, 98/19, 151/22)

The last amendment is NN 151/22, in force since 1 Jan 2023. Check Narodne novine for anything newer.

| Topic | What the law says | What it means for the app |
|---|---|---|
| Who is in the skupština | It is the highest body (čl. 16). It is made up of all members, or of representatives as the statut sets out. The statut can limit voting to some membership categories (čl. 17). | Eligibility comes from the **member register**, not from login. Each member needs a "has voting right" flag. |
| When it meets | Regular sessions are held "within the period set by the statut". Extraordinary sessions are held as needed (čl. 18). | Session type is **redovna** or **izvanredna**. Nothing else is fixed by law. |
| Convening, quorum, majorities, voting method | The law does not set these. They **must be in the statut** (čl. 13(3)). | These can't be hard-coded. Quorum and majority are **configurable for each skupština and each question**. |
| Electronic sessions and voting | **The law does not mention them.** Only the statut can allow them. | The host must confirm that "our statut allows electronic sessions" before opening one. A good model is the Croatian Chamber of Notaries (HJK) rule: for secret votes, the technical setup must authenticate voters unambiguously, and a vote must not be linkable to the voter. The design below targets that rule. |
| Member register (*popis članova*) | It is mandatory and may be kept electronically. It must contain: name, **OIB**, date of birth, date of joining, membership category, and date of leaving (čl. 12). It must be open to inspection. | Import it as CSV. **Certilia login returns the OIB**, so a login matches a member automatically. |
| Minutes (*zapisnik*) | Minutes of a **regular** session must be sent to the registry office (čl. 19). A change to the register needs the minutes of the body that decided it, filed within 60 days (čl. 27). The law does not set the content of the minutes. | **Generate the zapisnik as a PDF.** This PDF is also the document the committee signs. |

Usual practice varies by statut and is not in the law. At the start of a session, the skupština elects its working bodies: a chair, a minute-taker, two minute verifiers (*ovjerovitelji*), and for secret ballots a counting committee (*verifikacijsko/izborno povjerenstvo*). Your "review committee" is that counting committee. Typical rules are a quorum of more than ½ of members, decisions by a majority of those present, and ⅔ for changes to the statut.

### 1.2 Certilia (AKD)

- **Login (Identity Provider):** OAuth2/OIDC at EU **LoA high**. It returns verified **name, surname and OIB**. It is **free up to 100k logins a month**, then €66.36 a month. You register yourself at `developer.certilia.com`, with no contract. The public pages do not give the discovery URL, a sandbox or the claim names. Whether it returns **email** is **not confirmed** (see the spike in M0).
- **Signing, free route:** a citizen buys a cloud qualified certificate (**€9.29**) and signs PDFs in the free Certilia mobile app. There is also `websign.certilia.com`. The result is a **qualified electronic signature (QES)** under eIDAS, legally the same as a handwritten one.
- **Signing, API route:** the "eSign API" puts a *Potpiši* (Sign) button inside our app. It costs **from €1,061.78 a year** (10k signatures), with a 30-day free trial. The public docs do not describe it.
- **Verification:** you don't download a "Certilia pubkey". A QES is verified by chaining the signer's certificate to AKD's qualified CA, which is on the **EU Trusted List**. **Adobe Acrobat Reader** and the **EU DSS validator** do this out of the box, so voters can verify the PDF without our app.

### 1.3 Okta

Okta is standard OIDC. Better Auth has an `okta()` helper (`issuer: https://<org>.okta.com/oauth2/default`). For roles, add a **`groups` claim** on the Okta authorization server and map a group (e.g. `eskupstina-admins`) to the app role on each login. Okta gives **no OIB**, so Okta users match the member register by email. Okta makes sense if the organisation already runs it. Ordinary udruga members won't have Okta accounts.

### 1.4 Better Auth (checked against the docs)

- `genericOAuth` handles Certilia (any OIDC provider, via `discoveryUrl` and `mapProfileToUser`). Okta uses its built-in `okta()` helper.
- **Guests use `emailOTP`, not the `anonymous` plugin.** The anonymous plugin creates users *without* PII. You want a name and email, and the email has to be real so the sealed result can reach it. `emailOTP` signs a user in with a 6-digit code, creates them, and accepts `name`.
- The `admin` plugin provides the `role` field and `createAccessControl` for permissions.
- Next.js: the handler goes in `app/api/auth/[...all]/route.ts` (`toNextJsHandler`), sessions are read with `auth.api.getSession({ headers: await headers() })`, and `nextCookies()` must be the last plugin. On Next 16, `middleware.ts` becomes `proxy.ts`.
- Drizzle: run `bunx auth@latest generate`, then `drizzle-kit generate` and `migrate`. The docs disagree on the adapter import path, so check it against the installed version.

---

## 2. Changes to your idea

### Remove or rename
1. **"Anonymous user" becomes "Guest" (*gost*).** A guest gives a name and email, and the email is verified with a code. That is not anonymous, and calling it anonymous would confuse people and auditors. *Ballot secrecy* is a separate thing and stays.
2. **No "own PKI" (running a CA).** A CA is a project of its own. The "own keys" sealing method (§5.5) uses plain signing keys held by committee members, with no CA.
3. **No websockets in v1.** Polling every 2–3 s is enough for skupštine of tens to hundreds of people, and it runs fine in one container.
4. **Voters don't get their receipt by email when they vote.** That would let the server link voters to ballots (see §5.4). The receipt stays in the voter's browser, and the final email carries the full list of receipts.

### Add (each one is cheap and needed by the law or by the crypto)
1. **Member register import** (CSV: name, OIB, date of birth, email, category, voting right). Eligibility, the quorum denominator and Certilia OIB matching all depend on it.
2. **Agenda (*dnevni red*)** with prepared questions attached to items. Default options are **Za / Protiv / Suzdržan** (for, against, abstain), or custom options and candidate elections ("choose up to N").
3. **Quorum display and a quorum snapshot for each vote.** **Majority rule for each question**: share of votes cast, of those present, or of all members, at ½ or ⅔. The app works out "adopted / not adopted".
4. **Statut confirmation** checkbox before an electronic skupština can open.
5. **Zapisnik PDF**, generated automatically. It is the document the committee signs and the one filed with the registry.
6. **Invitation email (*saziv*)** to all members with the date, agenda and join code. It reuses the mailer that already sends results.
7. **Ballot receipts** and a **public list of receipts** in the sealed result, so each voter can check that their ballot was counted.
8. **Invalid ballot** handling. The server can't read encrypted ballots, so malformed ones are counted as *nevažeći* (invalid) at tally time.
9. **Audit log** (append-only table) of every host and committee action.
10. **GDPR:** a privacy notice, guest PII deleted N months after sealing, EU hosting.

### Suggested, not in v1 (tell me if you want any)
- Proxy voting (*punomoć*). Many statuti allow it.
- Video. Use Jitsi or Zoom alongside the app; don't build it.
- Changing a vote before the question closes.

---

## 3. Architecture

```
Browser (Next.js client)                        Server (Next.js, Bun)                 Postgres
 ├─ shadcn/ui, next-intl (hr default, en)       ├─ Better Auth (/api/auth/*)          ├─ auth tables
 ├─ WebCrypto: encrypt ballot, key ceremony,    ├─ Server actions (authZ in each)     ├─ members, assemblies,
 │   decrypt own key shares                     ├─ Tally (same TS code as browser)    │   agenda, questions,
 └─ polling every 2–3 s (router.refresh)        ├─ PDF (@react-pdf/renderer)          │   attendance, ballots …
                                                ├─ Signed-PDF check (pkijs)           └─ audit_log
                                                └─ Mail (nodemailer → SMTP)
```

**Dependencies.** Each has a reason to be there:
- `next`, `react`, `shadcn/ui` (Tailwind), `next-intl`: requested, plus i18n.
- `better-auth`, `drizzle-orm`, `postgres`, `drizzle-kit` (dev): auth and the database.
- `shamir-secret-sharing` (Privy, audited by Cure53 and Zellic): k-of-n key splitting. Don't hand-roll this.
- `@react-pdf/renderer` with an embedded Noto Sans font (č ć đ š ž).
- `pkijs` + `asn1js`: read and check the CMS signature in the uploaded signed PDF.
- `nodemailer`: SMTP.
- `zod`: validates input at every server action.

**Roles**
- Global, stored in `user.role`: `admin` turns guest access on and off, imports members and appoints hosts. `user` is everyone else. Okta users get `admin` from a group claim. Certilia users get it from an admin in the database.
- Per skupština, stored in its own tables: `host`, `committee` (n members, threshold k), `voter` (a member with voting right who joined), `guest` (watches only and never votes).
- One udruga per deployment, so there is no organisation table and no tenant column.

**Data model (Drizzle, Postgres)**

| Table | Key columns |
|---|---|
| `user` (Better Auth + extra fields) | `role`, `oib` (nullable), `locale` |
| `member` (popis članova) | `oib` unique, `fullName`, `dateOfBirth`, `email`, `category`, `joinedAt`, `leftAt`, `votingRight`, `userId` (linked on first login) |
| `assembly` | `title`, `type` (redovna/izvanredna), `scheduledAt`, `joinCode`, `status` (draft→keys→open→closed→sealed), `guestAccess`, `statutConfirmedBy`, `quorumRule`, `threshold`, `sealMethod` (certilia_app / certilia_api / own_keys) |
| `assembly_committee` | `assemblyId`, `userId`, `encPublicKey` (JWK), `signPublicKey` (JWK, own_keys only), `signedAt` |
| `agenda_item` | `assemblyId`, `order`, `title`, `description` |
| `question` | `agendaItemId`, `text`, `options` (jsonb), `maxChoices`, `majorityRule`, `resultsVisibility` (public / restricted), `status`, `presentAtOpen` (quorum snapshot) |
| `attendance` | `assemblyId`, `userId`, `isGuest`, `removedAt`, `joinedAt`, `lastSeenAt` |
| `participation` | **unique(`questionId`, `userId`)**, `votedAt`: who voted, with *no link to the ballot* |
| `ballot` | `id` (random uuid), `questionId`, `bundle` (jsonb ciphertext), `receipt`. No voter ID and no timestamp. Ballots are always secret. |
| `share_submission` | `questionId`, `committeeUserId`, `shares` (jsonb, ballotId→share), accepted only after the question closes |
| `result` | `questionId`, `counts`, `invalid`, `adopted`, `receiptsDigest` |
| `seal` | `assemblyId`, `pdf` (bytea), `signedPdf` (bytea, Certilia methods), `signatures` (jsonb, own_keys), `signers` (jsonb), `sealedAt` |
| `audit_log` | `actorId`, `action`, `payload`, `at` |

The `participation` row and the `ballot` row are inserted **in one transaction**. The unique constraint guarantees one vote per person per question.

---

## 4. Flows

**4.1 Login**
- A **member** logs in with Certilia (or Okta). If the OIB (or, for Okta, the email) matches a `member` row with voting right, the user is linked to it. If there is no match, they can log in but cannot vote.
- A **guest** sees the button only when `assembly.guestAccess` is on, which only an admin can set. They enter name and email, receive a 6-digit email code, and enter the join code. **Guests watch only.** They never vote and don't count toward the quorum. The host can remove a guest.

**4.2 Before the session (host):** create the skupština, add agenda items and questions (options, majority rule, public or restricted results), appoint the committee (n ≥ 3, k = 2 by default), **choose the sealing method** (§5.5), tick the statut confirmation, and send the invitation (saziv) email.

**4.3 Key ceremony (committee, before opening):** each committee member opens the *Povjerenstvo* page. Their browser generates an ECDH P-256 key pair (plus an ECDSA P-256 signing pair when the method is own_keys), keeps the private keys in IndexedDB (non-extractable) and also **downloads them as a backup file**, then uploads the public keys. The skupština cannot open until all n members have registered their keys.

**4.4 Joining:** a user enters the join code (or opens the invitation link), which creates an attendance row. The host sees the attendee list live (name, member or guest, online status from `lastSeenAt`), the present count and whether the quorum is met.

**4.5 Voting:** the host opens a question, which records the quorum snapshot. Each voter's browser encrypts the ballot (§5) and shows the **receipt code**, also saving it in localStorage. The host sees only "X of Y have voted". The host then closes the question.

**4.6 Tally (after each question closes):** each committee member clicks "Decrypt my shares". Their browser decrypts their share of every ballot and posts the shares. Once k members have posted, any committee member's browser rebuilds the keys, decrypts and tallies, and the server runs the **same code** and must get the same result. Each committee member then confirms the result. **Public** results show the final counts to every attendee, guests included. **Restricted** results show the counts only to the host and committee. Attendees see that the question was closed and counted.

**4.7 Sealing (end of session):** the server generates the **zapisnik PDF**. It contains attendance and the quorum, the agenda, each question with its counts and outcome, the committee, and an appendix listing every receipt with the SHA-256 digest of each list. The committee seals it with the chosen method (§5.5). Once k signatures are in, the skupština is **sealed**, and the sealed PDF (plus `.sig.json` for own_keys) is **emailed to everyone who voted**, plus the host.
- ⚠ The zapisnik is the legal record that goes to the registry, so it contains **all** counts, restricted questions included. "Restricted" only limits what is shown in the app during the session.

**4.8 Voter verification:** for Certilia methods, the voter opens the PDF in Adobe Reader (or the EU DSS validator) to confirm it carries valid qualified signatures and has not been altered since signing. For own_keys, the voter drops the PDF and `.sig.json` on our `/verify` page. Either way, they then search the PDF for their own receipt code to confirm their ballot was counted.

---

## 5. Crypto spec

Only standard WebCrypto and one audited library are used.

**5.1 Committee keys.** Each of the n members holds an ECDH P-256 key pair. Private keys never reach the server.

**5.2 Encrypting a ballot (in the voter's browser):**
1. `K` = 32 random bytes. `ct = AES-256-GCM(K, iv, JSON{optionIds, nonce})`.
2. `shares = split(K, n, k)` (shamir-secret-sharing).
3. For each committee member *i*: generate an ephemeral ECDH key, derive a key with HKDF-SHA256 from the ECDH result with member *i*'s public key, and encrypt `share_i` with AES-GCM (ECIES).
4. `bundle = {ct, iv, encShares[n], ephPubs[n]}`, and `receipt = SHA-256(canonical(bundle))`.

Because each ballot has its own key, there is **no master key and no "dealer"**. No single person, the server included, can read a ballot. It takes k committee members working together, and the server only accepts their shares once the question is closed.

**5.3 Tally:** rebuild `K` from k shares, decrypt, validate the choice against the options (if invalid, count it as *nevažeći*), and count. The code is a single module shared by the browser and the server.

**5.4 Receipts:** the receipt is computed in the browser and never sent by email at vote time. The sealed PDF lists every receipt for each question, so a voter finds their own, and the count of receipts must equal the count of `participation` rows.

**5.5 Sealing methods.** The host picks one for each skupština. All three seal the **same zapisnik PDF**, and all need k committee signatures.

| Method | How each committee member signs | Legal weight | Cost |
|---|---|---|---|
| `certilia_app` | Download the PDF, sign it in the Certilia mobile app or websign.certilia.com, upload it back. Members sign one after another. | QES (eIDAS) | €9.29 cloud certificate per signer |
| `certilia_api` | Click *Potpiši* (Sign) in our app, which calls the Certilia eSign API and approves on the phone | QES (eIDAS) | from €1,061.78 a year for the udruga, plus the signer certificates |
| `own_keys` | Click *Potpiši*. The browser signs SHA-256(PDF) with the ECDSA key from the key ceremony. | None. Verifiers must trust the app's key list. | Free |

The `certilia_api` option only appears when its environment variables are set. Its integration is designed after the M0 trial, because AKD doesn't publish the API.

**Checking a Certilia-signed PDF (both Certilia methods, server side):**
- The new file must **start with the exact bytes of the previous version**. PDF signatures are incremental updates, so a single prefix comparison proves nothing earlier was changed.
- The newest CMS signature must verify (pkijs).
- The signer certificate's `serialNumber` must contain the OIB of a committee member who has not signed yet. The OIB comes from the `member` row, so Okta-only users work too. Croatian qualified certificates are expected to use `PNOHR-<OIB>`. **⚠ Confirm this with a real Certilia certificate in M0.**
- Shortcut: full EU Trusted List chain validation is left to Adobe Reader or EU DSS on the recipient's side. Upgrade to an EU DSS sidecar container if the app itself must give the legal verdict.

**own_keys:** the server checks each ECDSA signature against that member's `signPublicKey`. The sealed bundle is the PDF plus `.sig.json` (`{pdfSha256, signatures[{name, publicKeyJwk, sig}]}`), and `/verify` repeats the check in the browser.

**Limits to state openly in the app's documentation**
- **Unlinkability depends on trusting the server operator.** Ballots carry no voter ID or timestamp, but the operator can see which HTTP request delivered which ciphertext. Fixing that needs mixnets or blind signatures, which this plan doesn't include.
- Browser-side crypto is only as trustworthy as the JavaScript the server delivers. A strict CSP, Subresource Integrity (SRI) and a published build hash reduce that risk but don't remove it. Every web voting system has this limit.
- If k committee members collude, they can decrypt early. That is inherent to threshold schemes, so pick the committee accordingly.

---

## 6. Security and privacy checklist
- Authorization is checked inside **every** server action (host of *this* skupština, committee of *this* skupština, and so on), never only in the UI.
- Join codes are 8 alphanumeric characters and entry is rate-limited. Guests can't vote, and the vote server action checks `member.votingRight`, not the UI.
- Better Auth's built-in rate limiting is on. Cookies are secure and HttpOnly. HTTPS is terminated at the reverse proxy.
- zod validates all input. The `ballot` table is insert-only, and so is `audit_log`.
- GDPR: a privacy notice on the join and guest pages, guest PII deleted N months after sealing, OIB stored only in `member`/`user`.
- Back up the Postgres volume, and test the restore.

## 7. Docker

- **Dockerfile** (multi-stage, `oven/bun:1`): install with `bun install --frozen-lockfile`, build with `next build` (`output: "standalone"`), and run on `oven/bun:1-slim` as a non-root user. The start command is `bun scripts/migrate.ts && bun server.js`. The migrations use drizzle-orm's `migrate()`, not drizzle-kit.
  - Risk: Next standalone on the Bun runtime. If anything breaks, change only the run stage to `node:22-alpine`. Bun stays the package manager.
- **docker-compose.yml:** `db` (postgres:17-alpine, volume, `pg_isready` healthcheck); `app` (depends on `db` being healthy, `env_file: .env`, port 3000, healthcheck); `mailpit` (dev profile only, catches all mail on port 8025).
- **.env.example:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OKTA_ISSUER/CLIENT_ID/CLIENT_SECRET/ADMIN_GROUP`, `CERTILIA_DISCOVERY_URL/CLIENT_ID/CLIENT_SECRET`, `CERTILIA_ESIGN_*` (after M0), `SMTP_URL`, `MAIL_FROM`. A login button or sealing method appears only when its environment variables are set.
- TLS and the reverse proxy are your existing setup. OIDC callbacks need HTTPS in production.

## 8. Milestones

| # | Scope | Done when |
|---|---|---|
| M0 | **Spikes** (1–2 days): register at developer.certilia.com and record the discovery URL, claim names and **whether email is returned**; sign a test PDF in the Certilia app and inspect the certificate subject; start the eSign API trial and get its docs; set up an Okta dev org with a groups claim | The answers are written down and the unknowns marked ⚠ in this plan are settled |
| M1 | Skeleton: Next + shadcn + next-intl (hr/en) + Better Auth (Okta, Certilia, email OTP) + Drizzle/Postgres + Docker Compose | `docker compose up` gives a working login in both languages |
| M2 | Member CSV import, skupština + agenda + questions, join code, attendance, guests (watch only), quorum | The host sees attendees and the quorum live |
| M3 | Key ceremony, ballot encryption, participation, receipts | A full vote is stored encrypted, with one vote per person enforced |
| M4 | Share submission, tally, public/restricted results, zapisnik PDF, sealing with `own_keys` and `certilia_app`, emails | A whole skupština runs end to end and voters receive the sealed PDF |
| M5 | `certilia_api` sealing, built from the M0 trial docs | A committee member signs from inside the app |
| M6 | Hardening: audit log, CSP and SRI, rate limits, GDPR cleanup job, `bun test` crypto round trip (encrypt N, decrypt with k of n, check tally and invalid ballots) plus a signature check for each method, one Playwright happy path | The tests pass and the Docker production image is built |

## 9. Decisions

Decided on 2026-11-07:
1. **Tenancy:** one udruga per deployment, with one compose stack per udruga.
2. **Results:** ballots are always secret. Each question is either **public** (final counts shown to all attendees) or **restricted** (counts shown only to the host and committee).
3. **Guests:** watch only. They never vote and don't count toward the quorum.
4. **Sealing:** all three methods are built (`certilia_app`, `certilia_api`, `own_keys`), and the host picks one for each skupština.

Defaults in this plan unless you change them:
- The zapisnik always contains all counts, even for restricted questions, because it is the legal record (§4.7).
- The sealed PDF is emailed to voters and the host. Guests don't receive it, since they didn't vote.
- The zapisnik is in Croatian only. The UI and emails are in hr and en.
- Polling instead of websockets.
- Committee of 3 with k = 2.
