# NOTICE

StreamTool — multi-platform streaming aggregator + donation overlay
Copyright (C) 2026 thanakon228

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at
your option) any later version. See `LICENSE` for the full text.

---

## Third-party derivative works

This project incorporates ideas, schemas, and patterns from:

### social_stream
- **Source:** https://github.com/steveseguin/social_stream
- **Copyright:** © Steve Seguin and contributors
- **License:** GNU Affero General Public License v3.0 (AGPL-3.0)

Specific elements adapted (re-implemented for Node.js standalone, not
copied verbatim from browser-extension sources):

- TTS queue + mutex pattern (`tts.js` → `lib/tts/queue.js`):
  FIFO array + `isPlaying` boolean + `onended` trigger.
- Unified chat message schema (`providers/twitch/chatClient.js`,
  `sources/streamelements.js` → `lib/chat/index.js` event contract):
  `{ id, platform, displayName, message, chatimg, chatbadges[], sentAt,
  hasDonation, bits }`.
- Donation min-amount + alert queue pattern (`multi-alerts.js` →
  client-side audio queue in `public/overlay/index.html`).
- Style/voice tag mapping concept (`tts.js` STYLE_MAP →
  `lib/tts/styles.js`).

No DOM-scraping `sources/*.js` modules were ported. Chat platform
integrations (Twitch, Kick, Facebook) and tip providers (Streamlabs,
StreamElements) are implemented against the platforms' official
WebSocket / HTTP APIs and do not derive from social_stream's source
code.

---

## Dependencies

Runtime dependencies declared in `package.json` retain their respective
upstream licenses. Run `npm ls --all --json` for the full graph.
