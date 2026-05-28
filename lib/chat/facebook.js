// Facebook Live comments via Graph API polling.
// Requires a Page access token with `pages_read_engagement` + `live_video_api`
// scopes. The token must belong to the page owning the live video.

function createFacebookChat({ pageToken, sessionStore, emit, onSessionChange, intervalMs = 3000 }) {
  let active = false;
  let timer = null;
  const seen = new Set();

  async function tick() {
    if (!active) return;
    const s = sessionStore.facebook;
    if (!s?.liveVideoId || !pageToken) return;

    try {
      const url = new URL(`https://graph.facebook.com/v18.0/${s.liveVideoId}/comments`);
      url.searchParams.set("access_token", pageToken);
      url.searchParams.set("fields", "id,from{name,picture},message,created_time");
      url.searchParams.set("limit", "50");

      const r = await fetch(url.toString());
      const d = await r.json();
      if (d.error) {
        console.error("Facebook:", d.error.message);
      } else {
        for (const c of (d.data || []).reverse()) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          emit("chat", {
            id:          c.id,
            platform:    "facebook",
            displayName: c.from?.name || "viewer",
            chatimg:     c.from?.picture?.data?.url || "",
            chatbadges:  [],
            message:     String(c.message || ""),
            sentAt:      c.created_time || new Date().toISOString(),
            hasDonation: false,
            bits:        0,
          });
        }
        if (seen.size > 5000) {
          const keep = [...seen].slice(-4000);
          seen.clear(); keep.forEach(x => seen.add(x));
        }
      }
    } catch (e) {
      console.error("Facebook poll:", e.message);
    }
    timer = setTimeout(tick, intervalMs);
  }

  return {
    isActive: () => active,
    getSession: () => sessionStore.facebook,

    start(liveVideoId) {
      if (!pageToken) throw Object.assign(new Error("FACEBOOK_PAGE_TOKEN not set"), { code: 503 });
      const lvid = String(liveVideoId || "").trim();
      if (!lvid) throw Object.assign(new Error("liveVideoId required"), { code: 400 });
      sessionStore.facebook = { liveVideoId: lvid, active: true };
      onSessionChange?.();
      active = true;
      seen.clear();
      tick();
    },

    stop() {
      active = false;
      if (timer) { clearTimeout(timer); timer = null; }
      if (sessionStore.facebook) sessionStore.facebook.active = false;
      onSessionChange?.();
    },

    resumeIfActive() {
      if (sessionStore.facebook?.active && pageToken) {
        active = true;
        tick();
        console.log(`Facebook session resumed video=${sessionStore.facebook.liveVideoId}`);
      }
    },
  };
}

module.exports = { createFacebookChat };
