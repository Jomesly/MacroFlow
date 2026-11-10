# Product screenshots

Refreshed November 11, 2026 from application commit `73434b4` using the repository's Playwright workflow against a local development server.

| Images | Data and capture |
| --- | --- |
| Dashboard, mobile dashboard, market analysis | All 12 markets scored through `scoreMacroAlignment` with synthetic timestamped macro inputs. Calendar and market context use browser fixtures; sample headlines are labeled. |
| Journal, mobile journal, history, MT5 connection | Disposable local Supabase accounts and synthetic trades from the responsive journal test. No MT5 key was generated. |
| Analytics | Deterministic synthetic trade records from the journal dashboard test. Charts illustrate the interface, not forecast accuracy or actual trading returns. |
| Signup | Empty local signup form; no identity or password entered. |

Desktop captures use a 1440-pixel viewport; mobile captures use 375 pixels. Browser PNG captures are encoded as WebP without changing interface content. Development overlays are hidden during capture.

Live/source labels describe the application's response mode in these fixtures. They do not make the pictured readings live market data. The local ingest address in the MT5 screenshot is an example, not the hosted application's endpoint.

Only reviewed image files belong in this directory. Keep raw captures, authentication state, local service configuration, private journal exports, and research datasets outside version control.
