const { createStreamlabs }     = require("./streamlabs");
const { createStreamElements } = require("./streamelements");

function createTipManager({ env, onTip, onStatus, persistence }) {
  const providers = {
    streamlabs: createStreamlabs({
      token:    env.STREAMLABS_TOKEN,
      onTip:    (tip) => handle(tip),
      onStatus,
    }),
    streamelements: createStreamElements({
      jwt:       env.SE_JWT,
      accountId: env.SE_ACCOUNT_ID,
      onTip:    (tip) => handle(tip),
      onStatus,
    }),
  };

  function handle(tip) {
    // Dedup ข้าม session ผ่าน persistence — ใช้ tipId เป็น key เหมือน slipId
    if (persistence?.findDonation(tip.tipId)) return;
    onTip(tip);
  }

  function start(name) {
    const p = providers[name];
    if (!p) throw Object.assign(new Error("unknown provider"), { code: 400 });
    p.start();
    if (persistence) {
      persistence.state.tips[name] = { active: true, since: new Date().toISOString() };
      persistence.saveSessions();
    }
  }

  function stop(name) {
    const p = providers[name];
    if (!p) throw Object.assign(new Error("unknown provider"), { code: 400 });
    p.stop();
    if (persistence) {
      persistence.state.tips[name] = { active: false };
      persistence.saveSessions();
    }
  }

  function status() {
    return Object.fromEntries(
      Object.entries(providers).map(([name, p]) => [name, { active: p.isActive() }])
    );
  }

  function resumeAll() {
    if (!persistence) return;
    for (const [name, p] of Object.entries(providers)) {
      if (persistence.state.tips[name]?.active) {
        p.start();
        console.log(`Tip provider resumed: ${name}`);
      }
    }
  }

  return { start, stop, status, resumeAll };
}

module.exports = { createTipManager };
