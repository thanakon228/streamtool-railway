const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, "..");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch {
    return false;
  }
}

function loadAdmin() {
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8")); } catch { return null; }
}

function saveAdminPassword(password) {
  const data = { passwordHash: hashPassword(password), updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2));
  return data;
}

function createAdminAuth({ envPassword, resetToken }) {
  let cached = loadAdmin();

  function checkPassword(input) {
    if (cached?.passwordHash) return verifyPassword(input, cached.passwordHash);
    return input === envPassword;
  }

  function resetPassword({ resetToken: token, newPassword }) {
    if (!resetToken) {
      throw Object.assign(new Error("ADMIN_RESET_TOKEN not configured on server"), { code: 503 });
    }
    if (!token || token !== resetToken) {
      throw Object.assign(new Error("Invalid reset token"), { code: 401 });
    }
    if (!newPassword || String(newPassword).length < 8) {
      throw Object.assign(new Error("Password must be at least 8 characters"), { code: 400 });
    }
    cached = saveAdminPassword(String(newPassword));
    return { ok: true, message: "Password updated" };
  }

  function changePassword({ currentPassword, newPassword }) {
    if (!checkPassword(currentPassword)) {
      throw Object.assign(new Error("Current password is wrong"), { code: 401 });
    }
    if (!newPassword || String(newPassword).length < 8) {
      throw Object.assign(new Error("Password must be at least 8 characters"), { code: 400 });
    }
    cached = saveAdminPassword(String(newPassword));
    return { ok: true, message: "Password updated" };
  }

  return { checkPassword, resetPassword, changePassword, hasPersistedPassword: () => !!cached?.passwordHash };
}

module.exports = { createAdminAuth };
