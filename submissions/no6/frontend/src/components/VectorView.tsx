import { useMemo, useState } from 'react';
import type { MirrorData, VectorPoint } from '../types';

type Props = { data: MirrorData };
type Cluster = { key: string; label: string; color: string; count: number; points: VectorPoint[]; x: number; y: number; z: number; terms: string[] };

export default function VectorView({ data }: Props) {
  const [rot, setRot] = useState({ x: -22, y: 34 });
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'story' | 'cloud'>('story');
  const [selected, setSelected] = useState<Cluster | null>(null);
  const points = useMemo(() => data.vectorPoints.filter(p => !filter || [p.room_name, p.thread_name, p.author_name, p.excerpt].join(' ').toLowerCase().includes(filter.toLowerCase())), [data.vectorPoints, filter]);
  const clusters = useMemo(() => clusterCounts(points, data), [points, data]);
  const active = selected || clusters[0];
  return <div className="h-full flex flex-col bg-[#313338]">
    <div className="h-14 px-5 border-b border-[#27292f] flex items-center gap-3 bg-[#2b2d31]">
      <div><div className="text-white font-semibold">Vector Meaning Map</div><div className="text-xs text-[#949ba4]">{points.length}/{data.vectorPoints.length} vectors · text-first clusters + optional 3D cloud</div></div>
      <button onClick={() => setMode('story')} className={`cursor-pointer rounded px-3 py-1 text-sm ${mode === 'story' ? 'bg-[#5865f2] text-white' : 'bg-[#313338]'}`}>Understand text</button>
      <button onClick={() => setMode('cloud')} className={`cursor-pointer rounded px-3 py-1 text-sm ${mode === 'cloud' ? 'bg-[#5865f2] text-white' : 'bg-[#313338]'}`}>3D cloud</button>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter topic/user/thread" className="ml-auto w-72 rounded bg-[#1e1f22] px-3 py-2 text-sm outline-none" />
    </div>
    {mode === 'story' ? <Story clusters={clusters} active={active} onSelect={setSelected}/> : <Cloud points={points.slice(0, 1800)} clusters={clusters} rot={rot} setRot={setRot} onSelect={setSelected}/>} 
  </div>;
}

function Story({ clusters, active, onSelect }: { clusters: Cluster[]; active?: Cluster; onSelect: (c: Cluster) => void }) {
  return <div className="flex-1 min-h-0 grid grid-cols-[1fr_420px] gap-0">
    <div className="overflow-y-auto scrollbar p-5 grid auto-rows-min grid-cols-2 xl:grid-cols-3 gap-3">
      {clusters.slice(0, 24).map(c => <button key={c.key} onClick={() => onSelect(c)} className={`cursor-pointer text-left rounded-xl border p-4 hover:bg-[#3a3c43] ${active?.key === c.key ? 'border-[#5865f2] bg-[#373a49]' : 'border-[#27292f] bg-[#2b2d31]'}`}>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: c.color }}/><h3 className="text-white font-semibold truncate">{c.label}</h3><span className="ml-auto text-xs text-[#b5bac1]">{c.count}</span></div>
        <div className="mt-3 flex flex-wrap gap-1">{c.terms.slice(0, 6).map(t => <span key={t} className="rounded bg-[#1e1f22] px-2 py-0.5 text-xs text-[#dbdee1]">{t}</span>)}</div>
        <p className="mt-3 text-sm text-[#b5bac1] line-clamp-3">{sample(c.points)?.excerpt || '(no content)'}</p>
      </button>)}
    </div>
    <aside className="bg-[#2b2d31] border-l border-[#27292f] p-4 overflow-y-auto scrollbar">
      <h2 className="text-white font-semibold">{active?.label || 'Select cluster'}</h2>
      <div className="text-xs text-[#949ba4] mt-1">{active?.count || 0} messages · center x/y/z {active ? `${active.x.toFixed(2)}, ${active.y.toFixed(2)}, ${active.z.toFixed(2)}` : '-'}</div>
      <div className="mt-3 flex flex-wrap gap-1">{active?.terms.map(t => <span key={t} className="rounded bg-[#1e1f22] px-2 py-1 text-xs">{t}</span>)}</div>
      <h3 className="mt-5 mb-2 text-white font-semibold">Representative messages</h3>
      <div className="space-y-2">{active?.points.slice(0, 10).map(p => <div key={p.id} className="rounded bg-[#313338] p-3 text-sm"><div className="text-xs text-[#949ba4]">{p.author_name || p.author_id || 'unknown'} · {p.timestamp}</div><div className="mt-1 text-[#dbdee1]">{p.excerpt || '(no content)'}</div><div className="mt-1 text-[10px] text-[#6d7480]">#{p.room_name}{p.thread_name ? ` / 🧵 ${p.thread_name}` : ''}</div></div>)}</div>
      <p className="mt-4 text-xs text-[#949ba4] leading-5">This view answers “what is this cluster about?” The 3D cloud answers “where are vectors placed?” Text meaning is easier in cluster cards than raw 3D dots.</p>
    </aside>
  </div>;
}

function Cloud({ points, clusters, rot, setRot, onSelect }: { points: VectorPoint[]; clusters: Cluster[]; rot: any; setRot: any; onSelect: (c: Cluster) => void }) {
  return <div className="flex-1 min-h-0 flex"><div className="flex-1 relative overflow-hidden perspective-[900px] bg-[radial-gradient(circle_at_center,#3b3d45,#313338_55%,#232428)]"><div className="absolute inset-8 border border-[#4e5058] rounded-2xl"/><div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}>{points.map(p => <Point key={p.id} point={p}/>)}{clusters.slice(0, 10).map(c => <button key={c.key} onClick={() => onSelect(c)} className="absolute cursor-pointer rounded bg-[#111318cc] px-2 py-1 text-xs text-white" style={{ left: `${50 + c.x * 38}%`, top: `${50 + c.y * 38}%`, transform: `translateZ(${c.z * 260}px)` }}>{c.label} · {c.count}</button>)}</div></div><aside className="w-80 bg-[#2b2d31] border-l border-[#27292f] p-4"><Control label="rotate X" value={rot.x} min={-70} max={20} onChange={x => setRot((r: any) => ({ ...r, x }))}/><Control label="rotate Y" value={rot.y} min={-90} max={90} onChange={y => setRot((r: any) => ({ ...r, y }))}/><p className="text-xs text-[#949ba4] leading-5">Labels are cluster centers. Dots are individual messages. Hover a dot for metadata.</p></aside></div>;
}

function Point({ point }: { point: VectorPoint }) { const left = 50 + point.x * 38, top = 50 + point.y * 38, z = point.z * 260; return <div title={`${point.room_name}${point.thread_name ? ' / ' + point.thread_name : ''}\n${point.author_name || point.author_id || 'unknown'}\n${point.excerpt}`} className="absolute w-2.5 h-2.5 rounded-full cursor-pointer opacity-75 hover:opacity-100 hover:scale-[2] transition-transform" style={{ left: `${left}%`, top: `${top}%`, background: point.color, transform: `translateZ(${z}px)`, boxShadow: `0 0 10px ${point.color}` }} />; }
function Control({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) { return <label className="block text-xs text-[#b5bac1] mb-3"><div className="mb-1">{label}</div><input className="w-full cursor-pointer" type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}/></label>; }
function sample(points: VectorPoint[]) { return points.find(p => p.excerpt && p.excerpt.length > 20) || points[0]; }
function clusterCounts(points: VectorPoint[], data: MirrorData): Cluster[] { const topicByKey = new Map((data.topics || []).map(t => [t.thread_id || t.room_id || t.topic_id, t])); const map = new Map<string, Cluster>(); for (const p of points) { const key = p.thread_id || p.room_id; const topic = topicByKey.get(key); const label = topic?.label || (p.thread_name ? `🧵 ${p.thread_name}` : `#${p.room_name}`); const prev = map.get(key) || { key, label, color: topic?.color || p.color, count: 0, points: [], x: 0, y: 0, z: 0, terms: topic?.keywords || [] }; prev.count++; prev.points.push(p); prev.x += p.x; prev.y += p.y; prev.z += p.z; map.set(key, prev); } return [...map.values()].map(c => ({ ...c, x: c.x / c.count, y: c.y / c.count, z: c.z / c.count, terms: c.terms.length ? c.terms : topTerms(c.points) })).sort((a, b) => b.count - a.count); }
function topTerms(points: VectorPoint[]) { const stop = new Set('the a an and or to of in is are be for with this that คือ แล้ว ครับ ค่ะ ได้ ไม่ มี เรา ผม มัน อ่ะ'.split(' ')); const counts = new Map<string, number>(); for (const p of points) for (const raw of p.excerpt.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []) if (!stop.has(raw)) counts.set(raw, (counts.get(raw) || 0) + 1); return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w); }
