# Publishing HST to the app stores

The app is already a **PWA**: installable from the browser on Android and iOS with
no store involvement, no review, and no developer fees. For many uses that is
enough. Read this before deciding you need a store listing.

## Option A — PWA (works today, free)

Deploy to Vercel and share the URL.

- **Android / Chrome:** an "Install app" prompt appears automatically.
- **iOS / Safari:** Share → *Add to Home Screen*.

The result launches full-screen with its own icon, works offline for previously
viewed content, and updates the instant you deploy. No store account needed.

**iOS caveats:** installation is manual (Safari shows no prompt), push
notifications need iOS 16.4+, and Safari evicts the cache after ~7 days of
non-use.

## Option B — native store listing (Capacitor)

Wraps the same build in a native shell. `capacitor.config.json` is already here.

    npm install @capacitor/core @capacitor/cli
    npx cap init          # config values are pre-filled
    npm run build
    npx cap add android   # and/or: npx cap add ios
    npx cap open android  # opens Android Studio

Re-run `npm run build && npx cap sync` after every code change.

### What this genuinely requires — beyond the code

| | Google Play | Apple App Store |
|---|---|---|
| Developer account | $25 once | $99/year |
| Build machine | any OS | **macOS + Xcode required** |
| Review time | hours–days | days, rejections common |
| Privacy policy | required | required |
| Data-safety disclosure | required | required |

**Apple rejects thin web wrappers** under guideline 4.2 ("Minimum
Functionality"). A wrapper that only loads a website will be rejected. To pass,
add capability the browser cannot offer — barcode **camera scanning** is the
obvious and genuinely useful one here, and it fits the product:

    npm install @capacitor-community/barcode-scanner

The scan input already accepts barcodes, so wiring a camera scan into it is a
small change and turns the app into something a store reviewer will accept.

### Also required before submission
- **Privacy policy URL.** The app sends product names to Open Food Facts and
  writes scan results to a public GitHub repository — both must be disclosed.
- **Health-claim caution.** Store review is sensitive about health claims. Keep
  the existing "educational purposes only" framing prominent, and do not present
  the analysis as medical or dietary advice.
- **Store assets:** screenshots at several device sizes, feature graphic
  (Play), description, category, content rating questionnaire.

## Recommendation

Ship the PWA now — it costs nothing and validates whether people use the thing.
Add barcode camera scanning next, because it improves the app on every platform
*and* is what makes an iOS submission viable. Only then take on the store
accounts, the macOS build requirement, and the review cycles.

---

# Charging for Enhanced analysis

The app now shows a $2/week plan dialog before enabling Enhanced. **That dialog
is a UI flow, not billing.** Accepting it sets a variable in the browser. No
money moves, and anyone can bypass it from the developer console. Three things
must be added before you can charge:

### 1. A payment provider
[Stripe](https://stripe.com) is the usual choice for the web (~2.9% + 30¢ per
transaction). At $2/week, roughly 36¢ per month per subscriber goes to fees, so
weekly billing is expensive at this price point — consider $8/month instead,
which cuts the fee share by about a quarter.

Flow: add `/api/checkout` to create a Stripe Checkout session, redirect the user
there, and handle the `checkout.session.completed` webhook at `/api/webhook`.

### 2. Server-side entitlement
`subscribed` is deliberately session-only React state, and it must stay that
way. Persisting a paid flag in the browser (localStorage, a cookie) is trivially
forged. The real check belongs on the server: `/api/claude` should verify the
caller has an active subscription before forwarding to Anthropic. Otherwise the
expensive endpoint is open to anyone who calls it directly, whatever the UI shows.

That requires user accounts — there is currently no concept of a user, so
sign-in has to come first ([Clerk](https://clerk.com) or
[Supabase Auth](https://supabase.com/auth) both have free tiers).

### 3. Store rules, if you publish natively
Apple and Google **require their in-app purchase systems** for digital
subscriptions and take 15–30%. A Stripe link inside an iOS app is grounds for
rejection. If you go the store route, the payment integration is different code
from the web one — plan for both.

### Order of work
1. Sign-in (no entitlement is possible without identity)
2. Stripe Checkout + webhook
3. Subscription check inside `/api/claude`
4. Only then remove the "Demonstration only" line from the plan dialog

Until step 4, leave that disclaimer in place — showing a price and taking no
payment is fine, but implying a charge that never happens is not.
