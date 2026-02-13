const express = require("express");
const axios = require("axios");
const P = require("pino");
const QRCode = require("qrcode");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());
app.set("trust proxy", 1);

let sock;
let latestQR = null;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection } = update;

    if (qr) {
      latestQR = await QRCode.toDataURL(qr);
      console.log("QR Updated");
    }

    if (connection === "close") {
      start();
    }

    if (connection === "open") {
      console.log("WhatsApp Connected");
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
        sender,
        text
      });
    }
  });
}

start();

app.get("/qr", (req, res) => {
  if (!latestQR) return res.json({ status: "waiting" });
  res.json({ qr: latestQR });
});

app.post("/send-text", async (req, res) => {
  const { number, message } = req.body;
  const jid = number + "@s.whatsapp.net";

  const randomDelay = Math.floor(Math.random() * 20000) + 30000;

  await sock.presenceSubscribe(jid);
  await sock.sendPresenceUpdate("composing", jid);
  await delay(randomDelay);
  await sock.sendPresenceUpdate("paused", jid);

  await sock.sendMessage(jid, { text: message });

  res.json({ sent: true });
});

app.post("/send-media", async (req, res) => {
  const { number, url, type } = req.body;
  const jid = number + "@s.whatsapp.net";

  let media = {};

  if (type === "image") media = { image: { url } };
  if (type === "video") media = { video: { url } };
  if (type === "audio")
    media = { audio: { url }, mimetype: "audio/mp4", ptt: true };

  await sock.sendMessage(jid, media);

  res.json({ sent: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));
