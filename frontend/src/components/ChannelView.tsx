import { Bell, Hash, Inbox, Pin, Search, Users } from 'lucide-react';
import type { MirrorData, Room, Thread } from '../types';

type Props = { data: MirrorData; room: Room | null; selectedThread: Thread | null; onThread: (thread: Thread | null) => void };

export default function ChannelView({ data, room, selectedThread, onThread }: Props) {
  if (!room) return <main className="flex-1 bg-[#313338]" />;
  const stream = selectedThread ? selectedThread.messages : room.messages;
  const title = selectedThread ? selectedThread.name : room.name;
  return <main className="flex-1 bg-[#313338] flex flex-col min-w-0">
    <header className="h-12 px-4 flex items-center gap-4 discord-shadow bg-[#313338] shrink-0">
      <Hash className="text-[#80848e]" size={26}/><h1 className="text-white font-semibold text-lg truncate">{title}</h1>
      {selectedThread && <button onClick={() => onThread(null)} className="cursor-pointer text-xs rounded bg-[#404249] px-2 py-1 text-[#dbdee1] hover:bg-[#4e5058]">back to #{room.name}</button>}
      <div className="ml-auto flex items-center gap-5 text-[#b5bac1]">{[Bell, Pin, Users, Search, Inbox].map((Icon, i) => <button key={i} disabled className="cursor-not-allowed opacity-40"><Icon/></button>)}</div>
    </header>
    <section className="h-[76px] border-b border-[#27292f] px-5 flex items-center gap-3 bg-[#313338]">
      <Counter label="guilds" value={data.totals.guilds}/><Counter label="rooms" value={data.totals.rooms}/><Counter label="threads" value={data.totals.threads}/><Counter label="messages" value={data.totals.messages}/><Counter label="users" value={data.totals.users || data.users.length}/>
      <div className="ml-auto text-right text-xs text-[#b5bac1]"><div>Diff: <span className={data.diff.deltaMessages >= 0 ? 'text-[#23a55a]' : 'text-[#f23f42]'}>{data.diff.deltaMessages >= 0 ? '+' : ''}{data.diff.deltaMessages}</span> msgs</div><div>Generated {new Date(data.generatedAt).toLocaleString()}</div></div>
    </section>
    <div className="flex flex-1 min-h-0">
      <section className="flex-1 overflow-y-auto scrollbar px-5 py-4">
        <CursorCard cursor={selectedThread?.cursor || room.cursor} status={selectedThread?.status || room.status} />
        <div className="mt-4 space-y-1">
          {stream.map(msg => <article key={msg.id} className="group flex gap-3 px-2 py-1.5 hover:bg-[#2e3035] rounded">
            <button className={`cursor-pointer w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold ${msg.author_is_bot ? 'bg-[#23a55a]' : 'bg-[#5865f2]'}`} title={`author_id=${msg.author_id || 'unknown'}`}>{(msg.author_name || '?').slice(0,1)}</button>
            <div className="min-w-0"><div><span className="font-semibold text-white">{msg.author_name || 'unknown'}</span><span className="ml-2 text-xs text-[#949ba4]">{new Date(msg.timestamp).toLocaleString()}</span></div><p className="whitespace-pre-wrap break-words text-[#dbdee1] leading-5">{msg.content || <span className="text-[#949ba4]">(no content)</span>}</p><div className="text-[10px] text-[#6d7480] mt-1">id {msg.id} · author {msg.author_id || 'unknown'}</div></div>
          </article>)}
        </div>
      </section>
      <aside className="w-[340px] border-l border-[#27292f] bg-[#2b2d31] p-4 overflow-y-auto scrollbar">
        <h2 className="text-white font-semibold mb-3">Threads in #{room.name}</h2>
        <div className="space-y-2">{room.threads.map(t => { const disabled = t.counter.messages === 0; return <button key={t.id} disabled={disabled} onClick={() => onThread(t)} className={`w-full rounded-lg p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${disabled ? '' : 'cursor-pointer hover:bg-[#35373c]'} ${selectedThread?.id === t.id ? 'bg-[#404249]' : 'bg-[#313338]'}`}>
          <div className="text-white font-medium truncate">🧵 {t.name}</div><div className="text-xs text-[#b5bac1] mt-1">{t.counter.messages} msgs · {t.status}</div><div className="text-[10px] text-[#6d7480] truncate mt-1">parent #{room.name} · {t.cursor?.timestamp || 'no cursor'}</div>
        </button>; })}</div>
      </aside>
    </div>
  </main>;
}
function Counter({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-[#232428] px-3 py-2 min-w-[78px]"><div className="text-white font-bold leading-4">{value}</div><div className="text-xs text-[#949ba4]">{label}</div></div>; }
function CursorCard({ cursor, status }: { cursor: any; status: string }) { return <div className="rounded-xl border-l-4 border-[#f0b232] bg-[#3a312e] p-4 text-sm"><div className="text-white font-semibold">Cursor / Status</div><div className="text-[#dbdee1] mt-1">status: <span className="text-[#23a55a]">{status}</span></div><div className="text-[#b5bac1] break-all">last: {cursor ? `${cursor.messageId} @ ${cursor.timestamp}` : 'none'}</div></div>; }
