# StreamTool — Project Memory

> อัพเดตล่าสุด: 2026-05-29

## 📁 Locations
- **Local:** `C:\Users\thana\Desktop\ClaudeCode\stream-tool\railway-server`
- **GitHub:** `https://github.com/thanakon228/streamtool-railway`
- **Railway (Live):** `https://streamtool-production.up.railway.app`
- **Deploy:** `git push origin master` → Railway auto-deploy
- **License:** AGPL-3.0-or-later

---

## 🏗️ Architecture
- **Backend:** Node.js 20+ / Express / Socket.IO (`server.js`)
- **Auth:** JWT (ไม่มี Firebase)
- **Persistence:** `donations.json`, `sessions.json` (JSON file บน Railway, ถูก gitignore)
- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework)
- **Realtime:** Socket.IO rooms
  - `dashboard` — JWT auth
  - `overlay:{overlayId}` — overlayId auth
- **Modular libs (`lib/`):**
  - `persistence.js` — โหลด/เซฟ donations + sessions
  - `chat/` — adapter ต่อแพลตฟอร์ม (youtube, tiktok, twitch, kick, facebook)
  - `tips/` — tip provider (streamlabs, streamelements) + index manager
  - `tts/` — TTS multi-provider (google, elevenlabs, gemini) + queue + styles

## 📂 ไฟล์หลัก
| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | backend ทั้งหมด (API, Socket.IO, route mounting) |
| `lib/persistence.js` | จัดการ state file |
| `lib/chat/{youtube,tiktok,twitch,kick,facebook}.js` | chat adapter ต่อแพลตฟอร์ม |
| `lib/tips/{streamlabs,streamelements}.js` | tip socket/JWT listener |
| `lib/tts/{google,elevenlabs,gemini}.js` + `queue.js` + `styles.js` | TTS provider + คิวเล่นเสียง |
| `public/dashboard.html` | หน้า streamer (sidebar layout, 5 แท็บ) |
| `public/donate.html` | หน้าโดเนทสำหรับผู้ชม (อัปโหลด slip) |
| `public/overlay/index.html` | OBS Browser Source หลัก (alert + chat) |
| `public/overlay/goal.html` | Goal bar overlay แยก |
| `public/widgets/{chat,alert,goal}.html` | widget เล็กสำหรับใส่ OBS แยกชิ้น |
| `public/templates/{classic,cute,gaming,minimal,neon}.css` | ธีม overlay 5 แบบ |
| `donations.json` | ประวัติ donation (ถูก gitignore) |
| `sessions.json` | สถานะ session + template config + goal (ถูก gitignore) |

---

## ⚙️ Railway Environment Variables

### Core
| Variable | หมายเหตุ |
|---|---|
| `DASHBOARD_PASSWORD` | รหัสผ่าน dashboard |
| `JWT_SECRET` | secret สำหรับ sign JWT |
| `OVERLAY_ID` | ID ของ overlay (ใช้ใน OBS URL) |
| `EASYSLIP_API_KEY` | verify slip donation |
| `EVENTS_API_KEY` | API key สำหรับ `/api/events` (ไม่ตั้ง = ใช้ DASHBOARD_PASSWORD) |
| `EVENTS_API_URL` | forward event ไป stream-events-api แยก (optional) |
| `ADMIN_RESET_TOKEN` | รีเซ็ตรหัส admin เมื่อลืม — ดู `docs/EVENTS_API.md` |

### Chat platforms
| Variable | หมายเหตุ |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 ✅ active |
| `TIKTOK_SESSION_ID` | (optional) ถ้าโดน rate limit ✅ active |
| `TWITCH_CHANNEL` / `TWITCH_OAUTH` | 🔲 UI ซ่อนไว้ |
| `KICK_CHANNEL` | 🔲 UI ซ่อนไว้ |
| `FACEBOOK_PAGE_TOKEN` | 🔲 UI ซ่อนไว้ |

### TTS
| Variable | หมายเหตุ |
|---|---|
| `GOOGLE_TTS_KEY` | Google Cloud Neural2 (th-TH) ✅ |
| `ELEVENLABS_API_KEY` | ElevenLabs |
| `GEMINI_API_KEY` | Gemini TTS |

### Tip providers
| Variable | หมายเหตุ |
|---|---|
| `STREAMLABS_SOCKET_TOKEN` | Streamlabs socket |
| `STREAMELEMENTS_JWT` / `STREAMELEMENTS_ACCOUNT_ID` | StreamElements |

---

## 🔌 API Endpoints

### Auth & status
| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/api/login` | POST | รับ password → return JWT + overlayId |
| `/api/session` | GET | สถานะ session ทุกแพลตฟอร์ม |
| `/api/health` | GET | เช็คสถานะ server |

### Chat platforms (auth required)
| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/api/startYouTubeChat` / `/api/stopYouTubeChat` | POST | YouTube polling (`{ videoId }`) |
| `/api/startTikTokChat` / `/api/stopTikTokChat` | POST | TikTok WS (`{ username }`) |
| `/api/startTwitchChat` / `/api/stopTwitchChat` | POST | Twitch IRC (`{ channel }`) |
| `/api/startKickChat` / `/api/stopKickChat` | POST | Kick chat (`{ channel }`) |
| `/api/startFacebookChat` / `/api/stopFacebookChat` | POST | Facebook live (`{ liveVideoId }`) |
| `/api/test-chat` | POST | ยิง chat ทดสอบไปยัง dashboard + overlay |

### Donation
| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/api/donate` | POST (auth) | verify slip → บันทึก → emit alert + TTS |
| `/api/donate/public` | POST | ผู้ชมโดเนทเอง (ใช้ใน `donate.html`) |
| `/api/donate/info` | GET | ข้อมูลรับโดเนท (public) |
| `/api/donations` | GET (auth) | ประวัติ donation ทั้งหมด |

### Tips, TTS, Goal, Template
| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/api/tips/status` | GET (auth) | สถานะ tip provider |
| `/api/tips/:provider/start` / `stop` | POST (auth) | start/stop streamlabs หรือ streamelements |
| `/api/tts/config` | GET/POST (auth) | tier + style config |
| `/api/test-tts` | POST (auth) | ทดสอบ TTS |
| `/api/test-alert` | POST (auth) | ยิง alert ทดสอบ + TTS |
| `/api/goal` | GET / POST (auth) | goal config + current amount |
| `/api/template-config` | GET / POST (auth) | ธีม overlay |

### Static pages
| Path | หน้าที่ |
|---|---|
| `/dashboard` | หน้า streamer |
| `/donate` | หน้าโดเนทผู้ชม |
| `/overlay`, `/overlay/:id` | overlay หลัก |
| `/overlay/goal` | goal bar overlay |
| `/widget/{chat,alert,goal,donate}` | widget แยก |

---

## 📡 Socket.IO Events
| Event | ทิศทาง | ข้อมูล |
|---|---|---|
| `chat` | server → dashboard + overlay | `{ id, platform, displayName, message, sentAt }` |
| `donation` | server → dashboard | `{ slipId, amount, displayName, message, createdAt }` |
| `alert` | server → overlay | donation + `ttsAudio` |
| `session` | server → dashboard | per-platform: `{ youtube/tiktok/twitch/kick/facebook }` |
| `tipStatus` | server → dashboard | สถานะ tip provider |
| `templateUpdate` | server → dashboard + overlay | สลับธีม realtime |

---

## ✅ เสร็จแล้ว
- Migration Firebase → Railway สมบูรณ์
- YouTube chat polling (YouTube Data API v3)
- TikTok chat persistent WebSocket (tiktok-live-connector)
- Twitch / Kick / Facebook chat adapters (โค้ดเสร็จ แต่ **ซ่อน UI ไว้** ระหว่างทดสอบ)
- Chat aggregator + tip parser (Streamlabs / StreamElements)
- Donation verify slip ผ่าน EasySlip
- หน้าโดเนทผู้ชม (`donate.html`) + API สาธารณะ
- TTS multi-provider: Google Cloud Neural2 (th-TH), ElevenLabs, Gemini + queue + tier/style config
- Goal Bar (overlay หลัก + หน้า goal แยก) + ตัวนับยอด donate
- Test Alert / Test Chat / Test TTS จาก dashboard
- ระบบ Templates 5 ธีม (classic, cute, gaming, minimal, neon) + เปลี่ยน realtime
- Dashboard: sidebar layout, รวม 7 แท็บเป็น 5
- Chat overlay สไตล์ social_stream — avatar + platform pill + donation badge + auto-fade
- Widgets แยกชิ้น (chat / alert / goal / donate) สำหรับใส่ OBS หลายตัว
- เปลี่ยน license เป็น AGPL-3.0

## 🔲 ยังไม่ได้ทำ / ทำต่อ
- เปิด UI ของ Twitch / Kick / Facebook (โค้ดพร้อม แค่ปลดล็อก)
- ย้าย state ไป database ถาวร (Railway ephemeral fs)
- เพิ่ม custom alert sound ต่อ tier
- ทดสอบ tip providers (Streamlabs / StreamElements) จริงจัง

---

## ⚠️ ข้อควรระวัง
- Railway จะ reset `donations.json` / `sessions.json` ทุก redeploy → ควรย้ายไป database ถาวรในอนาคต
- TikTok อาจต้องการ `TIKTOK_SESSION_ID` ถ้า account ถูก rate limit
- YouTube polling interval ขั้นต่ำ 2 วิ (ตาม Google API response)
- sessions resume อัตโนมัติเมื่อ server restart (อ่านจาก `sessions.json`)
- เมื่อ deploy ใหม่ต้อง reconnect ทั้ง chat platform ใหม่เสมอ
- TikTok ใช้ unofficial API (`tiktok-live-connector`) — อาจ break ในอนาคต
- Chat platforms ใหม่ (Twitch/Kick/Facebook) ซ่อน UI ไว้เพราะยังไม่ผ่าน QA — มีโค้ดแต่ห้าม assume ว่าใช้งานได้
