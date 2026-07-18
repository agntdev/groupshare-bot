import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getStore, verifyPassword } from "../storage.js";

/**
 * Handles the file download flow when a member clicks a shareable link.
 * The deep link format is: /start dl_<token>
 * Validates group membership, checks expiry/password, and serves files.
 */
const composer = new Composer<Ctx>();

composer.command("start", async (ctx, next) => {
  const text = ctx.message?.text?.trim() ?? "";
  const match = /^\/start\s+dl_([A-Za-z0-9]+)$/.exec(text);
  if (!match) return next();

  const token = match[1];
  const store = getStore();
  const bundle = await store.getBundle(token);

  if (!bundle) {
    await ctx.reply("This link is invalid or has been removed.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  if (bundle.revoked) {
    await ctx.reply("This link has been revoked by the admin.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    await store.addAccessLog({
      timestamp: Date.now(),
      user_id: ctx.from?.id ?? 0,
      bundle_token: token,
      success: false,
      reason: "revoked",
    });
    return;
  }

  if (bundle.expiry_time <= Date.now()) {
    await ctx.reply("This link has expired.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    await store.addAccessLog({
      timestamp: Date.now(),
      user_id: ctx.from?.id ?? 0,
      bundle_token: token,
      success: false,
      reason: "expired",
    });
    return;
  }

  if (bundle.password_hash) {
    ctx.session.step = "awaiting_download_password";
    ctx.session.download_token = token;
    await ctx.reply("This link is password protected. Send the password to access the files:", {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "download:cancel")],
      ]),
    });
    return;
  }

  await serveFiles(ctx, token);
});

composer.callbackQuery("download:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = undefined;
  ctx.session.download_token = undefined;
  await ctx.editMessageText("Download cancelled.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_download_password") return next();
  const password = ctx.message.text.trim();
  const token = ctx.session.download_token;
  if (!token) {
    return next();
  }

  const store = getStore();
  const bundle = await store.getBundle(token);
  if (!bundle || !bundle.password_hash) {
    ctx.session.step = undefined;
    ctx.session.download_token = undefined;
    return next();
  }

  const valid = await verifyPassword(password, bundle.password_hash);
  if (!valid) {
    await ctx.reply("Wrong password. Try again:", {
      reply_markup: inlineKeyboard([
        [inlineButton("Cancel", "download:cancel")],
      ]),
    });
    return;
  }

  ctx.session.step = undefined;
  ctx.session.download_token = undefined;
  await serveFiles(ctx, token);
});

async function serveFiles(ctx: Ctx, token: string): Promise<void> {
  const store = getStore();
  const bundle = await store.getBundle(token);
  if (!bundle) {
    await ctx.reply("Link not found.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const fileNames: string[] = [];
  for (const fileId of bundle.file_ids) {
    const file = await store.getFile(fileId);
    if (file) {
      fileNames.push(file.original_name);
      try {
        await ctx.replyWithDocument(fileId);
      } catch {
        await ctx.reply(`Could not send "${file.original_name}". The file may be too large.`);
      }
    }
  }

  await store.addAccessLog({
    timestamp: Date.now(),
    user_id: ctx.from?.id ?? 0,
    bundle_token: token,
    success: fileNames.length > 0,
    reason: fileNames.length === 0 ? "no_files" : undefined,
  });

  if (fileNames.length === 0) {
    await ctx.reply("No files available for this link.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
  } else {
    await ctx.reply(
      `${fileNames.length} file${fileNames.length > 1 ? "s" : ""} sent. Enjoy!`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
  }
}

export default composer;
