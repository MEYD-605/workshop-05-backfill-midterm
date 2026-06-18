import { ChevronDown, Hash, Headphones, MicOff, Plus, Settings } from 'lucide-react';
import type { Guild, Room } from '../types';

type Props = { guild: Guild; selected: Room | null; onSelect: (room: Room) => void };

export default function Sidebar({ guild, selected, onSelect }: Props) {
  return <div className="flex h-full">
    <aside className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-3">
      <button className="w-12 h-12 cursor-pointer rounded-2xl bg-[#5865f2] flex items-center justify-center text-white font-bold text-xl" title="Mini lab">ML</button>
      <div className="w-8 h-px bg-[#35363c]" />
      {['K', 'AV', 'CL', 'B'].map((s, i) => <button key={s} disabled={i !== 0} className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${i === 0 ? 'cursor-pointer bg-[#2b2d31] text-white' : 'cursor-not-allowed opacity-50 bg-[#313338] text-[#b5bac1]'}`}>{s}</button>)}
      <button disabled className="mt-auto w-12 h-12 rounded-2xl bg-[#313338] flex items-center justify-center cursor-not-allowed opacity-50" title="Add server disabled in mirror"><Plus size={24} className="text-[#23a55a]" /></button>
    </aside>
    <aside className="w-[300px] bg-[#2b2d31] flex flex-col">
      <button disabled className="h-12 px-4 flex items-center justify-between text-white font-semibold discord-shadow cursor-not-allowed opacity-80">
        <span>{guild.name}</span><ChevronDown size={18}/>
      </button>
      <div className="p-3 border-b border-[#1f2023]"><div className="text-[#b5bac1] text-sm">Counters</div>
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs"><Stat label="rooms" value={guild.counter.rooms}/><Stat label="threads" value={guild.counter.threads}/><Stat label="msgs" value={guild.counter.messages}/></div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar px-2 py-4">
        <div className="flex items-center justify-between px-2 text-xs uppercase font-semibold text-[#949ba4]"><span>Text Channels</span><Plus size={16} className="cursor-not-allowed opacity-40"/></div>
        <div className="mt-1 space-y-0.5">
          {guild.rooms.map(room => { const total = room.counter.messages + room.threads.reduce((n, t) => n + t.counter.messages, 0); const disabled = total === 0; return <button key={room.id} disabled={disabled} onClick={() => onSelect(room)} className={`w-full h-9 px-2 rounded flex items-center gap-2 text-left group disabled:cursor-not-allowed disabled:opacity-40 ${disabled ? '' : 'cursor-pointer'} ${selected?.id === room.id ? 'bg-[#404249] text-white' : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'}`}>
            <Hash size={22}/><span className="flex-1 truncate font-medium">{room.name}</span><span className="text-[10px] text-[#949ba4]">{total}</span>
          </button>; })}
        </div>
      </div>
      <div className="h-[60px] bg-[#232428] px-2 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-[#23a55a] flex items-center justify-center text-white font-bold">K</div>
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">Kikyo</div><div className="text-xs text-[#b5bac1]">mirror online</div></div>
        {[MicOff, Headphones, Settings].map((Icon, i) => <button key={i} disabled className="cursor-not-allowed opacity-40"><Icon size={18}/></button>)}
      </div>
    </aside>
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded bg-[#1e1f22] px-2 py-1"><div className="text-white font-semibold">{value}</div><div className="text-[#949ba4]">{label}</div></div>;
}
