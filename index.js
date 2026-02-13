import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";
import express from "express";
import axios from "axios";
import P from "pino";
import qrcode from "qrcode-terminal";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK = process.env.N8N_WEBHOOK || "";

let sock;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("=== SCAN QR DI BAWAH INI ===");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("WhatsApp connected!");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Reconnecting...");
        startSock();
      } else {
        console.log("Logged out.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const jid = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text) return;

    let reply = "Pesan diterima kak.";

    if (N8N_WEBHOOK) {
      try {
        const res = await axios.post(N8N_WEBHOOK, { jid, text });
        if (res.data.reply) reply = res.data.reply;
      } catch (e) {
        console.log("Webhook error:", e.message);
      }
    }

    await sock.sendPresenceUpdate("composing", jid);
    const delay = Math.floor(Math.random() * (60000 - 30000) + 30000);
    await new Promise((r) => setTimeout(r, delay));

    await sock.sendMessage(jid, { text: reply });
  });
}

startSock();

app.get("/", (req, res) => res.send("Baileys bot running"));
app.listen(PORT, () => console.log("Running on", PORT));
