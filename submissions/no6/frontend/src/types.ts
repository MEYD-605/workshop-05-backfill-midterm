export type Message = {
  id: string;
  author_id?: string | null;
  author_name: string | null;
  author_is_bot?: number;
  content: string;
  timestamp: string;
  attachments_json?: string;
};

export type Cursor = { messageId: string; timestamp: string } | null;
export type Thread = { id: string; name: string; state?: string; messages: Message[]; counter: { messages: number }; cursor: Cursor; status: string };
export type Room = { id: string; name: string; position?: number; messages: Message[]; threads: Thread[]; counter: { messages: number; threads: number }; cursor: Cursor; status: string };
export type Guild = { id: string; name: string; rooms: Room[]; counter: { rooms: number; threads: number; messages: number } };
export type UserMapEntry = { id: string; name: string; bot: boolean; messages: number; rooms: string[]; threads: string[] };
export type VectorPoint = { id: string; x: number; y: number; z: number; room_id: string; room_name: string; thread_id?: string | null; thread_name?: string | null; author_id?: string | null; author_name?: string | null; color: string; excerpt: string; timestamp: string };
export type Topic = { topic_id: string; label: string; scope: string; room_id?: string | null; thread_id?: string | null; count: number; keywords: string[]; representativeMessageIds: string[]; color: string };
export type MirrorData = { generatedAt: string; totals: { guilds: number; rooms: number; threads: number; messages: number; users?: number }; diff: { previousMessages: number; currentMessages: number; deltaMessages: number }; users: UserMapEntry[]; topics: Topic[]; vectorPoints: VectorPoint[]; guilds: Guild[] };
