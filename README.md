# Commodity Radar

Build "Commodity Radar", a personal, mobile-first, dark trading-terminal style dashboard for one trader (based in Dubai, UTC+4) who trades CFDs on Plus500 using Smart Money Concepts / price action. Instruments, in priority order: 1) WTI crude oil, 2) Silver, 3) Gold. Always show WTI first. Budget is FREE ONLY: use only free, no-key data sources. All times shown in Dubai time (Asia/Dubai). Use Lovable Cloud (database + edge functions + scheduled jobs) and Lovable AI for sentiment.

## 1. Price data (free)
- Use the free Yahoo Finance chart endpoint from edge functions (no key): https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=...&range=... with symbols CL=F (WTI), SI=F (Silver), GC=F (Gold). Add a browser-like User-Agent header and fall back to query2.finance.yahoo.com if query1 fails.
- Store candles in the database (instrument, timeframe, ts UTC, open, high, low, close, volume). Upsert, no duplicates.
- Scheduled polling with an adaptive schedule to stay light: every 2 minutes during "hot windows" (30 min before to 60 min after each session open/close and each scheduled report listed below), otherwise every 15 minutes. Pause when the market is closed (weekend: Fri 17:00 New York to Sun 18:00 New York).
- Show a "last updated / data may be delayed up to ~10–15 min" badge.

## 2. Dashboard (home)
For each instrument a card with: last price, change since daily open, sparkline, trend on 15m / 1h / 4h / Daily (up/down/sideways using EMA 20/50 and higher-highs/lower-lows), current session (Asia / London / New York / overlap), session ranges today (Asia high/low, London high/low), previous day high/low, and flags when price sweeps a previous session's high or low (liquidity sweep) and then closes back inside (possible reversal) or breaks and holds (break of structure). A tap opens a detail page with a candlestick chart (lightweight-charts library), session shading, and these levels drawn.

## 3. Session pattern engine + backtest (very important)
The trader's hypothesis: "The US session usually repeats/continues the trend set by the London session, often with larger size. Asia is slower. Around market opens and closes there are sudden surges or drops."
- On first run, backfill ~2 years of 1h candles (range=730d, interval=60m) for all 3 instruments.
- Define sessions with real time zones (handle DST): Asia = 18:00 New York previous day to 08:00 London; London = 08:00–16:30 London time; New York = 08:00–17:00 New York time.
- For every trading day compute: London move = London open → New York open (direction + size); NY move = New York open → New York close; did NY continue London's direction? Ratio of NY size to London size. Also Asia range vs London range vs NY range.
- Open/close volatility: average absolute move in the first hour after each session open and the last hour before each close, compared to an average hour. Also the Sunday/weekly open gap.
- "Pattern Stats" page: for each instrument show hit rate of "NY continues London" (all days, last 20, last 60, by weekday), and conditional versions: when London moved more than 1x its average, when London swept the Asia high/low first. Show sample sizes. Include simple charts. Recompute daily after NY close.
- Live use: when London has set a clear direction by the New York open, generate a "Session heads-up" using the historical conditional hit rate.

## 4. News + sentiment (free)
- Edge function every 15 min fetching free RSS: Google News RSS searches ("crude oil", "WTI", "OPEC", "Strait of Hormuz", "silver price", "gold price", "Federal Reserve"), plus OilPrice.com, FXStreet and Kitco RSS feeds if reachable. Deduplicate by URL/title.
- Use Lovable AI to tag each headline: instruments affected, bullish/bearish/neutral per instrument, impact 1–5, one-line reason. Store results.
- News feed page with filters per instrument, plus a rolling sentiment gauge (last 6h / 24h) on each dashboard card.
- No Twitter/X (not free). Leave a note in the code where a social feed could be added later.

## 5. Scheduled reports & events calendar
- Recurring events (store in a table, editable in the UI): API weekly crude inventory (Tue 16:30 New York), EIA Weekly Petroleum Status Report (Wed 10:30 New York), EIA natural gas storage (Thu 10:30 NY, context only), Baker Hughes rig count (Fri 13:00 NY), US CPI, Nonfarm Payrolls (first Friday 08:30 NY), FOMC decisions. Let the user add/edit dates manually and add a field for consensus/previous/actual that can be typed in manually.
- Each upcoming event card: countdown, which instruments it affects, news sentiment going into it, and "historical reaction": from stored 1h candles, the average and typical direction of the move in the 1h and 3h after the last ~50 occurrences of that event (e.g. WTI after EIA Wednesdays), and if actual vs consensus was entered, split by surprise direction.
- Add an "Expected after the report" box combining these into a plain-language heads-up.

## 6. Market Bias heads-up
Per instrument a composite "Bias" (Bullish / Bearish / Neutral with a 0–100 confidence) combining: multi-timeframe trend, session pattern conditional stats, news sentiment, and nearby high-impact events. Show the breakdown of each component so it's explainable. Label clearly: "Probabilistic heads-up, not financial advice."

## 7. Alerts via WhatsApp (free, personal)
- Use CallMeBot free WhatsApp API (https://api.callmebot.com/whatsapp.php?phone=...&text=...&apikey=...) to send alerts to the trader's own number. Store phone and API key as secrets (CALLMEBOT_PHONE, CALLMEBOT_APIKEY); include a Settings page with setup instructions (the user must message the CallMeBot number once to get the key) and a "Send test alert" button.
- Alert types (each toggleable per instrument): session heads-up at NY open (London direction + hit rate), liquidity sweep / break of structure on 15m/1h at session opens, sudden move (> X× average hourly range within 15 min, X configurable, default 1.5), 30-min pre-report reminder with expected reaction, post-report reaction summary, strong news (impact ≥4), bias flip.
- Cooldowns to prevent spam (default: max 1 alert of the same type per instrument per 60 min) and quiet hours setting. Keep messages short, phone-friendly, with emojis for direction, e.g. "🛢 WTI | NY open | London ↑ +0.9% | NY continued London 66% (n=58) | News 70% bullish | Bias: Bullish 64".
- Alert history page.

## Access
Single user. Protect the app with simple email login (Lovable Cloud auth); no public sign-ups beyond the first account if possible.

## Design
Dark, clean, mobile-first (used mainly on a phone), green/red for direction, compact cards, bottom tab navigation: Dashboard, Patterns, Events, News, Alerts/Settings. Fast to read at a glance.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bd3aeec6-5966-4372-a346-03f40ccc2963).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
