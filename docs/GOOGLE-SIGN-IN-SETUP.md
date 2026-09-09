# Turning on "Continue with Google"

The code is already there and switched off. It turns on when one environment
variable is set, and nothing about the site changes until then — no button, no
Google script loaded, and the sign-in route refuses.

## What you do, once

1. Go to **console.cloud.google.com** and create a project. Call it LocalLink.

2. **APIs & Services → Google Auth Platform**, and press **Get started**.
   (Google renamed this from "OAuth consent screen"; older guides, including an
   earlier version of this file, send you somewhere that no longer exists.
   Typing "Google Auth Platform" into the console's search bar is quicker than
   finding it in the menu.)

   The wizard is one page in four parts:
   - **App information** — App name: LocalLink. User support email: yours.
   - **Audience** — **External**
   - **Contact information** — your email
   - Agree, then **Create**

   You do NOT need to submit for verification. That is only for sensitive
   scopes, and signing in uses none.

3. Left menu → **Clients** → **Create client**
   - Application type: **Web application**
   - Name: LocalLink web

4. Under **Authorised JavaScript origins**, add both:
   - `https://localnetlink.com`
   - `http://localhost:5175`

   No redirect URIs are needed. This flow never leaves the page.

5. Copy the **Client ID**. It looks like
   `799061701030-abc123.apps.googleusercontent.com`.

## What turns it on

Set one variable, in Railway for production and in `.env` locally:

    GOOGLE_CLIENT_ID=799061701030-abc123.apps.googleusercontent.com

Restart. The button appears. Remove it and the button disappears again.

There is no client SECRET here on purpose. This flow does not use one — the
security comes from the origins list above, which is why step 4 matters and why
a stolen client id is not worth anything on another domain.

## What happens for each kind of person

**Returning, already linked** — one tap, straight in.

**Already has a LocalLink password account on the same address** — linked to
that account automatically, keeping their hours, certificates and history. Only
ever when Google says the address is verified; otherwise somebody could claim a
stranger's record by adding their address to a Google account.

**Brand new** — one short screen: volunteer or organization, and the year they
were born. Both are needed and Google cannot tell us either: the year is the
13+ floor and the 18+ gate on adults-only events. Their name comes from Google,
so the certificate has a real name from the start, and no password is set.

## Why this is worth doing

Not the password. It is that Google tells us the address is real, so nobody has
to go and find our verification email — which currently fails DMARC and may not
arrive at all. For somebody standing at an event who has just scanned a code,
"check your inbox" is where we lose them.

It does not replace fixing DMARC. Password signups, hour confirmations and the
attendance emails all still depend on our own mail working.
