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

export interface ParsedEpicHeader {
  epicTitle: string;
  requestBody: string;
}

export type ResolutionChoice =
  | {
      kind: "candidate";
      index: number;
    }
  | {
      kind: "new";
    };

export function shouldHandleCeoIngress(input: {
  isDm: boolean;
  mentioned: boolean;
  isManagedEpicThread: boolean;
  hasPendingResolutionChoice: boolean;
}): boolean {
  return (
    input.isDm ||
    input.mentioned ||
    input.isManagedEpicThread ||
    input.hasPendingResolutionChoice
  );
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

export function parseEpicHeader(content: string): ParsedEpicHeader | null {
  const [firstLine = "", ...rest] = content.split(/\r?\n/u);
  const match = /^epic\s*:\s*(.+)$/iu.exec(firstLine.trim());
  if (!match) {
    return null;
  }
  const epicTitle = match[1]?.trim() ?? "";
  const requestBody = rest.join("\n").trim();
  if (epicTitle === "" || requestBody === "") {
    return null;
  }
  return {
    epicTitle,
    requestBody,
  };
}

export function parseResolutionChoice(
  content: string,
): ResolutionChoice | null {
  const normalized = content.trim().toLowerCase();
  if (normalized === "new") {
    return { kind: "new" };
  }
  if (/^[1-3]$/u.test(normalized)) {
    return {
      kind: "candidate",
      index: Number.parseInt(normalized, 10) - 1,
    };
  }
  return null;
}

export function parseWorkspaceBinding(content: string): string | null {
  const match = /^workspace\s*:\s*(.+)$/iu.exec(content.trim());
  const workspacePath = match?.[1]?.trim() ?? "";
  return workspacePath === "" ? null : workspacePath;
}
