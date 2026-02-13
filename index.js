const express = require("express");
const axios = require("axios");
const P = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());
app.set("trust proxy", 1);

const sessions = {}; // simpan semua koneksi
const qrStore = {};  // simpan QR tiap tenant

// ============================
// START SESSION PER TENANT
// ============================

async function startSession(tenantId) {
  if (sessions[tenantId]) return sessions[tenantId];

  const sessionPath = `sessions/${tenantId}`;
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection } = update;

    if (qr) {
      qrStore[tenantId] = await QRCode.toDataURL(qr);
      console.log(`QR updated for ${tenantId}`);
    }

    if (connection === "close") {
      console.log(`Reconnect ${tenantId}`);
      delete sessions[tenantId];
      startSession(tenantId);
    }

    if (connection === "open") {
      console.log(`Connected ${tenantId}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const sender = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    await sock.readMessages([msg.key]);

    if (process.env.N8N_WEBHOOK) {
      await axios.post(process.env.N8N_WEBHOOK, {
        tenant: tenantId,
        sender,
        text
      });
    }
  });

  sessions[tenantId] = sock;
  return sock;
}

// ============================
// CREATE TENANT
// ============================

app.post("/create-session", async (req, res) => {
  const { tenant } = req.body;
  if (!tenant) return res.status(400).json({ error: "tenant required" });

  await startSession(tenant);
  res.json({ status: "session created", tenant });
});

// ============================
// GET QR PER TENANT
// ============================

app.get("/qr/:tenant", (req, res) => {
  const { tenant } = req.params;
  if (!qrStore[tenant]) return res.json({ status: "waiting" });
  res.json({ qr: qrStore[tenant] });
});

// ============================
// SEND TEXT
// ============================

app.post("/send-text", async (req, res) => {
  const { tenant, number, message } = req.body;
  const sock = sessions[tenant];
  if (!sock) return res.status(404).json({ error: "tenant not found" });

  const jid = number + "@s.whatsapp.net";
  const randomDelay = Math.floor(Math.random() * 20000) + 30000;

  await sock.presenceSubscribe(jid);
  await sock.sendPresenceUpdate("composing", jid);
  await delay(randomDelay);
  await sock.sendPresenceUpdate("paused", jid);

  await sock.sendMessage(jid, { text: message });

  res.json({ sent: true });
});

// ============================
// SEND MEDIA
// ============================

app.post("/send-media", async (req, res) => {
  const { tenant, number, url, type } = req.body;
  const sock = sessions[tenant];
  if (!sock) return res.status(404).json({ error: "tenant not found" });

  const jid = number + "@s.whatsapp.net";
  let media = {};

  if (type === "image") media = { image: { url } };
  if (type === "video") media = { video: { url } };
  if (type ===
