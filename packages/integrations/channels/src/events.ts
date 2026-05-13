import type { Friend, GroupMember, Group } from "./entities";
import type { Attachment } from "@openloomi/shared";
import type { Messages } from "./message";

export type MessageTarget = "private" | "group";
export type MessageEvent = PrivateMessageEvent | GroupMessageEvent;
export type MessageHandler<T extends MessageTarget> = (
  event: {
    private: PrivateMessageEvent;
    group: GroupMessageEvent;
  }[T],
) => Promise<void> | void;

/**
 * Base class for all message-related events.
 */
export class BaseMessageEvent {
  /** The content of the message as a Messages. */
  public messages: Messages;

  /** Timestamp when the message was sent (in seconds). */
  public time?: number;

  /** Normalized attachments associated with the message. */
  public attachments: Attachment[];

  /**
   * Raw platform-specific event object.
   * Preserved for adapter developers who need access to original platform data.
   */
  public sourcePlatformObject?: any;

  constructor(messages: Messages, time?: number, sourcePlatformObject?: any) {
    this.messages = messages;
    this.time = time;
    this.sourcePlatformObject = sourcePlatformObject;
    this.attachments = [];
  }
}

/**
 * Event representing a private message from a friend.
 */
export class PrivateMessageEvent extends BaseMessageEvent {
  /** The friend who sent the message. */
  public sender: Friend;
  targetType = "private" as const;

  constructor(
    sender: Friend,
    messages: Messages,
    time?: number,
    sourcePlatformObject?: any,
  ) {
    super(messages, time, sourcePlatformObject);
    this.sender = sender;
  }
}

/**
 * Event representing a message sent in a group chat.
 */
export class GroupMessageEvent extends BaseMessageEvent {
  /** The group member who sent the message. */
  public sender: GroupMember;
  targetType = "group" as const;

  constructor(
    sender: GroupMember,
    messages: Messages,
    time?: number,
    sourcePlatformObject?: any,
  ) {
    super(messages, time, sourcePlatformObject);
    this.sender = sender;
  }

  /**
   * Gets the group associated with this message (via the sender).
   */
  public get group(): Group {
    return this.sender.group;
  }
}
