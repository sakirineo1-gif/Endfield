const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const GITHUB_OWNER = "emilysaki519-maker";
const GITHUB_REPO = "Endfield";
const IMAGES_PATH = "images";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCharacters = [];
let cacheTime = 0;

function generateAliases(folderName) {
  const lower = folderName.toLowerCase().replace(/\s+/g, "");
  const aliases = new Set();
  aliases.add(lower);
  aliases.add(folderName.toLowerCase());
  if (lower.length > 3) aliases.add(lower.slice(0, 3));
  if (lower.length > 4) aliases.add(lower.slice(0, 4));
  return Array.from(aliases);
}

async function fetchJson(url) {
  const headers = { "User-Agent": "discord-bot" };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub API bị giới hạn request (rate limit). Thêm GITHUB_TOKEN vào Railway để fix.`);
  }
  if (res.status === 404) {
    throw new Error(`Không tìm thấy folder/file trên GitHub: ${url}`);
  }
  if (!res.ok) throw new Error(`GitHub API lỗi ${res.status}: ${url}`);
  return res.json();
}

function filterImages(files) {
  return files
    .filter(
      (f) =>
        f.type === "file" &&
        f.download_url &&
        /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name)
    )
    .map((f) => f.download_url);
}

async function loadCharacters() {
  const now = Date.now();
  if (cachedCharacters.length > 0 && now - cacheTime < CACHE_TTL_MS) {
    return cachedCharacters;
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
  const topLevel = await fetchJson(`${apiBase}/${IMAGES_PATH}`);

  // Tải ảnh thumb dùng chung từ images/thumb/
  let sharedThumbs = [];
  const thumbFolder = topLevel.find(
    (d) => d.type === "dir" && d.name.toLowerCase() === "thumb"
  );
  if (thumbFolder) {
    const thumbFiles = await fetchJson(`${apiBase}/${IMAGES_PATH}/thumb`);
    sharedThumbs = filterImages(thumbFiles);
  }

  // Chỉ lấy các folder nhân vật (bỏ qua folder thumb)
  const characterFolders = topLevel.filter(
    (d) => d.type === "dir" && d.name.toLowerCase() !== "thumb"
  );

  const results = [];

  for (const folder of characterFolders) {
    const files = await fetchJson(`${apiBase}/${IMAGES_PATH}/${folder.name}`);
    const mainImages = filterImages(files);

    if (mainImages.length > 0) {
      results.push({
        name: folder.name,
        aliases: generateAliases(folder.name),
        mainImages,
        thumbImages: sharedThumbs,
      });
    }
  }

  cachedCharacters = results;
  cacheTime = now;
  console.log(`[Bot] Đã tải ${results.length} nhân vật, ${sharedThumbs.length} ảnh thumb từ GitHub`);
  return results;
}

async function findCharacter(query) {
  const chars = await loadCharacters();
  const q = query.toLowerCase().trim();
  return (
    chars.find(
      (c) =>
        c.name.toLowerCase() === q ||
        c.aliases.some(
          (alias) =>
            alias.toLowerCase() === q || q.startsWith(alias.toLowerCase())
        )
    ) || null
  );
}

async function getAllNames() {
  const chars = await loadCharacters();
  return chars.map((c) => c.name);
}

async function sendCharacterImage(message, character) {
  const mainUrl =
    character.mainImages[Math.floor(Math.random() * character.mainImages.length)];

  const thumbUrl =
    character.thumbImages.length > 0
      ? character.thumbImages[Math.floor(Math.random() * character.thumbImages.length)]
      : null;

  const mainExt = mainUrl.split(".").pop().toLowerCase().split("?")[0];
  const mainFileName = `main.${mainExt}`;

  const mainRes = await fetch(mainUrl, { headers: { "User-Agent": "discord-bot" } });
  if (!mainRes.ok) throw new Error(`Không tải được ảnh chính: ${mainRes.status}`);
  const mainAttachment = new AttachmentBuilder(
    Buffer.from(await mainRes.arrayBuffer()),
    { name: mainFileName }
  );

  const files = [mainAttachment];
  let thumbFileName = mainFileName;

  if (thumbUrl) {
    const thumbExt = thumbUrl.split(".").pop().toLowerCase().split("?")[0];
    thumbFileName = `thumb.${thumbExt}`;
    const thumbRes = await fetch(thumbUrl, { headers: { "User-Agent": "discord-bot" } });
    if (thumbRes.ok) {
      files.push(
        new AttachmentBuilder(Buffer.from(await thumbRes.arrayBuffer()), {
          name: thumbFileName,
        })
      );
    }
  }

  const embed = new EmbedBuilder()
    .setDescription(`## __**✦ ${character.name}**__`)
    .setThumbnail(`attachment://${thumbFileName}`)
    .setImage(`attachment://${mainFileName}`)
    .setColor(0xff0033)
    .setFooter({ text: "Endfield Characters" });

  await message.reply({ embeds: [embed], files });
}

const NV_PREFIXES = ["!nhân vật ", "!nhan vat ", "!nv "];
const NV_BARE = ["!nhân vật", "!nhan vat", "!nv"];

function parseCommand(content) {
  const lower = content.toLowerCase();
  for (const prefix of NV_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { cmd: "nv", args: content.slice(prefix.length).trim() };
    }
  }
  for (const bare of NV_BARE) {
    if (lower === bare) return { cmd: "nv", args: "" };
  }
  if (lower === "!list") return { cmd: "list", args: "" };
  if (lower === "!reload") return { cmd: "reload", args: "" };
  if (lower.startsWith("!")) return { cmd: "shortcut", args: content.slice(1).trim() };
  return { cmd: "", args: "" };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", () => {
  console.log(`[Bot] Online: ${client.user.tag}`);
  loadCharacters().catch((err) =>
    console.error("[Bot] Lỗi tải nhân vật:", err.message)
  );
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith("!")) return;

  const { cmd, args } = parseCommand(content);

  try {
    if (cmd === "reload") {
      cacheTime = 0;
      cachedCharacters = [];
      const msg = await message.reply("🔄 Đang tải lại danh sách nhân vật từ GitHub...");
      try {
        const names = await getAllNames();
        await msg.edit(
          `✅ Đã tải lại! Hiện có **${names.length}** nhân vật: ${names.join(", ")}`
        );
      } catch (err) {
        console.error("[Bot] Lỗi reload:", err.message);
        await msg.edit(`❌ Lỗi khi tải từ GitHub:\n\`${err.message}\``);
      }
      return;
    }

    if (cmd === "list") {
      const names = await getAllNames();
      if (names.length === 0) {
        await message.reply(
          "⚠️ Chưa có nhân vật nào. Thêm thư mục ảnh vào GitHub rồi dùng `!reload`."
        );
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("📋 Danh sách nhân vật")
        .setDescription(names.map((n) => `• **${n}**`).join("\n"))
        .setColor(0x5865f2)
        .setFooter({ text: "Dùng !nhân vật [tên] để xem ảnh • !reload để cập nhật" });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (cmd === "nv") {
      if (!args) {
        await message.reply(
          "❓ Bạn muốn xem nhân vật nào?\nDùng `!list` để xem danh sách.\n\nVí dụ: `!nhân vật Xaihi`"
        );
        return;
      }
      const character = await findCharacter(args);
      if (!character) {
        await message.reply(
          `❌ Không tìm thấy **${args}**.\nDùng \`!list\` để xem danh sách.`
        );
        return;
      }
      await sendCharacterImage(message, character);
      return;
    }

    if (cmd === "shortcut" && args.length > 0) {
      const character = await findCharacter(args);
      if (character) {
        await sendCharacterImage(message, character);
      }
    }
  } catch (err) {
    console.error("[Bot] Lỗi:", err.message);
    await message.reply("⚠️ Có lỗi xảy ra, vui lòng thử lại.").catch(() => {});
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[Bot] Thiếu DISCORD_TOKEN!");
  process.exit(1);
}

client.login(token);
