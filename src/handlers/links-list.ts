import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getStore, formatDate, timeUntil } from "../storage.js";

registerMainMenuItem({
  label: "🔗 Manage Links",
  data: "links:list",
  order: 20,
});

const composer = new Composer<Ctx>();

composer.callbackQuery("links:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const groupId = ctx.chat?.id ?? 0;
  const bundles = await store.listBundlesForGroup(groupId);
  const active = bundles.filter((b) => !b.revoked && b.expiry_time > Date.now());
  const revoked = bundles.filter((b) => b.revoked);
  const expired = bundles.filter((b) => !b.revoked && b.expiry_time <= Date.now());

  if (active.length === 0 && revoked.length === 0 && expired.length === 0) {
    await ctx.reply(
      "No links yet. Upload files to create your first shareable link.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📤 Upload files", "upload:start")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  let text = "Active links:\n\n";
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const b of active) {
    const remaining = timeUntil(b.expiry_time);
    const hasPw = b.password_hash ? " 🔒" : "";
    text += `• Link ${b.token.slice(0, 8)}… — expires in ${remaining}${hasPw}\n`;
    rows.push([
      inlineButton(`ℹ️ ${b.token.slice(0, 8)}`, `links:detail:${b.token}`),
      inlineButton("🗑 Revoke", `links:revoke:${b.token}`),
    ]);
  }

  for (const b of expired) {
    text += `• Link ${b.token.slice(0, 8)}… — expired\n`;
  }

  for (const b of revoked) {
    text += `• Link ${b.token.slice(0, 8)}… — revoked\n`;
  }

  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.reply(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^links:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
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

  const logs = await store.getAccessLogsForBundle(token);
  const downloads = logs.filter((l) => l.success).length;
  const attempts = logs.length;
  const hasPw = bundle.password_hash ? "Yes" : "No";
  const status = bundle.revoked
    ? "Revoked"
    : bundle.expiry_time <= Date.now()
      ? "Expired"
      : "Active";

  await ctx.reply(
    `Link details:\n\n` +
      `Token: ${bundle.token.slice(0, 8)}…\n` +
      `Status: ${status}\n` +
      `Created: ${formatDate(bundle.created_at)}\n` +
      `Expires: ${formatDate(bundle.expiry_time)}\n` +
      `Password: ${hasPw}\n` +
      `Files: ${bundle.file_ids.length}\n` +
      `Downloads: ${downloads}/${attempts === 0 ? "—" : attempts}`,
    {
      reply_markup: inlineKeyboard([
        [
          !bundle.revoked && bundle.expiry_time > Date.now()
            ? inlineButton("🗑 Revoke", `links:revoke:${token}`)
            : inlineButton("⬅️ Back", `links:list`),
          inlineButton("⬅️ Back to menu", "menu:main"),
        ],
      ]),
    },
  );
});

composer.callbackQuery(/^links:revoke:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
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
  if (bundle.admin_id !== ctx.from?.id) {
    await ctx.reply("Only the link creator can revoke it.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  await store.revokeBundle(token);
  await ctx.editMessageText("Link revoked. Members can no longer access files through it.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
