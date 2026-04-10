import { ChannelType } from "discord.js";

export function stripBotMention(message, client) {
  let text = String(message.content ?? "");

  if (client.user) {
    text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "");
  }

  if (message.guildId) {
    const me = message.guild?.members?.me;
    if (me) {
      for (const roleId of me.roles.cache.keys()) {
        text = text.replace(new RegExp(`<@&${roleId}>`, "g"), "");
      }
    }
  }

  return text.trim();
}

export async function ensureReplyChannel(message) {
  if (message.channel.isThread()) return message.channel;
  if (message.channel.type === ChannelType.DM) return message.channel;
  return message.channel;
}
