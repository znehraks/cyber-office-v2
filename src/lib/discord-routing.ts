import { ChannelType } from "discord.js";

interface UserLike {
  id: string;
}

interface RoleCacheLike {
  keys(): IterableIterator<string>;
}

interface MemberLike {
  roles: {
    cache: RoleCacheLike;
  };
}

interface GuildLike {
  members?: {
    me?: MemberLike | null;
  };
}

export interface ReplyChannelLike {
  id?: string;
  type: number;
  isThread(): boolean;
}

export interface MessageLike {
  content?: string;
  guildId?: string | null;
  guild?: GuildLike | null;
  channel: ReplyChannelLike;
}

export interface ClientLike {
  user?: UserLike | null;
}

export function stripBotMention(
  message: MessageLike,
  client: ClientLike,
): string {
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

export async function ensureReplyChannel<T extends ReplyChannelLike>(message: {
  channel: T;
}): Promise<T> {
  if (message.channel.isThread()) {
    return message.channel;
  }
  if (message.channel.type === ChannelType.DM) {
    return message.channel;
  }
  return message.channel;
}
