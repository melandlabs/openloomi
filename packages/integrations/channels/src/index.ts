/**
 * @openloomi/channels - Message platform adapters and integrations
 */

export { MessagePlatformAdapter } from "./adapter";
export {
  BaseMessageEvent,
  PrivateMessageEvent,
  GroupMessageEvent,
} from "./events";
export type { MessageEvent, MessageTarget, MessageHandler } from "./events";

export type {
  Messages,
  Message,
  Unknown,
  PlainText,
  Source,
  Quote,
  At,
  AtAll,
  Image,
  Voice,
  Forward,
  File,
  Emoji,
  ForwardMessageNode,
  ForwardMessageDisplay,
} from "./message";

export type {
  Entity,
  Friend,
  Group,
  GroupMember,
  PrivateChat,
} from "./entities";
export { Permission } from "./entities";
