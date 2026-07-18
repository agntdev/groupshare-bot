import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  getStore,
  generateToken,
  hashPassword,
  type BundleRecord,
} from "../storage.js";

registerMainMenuItem({
  label: "📤 Upload Files",
  data: "upload:start",
  order: 10,
});

const composer = new Composer<Ctx>();

const EXPIRY_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

composer.callbackQuery("upload:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.upload_step = "awaiting_files";
  ctx.session.upload_files = [];
  await ctx.reply(
    "Send me the files you want to share. You can send multiple files one by one.\n\n" +
      "When you're done, tap Done below.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Done", "upload:files_done")],
        [inlineButton("Cancel", "upload:cancel")],
      ]),
    },
  );
});

composer.callbackQuery("upload:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.upload_step = "idle";
  ctx.session.upload_files = [];
  ctx.session.upload_expiry_hours = undefined;
  ctx.session.upload_password = undefined;
  ctx.session.upload_target_group_id = undefined;
  await ctx.editMessageText("Upload cancelled.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.callbackQuery("upload:files_done", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.upload_files || ctx.session.upload_files.length === 0) {
    await ctx.editMessageText(
      "No files added yet. Send at least one file first.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Cancel", "upload:cancel")],
        ]),
      },
    );
    return;
  }
  ctx.session.upload_step = "awaiting_config";
  const count = ctx.session.upload_files.length;
  const totalSize = ctx.session.upload_files.reduce((s, f) => s + f.size, 0);
  const sizeStr = formatBytes(totalSize);
  await ctx.editMessageText(
    `${count} file${count > 1 ? "s" : ""} ready (${sizeStr}).\n\n` +
      "Now choose how long the link should stay active:",
    {
      reply_markup: inlineKeyboard([
        EXPIRY_OPTIONS.map((o) =>
          inlineButton(o.label, `upload:expiry:${o.hours}`),
        ),
        [inlineButton("Cancel", "upload:cancel")],
      ]),
    },
  );
});

composer.callbackQuery(/^upload:expiry:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const hours = parseInt(ctx.match[1], 10);
  ctx.session.upload_expiry_hours = hours;
  ctx.session.upload_step = "confirming";

  const expiryLabel =
    EXPIRY_OPTIONS.find((o) => o.hours === hours)?.label ?? `${hours}h`;
  const fileCount = ctx.session.upload_files?.length ?? 0;

  await ctx.editMessageText(
    `Ready to create the link:\n\n` +
      `📁 ${fileCount} file${fileCount > 1 ? "s" : ""}\n` +
      `⏰ Expires in ${expiryLabel}\n\n` +
      `Would you like to add a password?`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🔒 Add password", "upload:password")],
        [
          inlineButton("🚀 Create link", "upload:create"),
          inlineButton("Cancel", "upload:cancel"),
        ],
      ]),
    },
  );
});

composer.callbackQuery("upload:password", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.upload_step = "awaiting_config";
  await ctx.editMessageText("Send me the password for this link:", {
    reply_markup: inlineKeyboard([
      [inlineButton("Skip password", "upload:create")],
      [inlineButton("Cancel", "upload:cancel")],
    ]),
  });
});

composer.callbackQuery("upload:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  await createBundle(ctx);
});

async function createBundle(ctx: Ctx): Promise<void> {
  const files = ctx.session.upload_files;
  if (!files || files.length === 0) {
    await ctx.reply("No files to share. Start again from the menu.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const store = getStore();
  const token = generateToken();
  const expiryMs = (ctx.session.upload_expiry_hours ?? 24) * 60 * 60 * 1000;

  let passwordHash: string | undefined;
  if (ctx.session.upload_password) {
    passwordHash = await hashPassword(ctx.session.upload_password);
  }

  const bundle: BundleRecord = {
    token,
    group_id: ctx.chat?.id ?? 0,
    admin_id: ctx.from?.id ?? 0,
    expiry_time: Date.now() + expiryMs,
    max_downloads: -1,
    password_hash: passwordHash,
    file_ids: files.map((f) => f.file_id),
    created_at: Date.now(),
    revoked: false,
  };

  await store.saveBundle(bundle);

  for (const f of files) {
    await store.saveFile({
      file_id: f.file_id,
      original_name: f.name,
      size: f.size,
      mime_type: f.mime_type,
      storage_path: `files/${f.file_id}`,
    });
  }

  const expiryLabel =
    EXPIRY_OPTIONS.find((o) => o.hours === ctx.session.upload_expiry_hours)
      ?.label ?? `${ctx.session.upload_expiry_hours}h`;
  const hasPassword = !!ctx.session.upload_password;

  ctx.session.upload_step = "idle";
  ctx.session.upload_files = [];
  ctx.session.upload_expiry_hours = undefined;
  ctx.session.upload_password = undefined;

  const linkUrl = `https://t.me/${ctx.me?.username ?? "bot"}?start=dl_${token}`;

  await ctx.reply(
    `Link created!\n\n` +
      `🔗 ${linkUrl}\n\n` +
      `📁 ${files.length} file${files.length > 1 ? "s" : ""}\n` +
      `⏰ Expires in ${expiryLabel}\n` +
      `${hasPassword ? "🔒 Password protected\n" : ""}` +
      `\nShare this link with your group members.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("📋 Copy link", `upload:copy:${token}`)],
        [inlineButton("🗑 Revoke link", `upload:revoke:${token}`)],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
}

composer.callbackQuery(/^upload:copy:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Link copied!" });
});

composer.callbackQuery(/^upload:revoke:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  const store = getStore();
  const bundle = await store.getBundle(token);
  if (bundle && bundle.admin_id === ctx.from?.id) {
    await store.revokeBundle(token);
    await ctx.editMessageText("Link revoked. Members can no longer access files through it.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
  } else {
    await ctx.reply("Couldn't revoke that link.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
  }
});

composer.on("message:document", async (ctx) => {
  if (ctx.session.upload_step !== "awaiting_files") return;
  const doc = ctx.message.document;
  if (!ctx.session.upload_files) ctx.session.upload_files = [];
  ctx.session.upload_files.push({
    file_id: doc.file_id,
    name: doc.file_name ?? "unnamed",
    size: doc.file_size ?? 0,
    mime_type: doc.mime_type ?? "application/octet-stream",
  });
  const count = ctx.session.upload_files.length;
  await ctx.reply(
    `Added "${doc.file_name ?? "file"}" (${formatBytes(doc.file_size ?? 0)}). ` +
      `${count} file${count > 1 ? "s" : ""} total. Send more or tap Done.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Done", "upload:files_done")],
        [inlineButton("Cancel", "upload:cancel")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.upload_step === "awaiting_config") {
    const text = ctx.message.text.trim();
    if (text.length < 1 || text.length > 64) {
      await ctx.reply("Password must be 1–64 characters. Try again:");
      return;
    }
    ctx.session.upload_password = text;
    ctx.session.upload_step = "confirming";
    const fileCount = ctx.session.upload_files?.length ?? 0;
    const expiryLabel =
      EXPIRY_OPTIONS.find(
        (o) => o.hours === ctx.session.upload_expiry_hours,
      )?.label ?? `${ctx.session.upload_expiry_hours}h`;
    await ctx.reply(
      `Ready to create the link:\n\n` +
        `📁 ${fileCount} file${fileCount > 1 ? "s" : ""}\n` +
        `⏰ Expires in ${expiryLabel}\n` +
        `🔒 Password protected\n\n` +
        `Create the link?`,
      {
        reply_markup: inlineKeyboard([
          [
            inlineButton("🚀 Create link", "upload:create"),
            inlineButton("Cancel", "upload:cancel"),
          ],
        ]),
      },
    );
    return;
  }
  return next();
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default composer;
