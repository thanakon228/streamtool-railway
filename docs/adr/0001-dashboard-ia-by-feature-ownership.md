---
status: accepted
---

# Dashboard IA groups config by feature ownership, not by render location

## Context

The dashboard had grown to 6 tabs that were hard to use: Goal config was split
from its display, the three test buttons (Alert / Chat / TTS) lived in three
different tabs, the "Overlay" tab was an 8-card grab-bag mixing audio (TTS) with
visuals (Template/Animation/CSS), and the "Platforms" tab mixed chat sources
(YouTube/TikTok/Twitch/Kick/Facebook) with donation sources
(Streamlabs/StreamElements). See [[../../CONTEXT.md]] for the resolved language.

## Decision

Reorganize into **5 tabs**, grouping every setting under the **feature it
belongs to**, not the place it renders:

- **Overview** — read-only live cockpit (Goal progress, recent Donations, live
  Chat feed, connection status). The one screen you watch while streaming.
- **Donations** — owns *everything about a Donation*: its sources (EasySlip,
  Streamlabs, StreamElements), Goal, history, test alert, **and the Alert's
  appearance (animation/position) + sound (TTS test/tier/status)**.
- **Chat** — owns *everything about Chat*: its sources (the five Platforms,
  absorbed from the old "Platforms" tab), chat-overlay layout, filter, test.
- **Overlay** — only **global** surface settings shared by all Widgets:
  Template, Custom CSS, and the consolidated OBS/Widget URLs.
- **Settings** — Server, Environment Variables, overlayId.

## Considered options

- **By workflow phase** (Setup / Live / Look) — rejected; the streamer prefers
  feature-noun grouping.
- **Leave alert appearance + TTS in the Overlay tab** (group by where it
  renders) — rejected. A Donation's look and sound are configured together with
  the rest of the Donation, so they live in Donations even though they render on
  the Overlay surface. This is the surprising part worth recording.

## Consequences

- The single `templateConfig` object (`template`, `alertAnimation`,
  `alertPosition`, `customCss`, `chatConfig`) is now edited from **three** tabs
  (Donations / Chat / Overlay). No API change is needed — `/api/template-config`
  already accepts partial updates; each tab POSTs only its own fields.
- This is a **frontend-only** restructure of `public/dashboard.html`.
- **Not yet implemented** — this ADR records the agreed plan; the dashboard is
  intentionally left unchanged for now.
