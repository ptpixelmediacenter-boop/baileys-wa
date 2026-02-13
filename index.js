const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const P = require("pino");
const axios = require("axios");

const WEBHOOK = process.env.N8N_WEBHOOK;

if (!WEBHOOK) {
    console.log("N8N_WEBHOOK not set!");
    process.exit(1);
}

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const sock = makeWASocket({
        logger: P({ level: "silent" }),
        auth: state
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("Scan QR:");
            console.log(qr);
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start();
        }

        if (connection === "open") {
            console.log("WhatsApp Connected ✅");
        }
    });

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message?.conversation) {

            const chatId = msg.key.remoteJid;
            const text = msg.message.conversation;

            // Mark as read
            await sock.readMessages([msg.key]);

            try {
                // Kirim ke n8n
                const res = await axios.post(WEBHOOK, {
                    from: chatId,
                    message: text
                });

                const reply = res.data.reply || "Baik, pesan diterima.";

                // Typing status
                await sock.sendPresenceUpdate("composing", chatId);

                // Delay random 30-50 detik
                const delay = Math.floor(Math.random() * (50000 - 30000 + 1)) + 30000;
                await new Promise(resolve => setTimeout(resolve, delay));

                await sock.sendPresenceUpdate("paused", chatId);

                await sock.sendMessage(chatId, { text: reply });

            } catch (err) {
                console.log("Webhook error:", err.message);
            }
        }
    });
}

start();
