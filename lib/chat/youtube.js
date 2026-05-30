function createYouTubeChat({ apiKey, sessionStore, emit, onSessionChange, onStatus }) {
  let poller = null;

  // Stop for good and tell the dashboard why (quota gone / chat ended), instead
  // of polling a dead chat forever and silently burning the daily quota.
  function fatalStop(reason) {
    if (sessionStore.youtube) sessionStore.youtube.active = false;
    stopPoller();
    onSessionChange?.();
    onStatus?.({ active: false, reason });
    console.error("YouTube stopped:", reason);
  }

  async function fetchPage() {
    const s = sessionStore.youtube;
    if (!s?.active || !apiKey) return null;

    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("liveChatId", s.liveChatId);
      url.searchParams.set("part", "snippet,authorDetails");
      url.searchParams.set("key", apiKey);
      if (s.nextPageToken) url.searchParams.set("pageToken", s.nextPageToken);

      const r = await fetch(url.toString());
      const d = await r.json();
      if (d.error) {
        // 403 (quota/forbidden) and 404 (chat ended/not found) won't fix
        // themselves — stop. Other codes (5xx, transient) → keep retrying.
        if (d.error.code === 403 || d.error.code === 404) { fatalStop(d.error.message); return null; }
        console.error("YouTube API:", d.error.message);
        return 5000;
      }

      const { nextPageToken, items = [], pollingIntervalMillis = 5000 } = d;
      const isFirst = !s.nextPageToken;
      s.nextPageToken = nextPageToken;

      if (!isFirst) {
        for (const item of items) {
          emit("chat", {
            id: item.id,
            platform: "youtube",
            displayName: item.authorDetails.displayName,
            chatimg:     item.authorDetails.profileImageUrl || "",
            chatbadges:  [],
            message:     item.snippet.displayMessage,
            sentAt:      item.snippet.publishedAt,
            hasDonation: !!item.snippet.superChatDetails || !!item.snippet.superStickerDetails,
            bits:        0,
          });
        }
      }
      return Math.max(pollingIntervalMillis, 2000);
    } catch (e) {
      console.error("fetchYouTubePage:", e.message);
      return 5000;
    }
  }

  function startPoller() {
    if (poller) return;
    const tick = async () => {
      const next = await fetchPage();
      if (next === null) { poller = null; return; }
      poller = setTimeout(tick, next);
    };
    poller = setTimeout(tick, 0);
    console.log("YouTube poller started");
  }

  function stopPoller() {
    if (poller) { clearTimeout(poller); poller = null; }
    console.log("YouTube poller stopped");
  }

  return {
    isActive: () => !!poller,
    getSession: () => sessionStore.youtube,

    async start(videoId) {
      if (!apiKey) throw Object.assign(new Error("YOUTUBE_API_KEY not set"), { code: 503 });

      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
      );
      const d = await r.json();
      if (d.error) throw Object.assign(new Error(`YouTube API error: ${d.error.message}`), { code: 400 });
      const liveChatId = d.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!liveChatId) throw Object.assign(
        new Error("ไม่พบ live chat — ตรวจสอบ Video ID และว่า stream กำลัง live อยู่"),
        { code: 404 }
      );

      sessionStore.youtube = { videoId, liveChatId, nextPageToken: null, active: true };
      onSessionChange?.();
      startPoller();
      return { liveChatId };
    },

    stop() {
      if (sessionStore.youtube) sessionStore.youtube.active = false;
      stopPoller();
      onSessionChange?.();
    },

    resumeIfActive() {
      if (sessionStore.youtube?.active) {
        startPoller();
        console.log("YouTube session resumed");
      }
    },
  };
}

module.exports = { createYouTubeChat };
