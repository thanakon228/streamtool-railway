# Live Events API (built into StreamTool)

StreamTool มี REST + Socket.IO สำหรับรับ-ส่ง event ไลฟ์ในตัวแล้ว — ไม่ต้อง deploy `stream-events-api` แยก (แต่ forward ไป repo นั้นได้ถ้าต้องการ)

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/events/types` | — |
| `GET` | `/api/events?limit=20` | — |
| `POST` | `/api/events` | `X-API-Key` |
| `POST` | `/api/events/batch` | `X-API-Key` |
| `POST` | `/api/webhook/streamtool` | `X-API-Key` |

## Environment

| Variable | Description |
|----------|-------------|
| `EVENTS_API_KEY` | API key สำหรับส่ง event (ถ้าไม่ตั้ง ใช้ `DASHBOARD_PASSWORD`) |
| `EVENTS_API_URL` | URL ของ `stream-events-api` แยก — StreamTool จะ forward event ไปอัตโนมัติ |
| `ADMIN_RESET_TOKEN` | ใช้รีเซ็ตรหัส admin เมื่อลืม (ดูด้านล่าง) |

## Socket.IO

Client ฟัง event แบบ unified:

```js
socket.on("liveEvent", (event) => console.log(event));
socket.on("liveEventsHello", ({ history }) => console.log(history));
```

StreamTool ส่ง `liveEvent` อัตโนมัติเมื่อมี **donation** และ **chat**

## ตัวอย่างส่ง event

```bash
curl -X POST https://streamtool-production.up.railway.app/api/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"type":"follow","name":"Alice"}'
```

## รีเซ็ตรหัส Admin (ลืมรหัส)

1. ตั้ง `ADMIN_RESET_TOKEN` ใน Railway Variables (ค่าลับยาว ๆ ใช้ครั้งเดียว)
2. Redeploy แล้วเรียก:

```bash
curl -X POST https://streamtool-production.up.railway.app/api/admin/reset-password \
  -H "Content-Type: application/json" \
  -d '{"resetToken":"YOUR_RESET_TOKEN","newPassword":"รหัสใหม่8ตัวขึ้นไป"}'
```

3. ลบ `ADMIN_RESET_TOKEN` ออกจาก Railway หลังเปลี่ยนรหัสสำเร็จ

รหัสใหม่จะถูกเก็บใน `DATA_DIR/admin.json` (survive redeploy ถ้ามี volume)

## เปลี่ยนรหัส (จำรหัสเก่าได้)

`POST /api/admin/change-password` (ต้อง login JWT)

```json
{ "currentPassword": "...", "newPassword": "..." }
```
