# StreamTool — Project Memory

## 📁 Locations
- **Local:** `C:\Users\thana\Desktop\ClaudeCode\stream-tool\railway-server`
- **GitHub:** `https://github.com/thanakon228/streamtool-railway`
- **Railway (Live):** `https://streamtool-production.up.railway.app`
- **Deploy:** `git push origin master` → Railway auto-deploy

---

## 🏗️ Architecture
- **Backend:** Node.js + Express + Socket.IO (`server.js`)
- **Auth:** JWT (ไม่มี Firebase)
- **Persistence:** `donations.json`, `sessions.json` (JSON file บน Railway)
- **Frontend:** Vanilla HTML/CSS/JS (ไม่มี framework)
- **Realtime:** Socket.IO rooms
  - `dashboard` — JWT auth
  - `overlay:{overlayId}` — overlayId auth

## 📂 ไฟล์หลัก
| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | backend ทั้งหมด (API, Socket.IO, YouTube poller, TikTok WS) |
| `public/dashboard.html` | หน้าจัดการของ streamer (login, platform connect, chat feed, donations) |
| `public/overlay/index.html` | OBS Browser Source (alert card, confetti, chat feed) |
| `donations.json` | ประวัติ donation (ถูก gitignore) |
| `sessions.json` | สถานะ YouTube/TikTok session (ถูก gitignore) |

---

## ⚙️ Railway Environment Variables
| Variable | หมายเหตุ |
|---|---|
| `DASHBOARD_PASSWORD` | รหัสผ่าน dashboard |
| `JWT_SECRET` | secret สำหรับ sign JWT |
| `OVERLAY_ID` | ID ของ overlay (ใช้ใน OBS URL) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key ✅ |
| `EASYSLIP_API_KEY` | สำหรับ verify slip donation |
| `TIKTOK_SESSION_ID` | (optional) ถ้า TikTok ต้องการ auth |

---

## 🔌 API Endpoints
| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/api/login` | POST | รับ password → return JWT + overlayId |
| `/api/session` | GET | ดึงสถานะ YouTube/TikTok session |
| `/api/startYouTubeChat` | POST | เริ่ม YouTube polling (body: `{ videoId }`) |
| `/api/stopYouTubeChat` | POST | หยุด YouTube polling |
| `/api/startTikTokChat` | POST | เริ่ม TikTok WebSocket (body: `{ username }`) |
| `/api/stopTikTokChat` | POST | หยุด TikTok WebSocket |
| `/api/donate` | POST | verify slip → บันทึก → emit alert |
| `/api/donations` | GET | ดึงประวัติ donation ทั้งหมด |
| `/api/health` | GET | เช็คสถานะ server |

---

## 📡 Socket.IO Events
| Event | ทิศทาง | ข้อมูล |
|---|---|---|
| `chat` | server → client | `{ id, platform, displayName, message, sentAt }` |
| `donation` | server → client | `{ slipId, amount, displayName, message, createdAt }` |
| `alert` | server → overlay | เหมือน donation |
| `session` | server → dashboard | `{ youtube: { active, videoId }, tiktok: { active, username } }` |

---

## ✅ เสร็จแล้ว
- Migration Firebase → Railway สมบูรณ์
- YouTube chat polling (YouTube Data API v3)
- TikTok chat persistent WebSocket (tiktok-live-connector)
- ทั้งสอง platform พร้อมกันทำงานได้
- Donation verify slip ผ่าน EasySlip
- Dashboard: login, platform connect, Live Chat Feed (filter YouTube/TikTok), donation stats
- Overlay: alert card + confetti + chat feed สำหรับ OBS

## 🔲 ยังไม่ได้ทำ
- TTS อ่านข้อความ donation (Google TTS / ElevenLabs)
- หน้า donate สำหรับผู้ชมอัปโหลด slip เอง
- Goal bar / ตัวนับยอด donate บน overlay
- Alert เสียง / animation custom

---

## ⚠️ ข้อควรระวัง
- Railway จะ reset `donations.json` / `sessions.json` ทุก redeploy → ควรย้ายไป database ถาวรในอนาคต
- TikTok อาจต้องการ `TIKTOK_SESSION_ID` ถ้า account ถูก rate limit
- YouTube polling interval ขั้นต่ำ 2 วิ (ตาม Google API response)
- sessions resume อัตโนมัติเมื่อ server restart (อ่านจาก `sessions.json`)
- เมื่อ deploy ใหม่ต้อง reconnect ทั้งสอง platform ใหม่เสมอ
