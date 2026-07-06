import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChannelView from './components/ChannelView';
import SearchPanel from './components/SearchPanel';
import VectorView from './components/VectorView';
import type { MirrorData, Room, Thread } from './types';

export default function App() {
  const [data, setData] = useState<MirrorData | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'discord' | 'vectors'>('discord');

  useEffect(() => { fetch('/no10-data.json').then(r => r.json()).then((d: MirrorData) => { setData(d); setSelectedRoomId(d.guilds[0]?.rooms[0]?.id || ''); }); }, []);

  const guild = data?.guilds[0];
  const selectedRoom = useMemo<Room | null>(() => guild?.rooms.find(r => r.id === selectedRoomId) || guild?.rooms[0] || null, [guild, selectedRoomId]);

  if (!data || !guild) return <div className="h-screen bg-[#313338] text-white flex items-center justify-center">Loading No.10 X mirror (Derived from Kikyo)…</div>;
  return <div className="h-screen w-screen overflow-hidden bg-[#313338] text-[#dbdee1] flex">
    <Sidebar guild={guild} selected={selectedRoom} onSelect={(room) => { setSelectedRoomId(room.id); setSelectedThread(null); }} />
    <div className="flex-1 flex flex-col min-w-0">
      <div className="h-10 bg-[#232428] border-b border-[#1e1f22] flex items-center gap-2 px-3 text-sm">
        <button onClick={() => setView('discord')} className={`cursor-pointer rounded px-3 py-1 ${view === 'discord' ? 'bg-[#5865f2] text-white' : 'bg-[#313338] text-[#b5bac1]'}`}>Discord Mirror</button>
        <button onClick={() => setView('vectors')} className={`cursor-pointer rounded px-3 py-1 ${view === 'vectors' ? 'bg-[#5865f2] text-white' : 'bg-[#313338] text-[#b5bac1]'}`}>3D Vectors</button>
      </div>
      <SearchPanel data={data} query={query} setQuery={setQuery} onJump={(room, thread) => { setSelectedRoomId(room.id); setSelectedThread(thread || null); }} />
      {view === 'vectors' ? <VectorView data={data} /> : <ChannelView data={data} room={selectedRoom} selectedThread={selectedThread} onThread={setSelectedThread} />}
    </div>
  </div>;
}
