# Email

Transactional email through Resend. Production sender:
**`customercare@intimatebunnie.com`**.

Customers only ever see `customercare@intimatebunnie.com`. Inbound mail to it is
forwarded by Cloudflare Email Routing to the staffed mailbox
`yowens@yoassoc.com`, and replies are sent back out _as_ `customercare` through
Resend's SMTP relay. The staff address is never exposed.

Email is the one output nobody can hotfix. Once it is in an inbox it is there —
which is why the deliverability setup below matters more than the templates.

---

## Domain authentication

Nothing else matters if this is wrong. An unauthenticated domain sending
transactional mail lands in spam, and a password reset in spam is a locked-out
customer who blames the shop.

DNS records on `intimatebunnie.com`:

| Type  | Name                 | Value                                                                | Cloudflare proxy |
| ----- | -------------------- | -------------------------------------------------------------------- | ---------------- |
| TXT   | `intimatebunnie.com` | `v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all` | —                |
| CNAME | `resend._domainkey`  | from the Resend dashboard                                            | **DNS only**     |
| TXT   | `_dmarc`             | `v=DMARC1; p=quarantine; rua=mailto:dmarc@intimatebunnie.com`        | —                |
| MX    | `intimatebunnie.com` | `route1/2/3.mx.cloudflare.net` — added by Email Routing              | —                |

**One SPF record, both includes.** Cloudflare Email Routing adds its own SPF
when it is enabled; Resend asks for another. Two `v=spf1` TXT records on the
same name is a permanent error and counts as no SPF at all — merge them into the
single record above.

**The DKIM CNAME must be DNS-only, not proxied.** Proxying hides the value behind
Cloudflare's IPs, DKIM verification fails, and everything lands in spam. This is
the single most common mistake in this setup.

### SPF

`~all` (softfail), not `-all` (hardfail). A hardfail means any forwarded message
— a customer forwarding a receipt to a partner — is rejected outright rather than
merely marked. Move to `-all` only after months of clean DMARC reports.

If `yoassoc.com` already sends mail from elsewhere, **merge into one record**.
Two SPF records is a permanent error and is treated as no SPF at all:

```
v=spf1 include:_spf.google.com include:_spf.resend.com ~all
```

### DMARC

Start at `p=none` for two weeks and read the aggregate reports. They will show
senders you did not know about. Move to `p=quarantine` once the picture is
clean, and `p=reject` a month after that.

Verify before launch:

```bash
dig TXT intimatebunnie.com +short
dig MX intimatebunnie.com +short
dig CNAME resend._domainkey.intimatebunnie.com +short
dig TXT _dmarc.intimatebunnie.com +short
```

Then send one message to a Gmail address and check **Show original** for
`SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. All three, or it is not done.

---

## Configuration

```bash
RESEND_API_KEY=re_...
EMAIL_FROM="INTIMATE BUNNIE <customercare@intimatebunnie.com>"
EMAIL_REPLY_TO=customercare@intimatebunnie.com
RESEND_WEBHOOK_SECRET=whsec_...
```

`EMAIL_REPLY_TO` may equal the sender here precisely because `customercare@` is
a real, forwarded, monitored address rather than a no-reply. A customer who
replies and gets silence is a support failure that looks like being ignored.
`sendEmail` applies it to every send unless a caller overrides it.

---

## Inbound: receiving and replying

Cloudflare Email Routing (zone `intimatebunnie.com` → **Email → Email Routing**) does
the receiving; it cannot send. Sending as `customercare@` from the staff mailbox
goes through Resend's SMTP relay instead.

| Direction                                    | Path                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Customer → `customercare@intimatebunnie.com` | Cloudflare Email Routing → forwarded to `yowens@yoassoc.com`         |
| Staff reply → customer                       | Gmail "Send mail as" → `smtp.resend.com:587` → From: `customercare@` |
| App → customer                               | Resend API, `EMAIL_FROM`                                             |

Gmail SMTP settings for the send-as identity: host `smtp.resend.com`, port
`587`, username `resend`, password the `RESEND_API_KEY`, TLS. The destination
address `yowens@yoassoc.com` must confirm Cloudflare's verification email before
routing starts, and Gmail's own confirmation code arrives through that same
forward — so set up routing first, send-as second.

**Rotating `RESEND_API_KEY` breaks staff replies**, because the same key is the
SMTP password. Update it in Gmail's send-as settings at the same time as
`wrangler secret put`.

---

## What gets sent

| Trigger                    | Template                     | Timing                           |
| -------------------------- | ---------------------------- | -------------------------------- |
| Registration               | `verifyEmailTemplate`        | Immediate                        |
| Password reset             | `passwordResetTemplate`      | Immediate                        |
| Password changed           | `passwordChangedTemplate`    | Immediate                        |
| Klarna authorised          | `sendOrderConfirmation`      | Immediate, awaited               |
| Shipment created           | `sendShippingNotification`   | Immediate                        |
| Delivered                  | `sendDeliveryConfirmation`   | On carrier update                |
| Cancelled                  | `sendCancellationEmail`      | Immediate                        |
| Refunded                   | `sendRefundEmail`            | After the Klarna refund confirms |
| Return received / approved | `sendReturn*Email`           | On status change                 |
| Newsletter signup          | `sendNewsletterConfirmation` | Immediate, double opt-in         |

The order confirmation is **awaited**, not fired and forgotten. An isolate that
returns before its promises settle is frozen mid-send, and the receipt is simply
lost. A failure only logs — the customer is already committed and the caller must
still succeed.

---

## Retries and the queue

Transactional sends go through the `email.send` job kind on a **separate
Cloudflare Queue** from everything else. A ten-thousand-row product import must
not delay a password reset by twenty minutes.

Retries are the queue's: exponential backoff with jitter, five attempts, then
`JobStatus.DEAD` where a human can see it in `/admin/jobs`. The jitter is not
decoration — a Resend outage takes every queued email with it, and without jitter
all of them retry in the same second and knock it over again the moment it
recovers.

**What is not retried:** a `422` from Resend. An invalid address fails
identically forever, and retrying it five times only delays telling somebody.

---

## Bounces and complaints

Point a Resend webhook at `/api/webhooks/resend`, signed with Svix and verified
against `RESEND_WEBHOOK_SECRET`.

| Event                  | Action                                                  |
| ---------------------- | ------------------------------------------------------- |
| `email.bounced` (hard) | Mark the address undeliverable. Stop sending.           |
| `email.bounced` (soft) | Log. Three in seven days → treat as hard.               |
| `email.complained`     | Unsubscribe from marketing immediately and permanently. |
| `email.delivered`      | Record, for the delivery-rate metric.                   |

**A complaint is permanent.** Someone who pressed "report spam" must never
receive marketing again, regardless of what any preference screen says.
Transactional mail about an order they placed is a separate judgement — a receipt
for a purchase is not marketing.

Continuing to send to a hard-bounced address is the fastest way to destroy a
sending reputation, and reputation is shared across the whole domain.

---

## Newsletter

**Double opt-in, always.** The row is created unconfirmed and nothing is sent
until the confirmation link is clicked. Single opt-in makes the list an open
relay for harassment — anyone can subscribe anyone else — and for a shop like
this one, an unsolicited email is a genuine harm rather than an annoyance.

Every marketing email carries a one-click unsubscribe:

```
List-Unsubscribe: <https://example.com/newsletter/unsubscribe?token=...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Both headers. Gmail and Yahoo require them for bulk senders, and without them
the alternative is people using the spam button as an unsubscribe — which costs
reputation rather than a list entry.

---

## Templates

Plain template strings in [`src/emails/`](../src/emails/) and
[`email.service.ts`](../src/services/email.service.ts), not React Email. These
are table-based layouts with inline styles because that is what Outlook and
Gmail require, and a component renderer buys nothing when the output has to look
like 2003 HTML anyway.

### Rules

- **Tables, not flexbox or grid.** Desktop Outlook renders with Word's engine
  and silently ignores modern layout.
- **Inline styles.** `<style>` blocks are stripped by several clients.
- **Every dynamic value escaped.** A first name is user input, stored and
  replayed into every email that account ever receives.
- **Always a plain-text part.** A multipart message with no `text/plain`
  alternative scores badly with every major spam filter.
- **Subject under 70 characters**, and it must survive being read on a lock
  screen. This shop ships discreetly; that promise applies to the subject line
  as much as to the packaging.

`tests/email-templates.test.ts` asserts all of these.

### Versioning

Templates are code, so their history is the git log. Every send records the
template name and the deployed `SENTRY_RELEASE` on the `EMAIL_SENT` order event,
which makes "what exactly did this customer receive on the 3rd" answerable by
checking out that commit.

Preview a change without sending:

```bash
npx tsx -e "import('./src/emails/auth').then(m => \
  console.log(m.passwordResetTemplate('https://example.com/x', 'Ada').html))" > /tmp/preview.html
```

Then check it in Litmus or Email on Acid before it reaches anyone. Gmail, Apple
Mail and Outlook are the three that matter.

---

## Monitoring

Watch in the Resend dashboard:

- **Delivery rate** — below 95% means an authentication or reputation problem
- **Bounce rate** — above 2% is a list-hygiene problem
- **Complaint rate** — above 0.1% will get the domain throttled

Also worth an alert: **zero sends in an hour** during business hours. Total
silence is the failure nobody notices, because nothing is broken on screen.

---

## Development

With `RESEND_API_KEY` unset, `sendEmail` logs the recipient and subject and
returns `{ ok: false }`. Nothing is sent, nothing throws, and the flow that
triggered it is fully exercised.

To send for real from a development machine, use Resend's test address
(`delivered@resend.dev`) rather than a colleague's inbox — it exercises the whole
path without adding a real recipient to your sending history.
