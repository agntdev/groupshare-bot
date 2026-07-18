import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getStore, formatDate } from "../storage.js";

registerMainMenuItem({
  label: "📊 Access Logs",
  data: "logs:view",
  order: 30,
});

const composer = new Composer<Ctx>();

composer.callbackQuery("logs:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const groupId = ctx.chat?.id ?? 0;
  const logs = await store.getAccessLogsForGroup(groupId);

  if (logs.length === 0) {
    await ctx.reply(
      "No download activity yet. Access logs appear here when members use your links.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const total = logs.length;
  const successful = logs.filter((l) => l.success).length;
  const failed = total - successful;
  const rate = total > 0 ? Math.round((successful / total) * 100) : 0;

  const recent = logs.slice(-5).reverse();
  let recentText = "";
  for (const log of recent) {
    const status = log.success ? "✅" : "❌";
    const time = formatDate(log.timestamp);
    recentText += `${status} User ${log.user_id} — ${time}\n`;
  }

  await ctx.reply(
    `Access log summary:\n\n` +
      `Total attempts: ${total}\n` +
      `Successful: ${successful}\n` +
      `Failed: ${failed}\n` +
      `Success rate: ${rate}%\n\n` +
      `Recent activity:\n${recentText}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
