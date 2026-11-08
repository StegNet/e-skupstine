# e-Skupština

Online assembly sessions (*sjednice skupštine*) and encrypted voting for Croatian associations (*udruge*).
Next.js 16 · shadcn/ui · Better Auth · Drizzle + Postgres · Sentry · Docker. Node.js runs the app; Bun is the package
manager and test runner. UI in Croatian and English. Self-hosted: one deployment per udruga.

The design and the legal background (Zakon o udrugama) are in [PLAN.md](PLAN.md).

## How a session runs

1. **Admin** imports the member register (*popis članova*, CSV with OIB), creates a session and picks the host. Only an admin can let guests in.
2. **Host** prepares the agenda and votes (motions *Za/Protiv/Suzdržan* or elections, public or secret), sets quorum and majority rules, names the counting committee (*verifikacijsko povjerenstvo*, n members, k needed) and who of them signs the minutes, adds the video call link, confirms the statute allows electronic sessions, and emails invitations.
3. **Committee** members each create a key in their browser (downloaded as a file; the server only gets the public half).
4. The host opens the session. **Members** sign in with Certilia (matched by OIB) or Okta (matched by email) and join with the session code. **Guests** sign in with an emailed code and can only watch.
5. The host opens one vote at a time (only with quorum). Each ballot is encrypted in the voter's browser; the voter gets a receipt.
6. After a vote closes, at least k committee members submit their key shares, each re-counts in their own browser and confirms. Results are then shown to everyone (*public*) or only to the host and committee (*restricted*).
7. After closing, the app generates the **zapisnik** PDF (always with every count, and names on public votes). The committee seals it with k signatures, which must include every signer the statute names, and it is emailed to everyone who voted.

## Statut

The Zakon o udrugama leaves quorum, majorities, convening and voting to each udruga's statute, so those rules live in a
JSON file read when the app starts: `STATUT_FILE` if set, otherwise [statut.json](statut.json). The file in this
repository holds neutral defaults with the placeholder name "Udruga Primjer"; **write your own from your statute before
the first session**. With Docker Compose, edit `statut.json` and run `docker compose restart app`; with Swarm it is a
config (see below).

| Key | Meaning | Default | Typical statute wording |
| --- | --- | --- | --- |
| `name` | Full name, at the top of the zapisnik and invitations | Udruga Primjer | "Naziv Udruge glasi: …" |
| `noticeDays` | Invitations (with date, video link and proposed agenda) must go out at least this many days before the session | 8 | "Skupština se saziva najmanje 8 dana prije…" |
| `videoRequired` | No opening without a video call link | false | "…sredstava elektroničke komunikacije koja omogućuju istovremenu razmjenu slike i zvuka" → `true` |
| `quorumPercent` | Default quorum: more than this % of members with voting right present | 50 | "…ako je nazočna natpolovična većina članova" |
| `majority` | Default for new motions: `base` = `votes_cast`, `present` or `members`; `fraction` = `half` or `two_thirds` | present, half | "…većinom glasova nazočnih članova" |
| `secretBallotByDefault` | `false`: votes are public and names are published with choices, unless the host marks a question secret | false | "Glasovanje je javno. Skupština može odlučiti da se glasuje tajno." |
| `memberCategories` | Member category in the CSV → voting right, e.g. `{"redovni": true, "podupirući": false}`. When set, every member needs a known category | none (everyone votes unless `pravo_glasa` says otherwise) | "Redovni članovi imaju pravo glasa…" |
| `minutesSigners` | Committee roles that must sign the zapisnik: `chair`, `recorder`, `verifier` (repeat a role to need more) | chair, recorder | "Zapisnik potpisuju predsjedavajući i zapisničar (i dva ovjerovitelja)" |

Special majorities are chosen per question: statutes usually require *two thirds of all members* for dissolution or
merger and *more than half of all members* for statute changes. The app does not check that a secret vote was decided
by the assembly; the zapisnik records it as such.

## Run locally

Needs Bun (package manager, tests) and Node.js 24 (runs Next.js and the scripts).

```bash
bun install
bun run services        # Postgres, Mailpit (mail at http://localhost:8025), mock OIDC (http://localhost:8080)
bun run db:migrate
bun dev
```

`.env` for local development:

```bash
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=change-me-to-32-random-bytes
DATABASE_URL=postgres://eskupstina:eskupstina@localhost:5432/eskupstina
SMTP_URL=smtp://localhost:1025
MAIL_FROM="e-Skupština <noreply@localhost>"
CERTILIA_DISCOVERY_URL=http://localhost:8080/certilia/.well-known/openid-configuration
CERTILIA_CLIENT_ID=dev
CERTILIA_CLIENT_SECRET=dev
```

"Prijava s Certilia" then goes to the mock server: type an OIB such as `11111111119` as the user name (Certilia
sends the OIB as `sub`) and claims such as `{"name":"Ana Horvat","email":"ana@example.hr"}`. Make that person admin:

```bash
bun run make-admin 11111111119
```

## Deploy with Docker

```bash
cp .env.example .env    # fill it in
docker compose up -d --build
docker compose exec app node scripts/make-admin.mts <OIB or email>   # after that person signed in once
```

- The image runs on Node.js only; Bun is used during the build to install packages.
- Put it behind your HTTPS reverse proxy; `BETTER_AUTH_URL` must be the public https URL.
- Migrations run on every start. Back up the `pgdata` volume.
- Guest data: run `docker compose exec app node scripts/purge-guests.mts 90` weekly (deletes guests whose sessions were sealed more than 90 days ago). The Swarm stack does this by itself.

### Docker Swarm (with Traefik)

[docker-stack.yml](docker-stack.yml) runs Postgres (pinned to the manager, local volume), the app (behind Traefik,
rolling start-first updates with automatic rollback) and a weekly guest purge. It expects Traefik's swarm provider on
an external overlay network called `traefik`, with a default HTTPS entrypoint (the router only sets `Host()`).

Create the statute config once, from your own `statut.json`:

```bash
docker config create eskupstina_statut statut.json
```

Then deploy it as a Portainer stack or with `docker stack deploy --with-registry-auth -c docker-stack.yml eskupstina`,
with these variables:

| Variable | Example | Notes |
| --- | --- | --- |
| `STACK_NAME` | `eskupstina` | Traefik router and service name (default `eskupstina`) |
| `DOMAIN` | `glasanje.example.org` | public host; `BETTER_AUTH_URL` becomes `https://$DOMAIN` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | any characters; Postgres keeps the one it was first created with |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | |
| `SMTP_URL`, `MAIL_FROM` | `smtp://smtp-relay.gmail.com:587?requireTLS=true` | |
| `CERTILIA_DISCOVERY_URL`, `CERTILIA_CLIENT_ID`, `CERTILIA_CLIENT_SECRET` | | see Certilia below |
| `OKTA_*` | | optional |
| `CLIENT_IP_HEADER` | `cf-connecting-ip` | behind Cloudflare, so rate limits count per visitor; only if the server accepts traffic from Cloudflare alone |
| `IMAGE`, `TAG` | `ghcr.io/stegnet/e-skupstine`, `0.1.0` | default `latest` |
| `STATUT_CONFIG` | `eskupstina_statut` | configs are immutable: to change the rules, create `eskupstina_statut_2` and point this at it |
| `GUEST_RETENTION_DAYS` | `90` | for the weekly purge (Mondays 03:00 Zagreb time) |

Make the first admin, on the node running the app:
`docker exec -it $(docker ps -q -f name=eskupstina_app) node scripts/make-admin.mts <OIB or email>`.

### Certilia

Register the app at developer.certilia.com (free up to 100k logins/month), with redirect URI
`$BETTER_AUTH_URL/api/auth/callback/certilia` and the grant type `authorization_code`. Request OIB/PIN, first and last
name (mandatory), email and photo (optional). Set `CERTILIA_DISCOVERY_URL`
(`https://idp.certilia.com/oauth2/oidcdiscovery/.well-known/openid-configuration`), client ID and secret.
The app reads the profile from the verified ID token, where Certilia sends the OIB as the subject (`sub`), and stores
it as the account's subject ([src/lib/certilia.ts](src/lib/certilia.ts)). Certilia's userinfo endpoint is not used.
Without an email the user gets a placeholder `<oib>@certilia.invalid`, which is never mailed.

### Sentry (optional)

Set up like the Sentry Next.js wizard: [src/instrumentation-client.ts](src/instrumentation-client.ts),
[sentry.server.config.ts](sentry.server.config.ts), [sentry.edge.config.ts](sentry.edge.config.ts) and
`withSentryConfig` in [next.config.ts](next.config.ts). Logging is [LogTape](https://logtape.org)
(`getLogger(["e-skupstina", …])`) with a console sink and a Sentry sink.

| Variable | When | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | build | Sentry DSN (public); empty sends nothing |
| `SENTRY_ORG`, `SENTRY_PROJECT` | build | where source maps go (the org may stay empty with an organization token) |
| `SENTRY_AUTH_TOKEN` | build secret | source map upload |
| `VERSION`, `COMMIT_SHA` | build | release `e-skupstina@<version>` |

Sentry `environment` is derived at runtime from the hostname (`staging.*` → staging, `localhost` → development,
otherwise production), so one build serves every environment.

Ballot secrecy keeps a few things out: request bodies, cookies and query strings are not collected, stack-frame
variables are off (they would hold decrypted ballots during counting), Session Replay stops on the ballot and committee
pages, and logs never carry receipts, choices, OIBs or emails.

### Okta

Create an OIDC web app with redirect URI `$BETTER_AUTH_URL/api/auth/callback/okta` and set `OKTA_ISSUER`
(e.g. `https://<org>.okta.com/oauth2/default`), client ID and secret. Optional: add a `groups` claim to the **ID token**
and set `OKTA_ADMIN_GROUP`; members of that group become admins on each login.

## Security model

- **Ballots** are encrypted in the browser with a fresh AES-256-GCM key; that key is Shamir-split k-of-n and each share
  is encrypted (ECDH P-256 + HKDF) to one committee member. There is no master key; the server cannot read ballots,
  and accepts shares only after a vote closes. Secret ballots carry no voter ID or timestamp; public ballots carry the voter, so names can be published after counting. ([src/lib/ballot-crypto.ts](src/lib/ballot-crypto.ts))
- **Counting** happens on the server and again in each committee member's browser; k matching confirmations publish it.
- **Profile photos**: at each sign-in the server takes the Certilia photo if the person shared it, otherwise their
  Gravatar (looked up by the SHA-256 of their email), otherwise none (initials). The image is checked to be JPEG, PNG,
  GIF or WebP, stored in the database and served from `/api/avatar/<user>` to signed-in users only, so browsers never
  contact Certilia or Gravatar. ([src/lib/avatar.ts](src/lib/avatar.ts))
- **Receipts** (SHA-256 of the ballot) stay in the voter's browser and appear in the zapisnik appendix and on `/verify`.
- **Sealing**: `certilia_app` — members sign the PDF in the Certilia app (qualified signature) and upload it; the server
  checks the earlier version is unchanged, the CMS signature is valid and the certificate's OIB is the uploader's.
  Recipients validate the qualified chain in Adobe Reader or the EU DSS validator. `own_keys` — ECDSA signatures from
  the committee key files, checked on `/verify`; no legal weight.
- Pages run under a nonce-based CSP so only the app's own scripts can touch the ballot.

**Limits.** Unlinkability relies on trusting the server operator (they see which request delivered which ciphertext).
Browser crypto is only as trustworthy as the JavaScript served. k colluding committee members can decrypt early.

## Tests

```bash
bun test src                   # crypto, rules, OIB/CSV, photos, PDF signature checks, time zones
docker compose exec db createdb -U eskupstina eskupstina_test    # once
bun run test:flow              # full sessions against Postgres (wipes eskupstina_test), with tests/statut.test.json
```

## CI

Blacksmith runners. [ci.yml](.github/workflows/ci.yml) runs lint and types, unit tests and the Postgres flow tests
(2 vCPU each) on pushes to `main` and pull requests. [publish-image.yml](.github/workflows/publish-image.yml) runs on
`v*.*.*` tags (or by hand): builds the image on 8 vCPU, pushes `ghcr.io/<owner>/<repo>:<version>` and `:latest`, and
creates the GitHub release. It reads the repository variables `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
and the secret `SENTRY_AUTH_TOKEN`. The repository needs the Blacksmith GitHub app.

## Not done

- Sealing through the Certilia **eSign API** (button in the app): AKD does not publish the API; needs their trial docs.
- Proxy voting (*punomoć*), changing a vote, websockets (pages poll every 3 s).
