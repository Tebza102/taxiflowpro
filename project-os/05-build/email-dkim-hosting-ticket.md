# Absolute Hosting ticket: DKIM failure on relayed platform mail (DRAFT, not sent)

Status: **draft prepared 2026-10-11; Tebogo sends it.** No passwords, tokens, links or recipient addresses are included.

---

**Subject:** DKIM for taxiflow.co.za fails on mail relayed through antispam.co.za (cPanel account taxiflowco, server cp24-jhb.za-dns.com)

Hello,

Mail sent from `notifications@taxiflow.co.za` through authenticated SMTP on `cp24-jhb.za-dns.com:465` reaches Gmail with **DKIM `d=taxiflow.co.za` = fail**. SPF and DMARC pass, but the messages land in Spam. Mail sent from the same domain through webmail passes DKIM. Could you please check the outbound relay?

**Failing message** (password-reset email from our application, Sunday 11 Oct 2026):
- Submitted by authenticated SMTP to cp24-jhb.za-dns.com at 16:14:51 +0200, Exim id `1xFuKB-00000000e61-16yA`, envelope-from `notifications@taxiflow.co.za`.
- Relayed by `server13.antispam.co.za`, Exim id `1xFuKB-002bmI-N8`, delivered to Gmail from `za-outgoing-13-6.antispam.co.za` (164.160.88.223).
- Gmail Authentication-Results:
  - `dkim=fail header.i=@taxiflow.co.za header.s=default header.b=ht6M90iJ`
  - `dkim=pass header.i=@out.zamailgate.com header.s=default`
  - `spf=pass` (164.160.88.223)
  - `dmarc=pass (p=NONE)`, aligned through SPF only
- The `d=taxiflow.co.za` signature's `h=` list includes `Message-ID`.
- The only Message-ID in the delivered message is `<E1xFuKB-002bmI-N8@server13.antispam.co.za>`. It carries the relay's own queue id.

**Passing message** (same account, same server):
- `support@taxiflow.co.za` to the same external Gmail mailbox, sent from webmail at 02:54 +0200, Exim id `1xFhpj-0000000CFIh-3vXH`, relayed by `delivery.antispam.co.za`.
- Gmail reported SPF, DKIM (`taxiflow.co.za`) and DMARC all pass.

**What we can see:**
- The cPanel signature on the failing message was made before the relay added its Message-ID. The relay's own signature, which covers that Message-ID, passes.

**Our hypothesis (not confirmed):**
- The relay adds the Message-ID after cPanel has signed, which breaks the `taxiflow.co.za` signature. Our application's mail provider submits without a Message-ID; webmail includes one, which would explain why webmail passes.
- We cannot rule out another change to the message body or headers on the way.

**Questions:**
1. Can you confirm whether `server13.antispam.co.za` or `delivery.antispam.co.za` adds or changes headers (Message-ID or others) after the cPanel DKIM signature?
2. If so, can Exim on cp24-jhb add a Message-ID **before** DKIM signing for authenticated submissions, or can the relay sign or preserve `taxiflow.co.za` DKIM?
3. Is there anything else we should change on our side? We are not changing provider or DNS for now.

We can resend a test message on request.

Thank you,
Tebogo
TaxiFlow (cPanel account taxiflowco)

---

Internal notes (do not send):
- **Evidence sources:** the failing message's headers (Gmail "Show original", pasted by Tebogo; body and link excluded); E1 Exim id from cPanel Track Delivery; the E1 pass is Tebogo's Gmail check (raw E1 headers were not recorded).
- **After the host's reply:** send one recovery email to the external mailbox and confirm `dkim=pass header.i=@taxiflow.co.za`. Only then mark checklist row 12 DKIM as passed.
