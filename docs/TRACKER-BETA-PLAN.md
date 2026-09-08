# Tracker beta — the redesign

## The mistake in v1

v1 copied the paper form: the student writes a claim, names a supervisor, the
supervisor signs. That inherits the paper form's friction *and* its fraud model.
Oak Lawn Community High School: 47 students, forged signatures, and a student
running a market selling a local golf course's signature.

But LocalLink knows something paper never does: **who ran the event, and who
signed up.** For hours done through us, nobody should have to type anything.

## Three lanes, by how much we already know

### Lane A — a LocalLink event  (default; near-zero friction both sides)
We know the host account, the date, the advertised length, and the roster.
The day after the event, the host gets **one** email: "Who came on Saturday?"
with a checklist. One click confirms everyone.

- Student types: **nothing**
- Organization does: **one email, one click, for the whole event**
- Fraud resistance: **highest** — the student never names the approver, so
  there is nothing to forge

This replaces 12 emails after a Saturday event with 1.

### Lane B — outside volunteering, an organization email
Student names a supervisor. The address is at a real organization domain.
This is exactly what schools already accept: Greenwich HS asks for
"supervisor name and an email address at which to contact them", and accepts
"emails sent to the student from an official organization email
(ie not a personal email account)".

### Lane C — outside volunteering, a personal email
Still allowed, still counts, **labelled honestly on the record**.

## Verification is a signal, not a gate

x2VOL — the platform most US districts use — keeps verification and approval
independent: if the activity contact never answers, the hours are not dead, the
school still decides. v1 made a silent supervisor a permanent dead end. It must
not be.

## The certificate prints the evidence

Every line names **how** it was confirmed and **by which address**:

> Arm in Arm · confirmed by the organization on LocalLink
> Somerset Shelter · confirmed by dana@somersetshelter.org
> Neighbourhood clean-up · confirmed by dana.reed@gmail.com

A teacher can email that person. This makes the trust tier self-evident without
an admin list, and it is the single highest-value anti-fraud change available:
it costs students and nonprofits nothing.

## Fixes carried from the council

**Credibility**
1. The certificate prints `username` — there is no real-name field at all. A
   record reading `jsmith2027` is worth nothing to a school.
2. Self-approval is a plain string compare, so `you+x@gmail.com` and dotted
   Gmail aliases pass. Normalise before comparing.
3. The "confirmed organization" tier is keyed on a *typed* name, so typing a
   confirmed charity's name buys the top tier. Tie trust to the LocalLink host
   account and the email domain — things a student cannot type.
4. `approverEmail` is collected but never reaches the certificate.
5. Certificates snapshot an editable username, so rename → issue → rename back
   launders a record into a classmate's name.
6. No rate limit and no daily ceiling on logging.

**Will simply fail in the field**
7. `EMAIL_FROM` defaults to a gmail.com address relayed through Brevo. DMARC
   fails; the whole tracker rests on that email arriving.
8. A wrong recipient pressing "they did not volunteer with us" kills the entry
   permanently — cannot delete, cannot re-log, no appeal.
9. All four tracker pages omit the `pb-24` every other page has, so the fixed
   bottom nav covers the supervisor's confirm button.
10. Form labels have no `htmlFor`/`id`.
11. The approver email is already known for LocalLink events and is not
    prefilled.

## Beta, not stone
Tuned to one community. Everything here is meant to be changed once real
organizations and real students touch it.
