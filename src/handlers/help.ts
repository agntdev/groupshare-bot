import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

const HELP =
  "ℹ️ How to use Group File Share Manager:\n\n" +
  "📤 Upload files and create shareable links for your group\n" +
  "🔗 Manage active links — view, adjust, or revoke them\n" +
  "📊 View access logs to see who downloaded what\n\n" +
  "Tap /start to open the main menu and pick what you need.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
