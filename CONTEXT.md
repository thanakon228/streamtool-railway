# StreamTool

Dashboard + OBS overlay that ingests live **chat** and **donations** from
multiple streaming services and renders alerts, a chat feed, and a goal bar
for a single streamer.

## Language

### Sources

**Platform**:
A live-streaming service the streamer connects to pull **viewer chat** from.
The five are YouTube, TikTok, Twitch, Kick, Facebook. A Platform only ever
produces Chat Messages — never Donations.
_Avoid_: using "Platform" for Streamlabs/StreamElements (those are Donation Sources).

**Donation Source**:
An integration that produces **Donations**. Three exist: EasySlip (bank-slip
upload), Streamlabs, and StreamElements. A Donation Source is not a Platform.
_Avoid_: calling these "platforms" or "channels".

### Events

**Chat Message**:
A single viewer message from a Platform, shown in the chat feed / chat overlay.
_Avoid_: "comment", "post".

**Donation**:
A money contribution that triggers an **Alert** and counts toward the **Goal**.
Originates only from a Donation Source.
_Avoid_: "tip" (see below), "payment", "gift".

**Tip**:
The word Streamlabs/StreamElements use for their payout events. On ingest a Tip
becomes a Donation — internally we say **Donation**, and reserve "tip" only for
naming the provider integration (e.g. "tip provider").

**Paid-chat badge** (`hasDonation`):
A visual highlight on a Chat Message marking that the viewer paid *on the
Platform* (YouTube Super Chat, Twitch Bits). It is decoration only — it is NOT
a Donation: it fires no Alert and does not move the Goal.
_Avoid_: treating Super Chat / Bits as Donations.

### Output

**Alert**:
The visual-and-audio moment shown on the overlay when a Donation arrives
(card + optional confetti + optional TTS voice).

**Goal**:
A target amount shown on the overlay; advanced by Donations. Has one current
value and one target.

### The overlay surface

**Overlay**:
The OBS browser-source **surface** that renders Widgets for one streamer. It is
the visual output, not a dashboard tab and not an identifier.
_Avoid_: using "Overlay" to mean the dashboard tab or the URL.

**overlayId**:
The identifier that scopes one streamer's Overlay and its saved config (the
`overlay:{overlayId}` room, the OBS URL path).

**Widget**:
An individually renderable piece of the Overlay, each also available as its own
OBS browser source: the **Alert**, the **Chat** feed, the **Goal** bar.

**Template**:
A global visual theme (classic / cute / gaming / minimal / neon) applied to
**all** Widgets at once. Distinct from per-Widget settings like Alert position
or Chat layout.
_Avoid_: "skin", "theme" (pick Template).

## Resolved ambiguities

**"Overlay"** (was overloaded 3 ways) → resolved: the **surface** is the
*Overlay*; the identifier is the *overlayId*; the dashboard tab named "Overlay"
owns **all overlay visual config** — Template, alert animation/position,
chat-overlay layout/filter, Custom CSS, OBS URLs — behind one save + auto-save
(see ADR-0001 revision). Only the alert **sound** (TTS) stays with Donations;
chat **sources** and **test** stay in Chat.

## Example dialogue

> **Dev:** A viewer just dropped a Super Chat on YouTube — does that pop an alert?
> **Streamer:** No. Super Chat is a paid-chat badge on the chat message, not a
> Donation. Alerts only fire from a Donation Source.
> **Dev:** So if I want that YouTube money to alert, it has to come through
> EasySlip, Streamlabs, or StreamElements?
> **Streamer:** Right. YouTube is a Platform — it only feeds me chat.
