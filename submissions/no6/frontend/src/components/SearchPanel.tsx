import { Search } from 'lucide-react';
import type { MirrorData, Message, Room, Thread } from '../types';

type Result = { message: Message; room: Room; thread?: Thread; text: string };

type Props = { data: MirrorData; query: string; setQuery: (s: string) => void; onJump: (room: Room, thread?: Thread) => void };

export default function SearchPanel({ data, query, setQuery, onJump }: Props) {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const results: Result[] = [];
  if (q) for (const guild of data.guilds) for (const room of guild.rooms) {
    for (const message of room.messages) addIfMatch(results, terms, room, undefined, message);
    for (const thread of room.threads) for (const message of thread.messages) addIfMatch(results, terms, room, thread, message);
  }
  return <div className="border-b border-[#27292f] bg-[#2b2d31] px-4 py-3">
    <label className="flex items-center gap-2 rounded bg-[#1e1f22] px-3 py-2 text-sm">
      <Search size={16} className="text-[#949ba4]"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search mirrored messages / users / rooms / threads" className="flex-1 bg-transparent outline-none text-[#dbdee1] placeholder:text-[#6d7480]" />
    </label>
    {q && <div className="mt-3 max-h-56 overflow-y-auto scrollbar space-y-1">
      {results.slice(0, 20).map(r => <button key={r.message.id} onClick={() => onJump(r.room, r.thread)} className="cursor-pointer w-full text-left rounded px-3 py-2 bg-[#313338] hover:bg-[#3a3c43]">
        <div className="text-xs text-[#949ba4]">#{r.room.name}{r.thread ? ` / 🧵 ${r.thread.name}` : ''} · {r.message.author_name || r.message.author_id || 'unknown'}</div>
        <div className="text-sm text-[#dbdee1] truncate">{r.text || '(no content)'}</div>
      </button>)}
      {!results.length && <div className="text-sm text-[#949ba4] px-2 py-1">No local result. Use `maw no10 search "{query}" --mode=hybrid` for DB/vector search.</div>}
    </div>}
  </div>;
}

function addIfMatch(results: Result[], terms: string[], room: Room, thread: Thread | undefined, message: Message) {
  const text = [room.name, thread?.name, message.author_name, message.author_id, message.content].filter(Boolean).join(' ');
  const haystack = text.toLowerCase();
  if (terms.every(t => haystack.includes(t))) results.push({ room, thread, message, text: message.content || '(no content)' });
}
