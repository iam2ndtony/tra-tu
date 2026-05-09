'use client';

import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
}

interface Group {
  id: string;
  name: string;
  words: string[];
}

interface PreviewResult {
  word: string;
  meanings: string;
  ipa: string;
  type: string;
}

const voices = [
  { label: 'English (US)', value: 'en-US' },
  { label: 'English (UK)', value: 'en-GB' },
  { label: 'Chinese (Mandarin)', value: 'zh-CN' },
  { label: 'Vietnamese', value: 'vi-VN' },
];


const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

function audioBufferToWav(buffer: AudioBuffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2 + 44;
  const arrayBuffer = new ArrayBuffer(length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  let offset = 0;
  writeString(offset, 'RIFF');
  offset += 4;
  view.setUint32(offset, 36 + buffer.length * numChannels * 2, true);
  offset += 4;
  writeString(offset, 'WAVE');
  offset += 4;
  writeString(offset, 'fmt ');
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * numChannels * 2, true);
  offset += 4;
  view.setUint16(offset, numChannels * 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString(offset, 'data');
  offset += 4;
  view.setUint32(offset, buffer.length * numChannels * 2, true);
  offset += 4;

  const interleave = (output: DataView, offset: number, channelData: Float32Array[]) => {
    let pointer = offset;
    for (let i = 0; i < buffer.length; i += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        output.setInt16(pointer, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        pointer += 2;
      }
    }
  };

  const channelData = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  interleave(view, offset, channelData);
  return new Blob([view], { type: 'audio/wav' });
}

async function fetchSpeechBlob(word: string, voice: string) {
  const url = `/api/tts?text=${encodeURIComponent(word)}&voice=${encodeURIComponent(voice)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS request failed: ${response.status} ${errorText}`);
  }

  return response.blob();
}

async function decodeAudioBuffer(blob: Blob) {
  const ctx = new AudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

function joinAudioBuffers(buffers: AudioBuffer[], pauseSeconds = 3) {
  if (buffers.length === 0) {
    throw new Error('Không có âm thanh để ghép.');
  }

  const sampleRate = buffers[0].sampleRate;
  const channelCount = buffers[0].numberOfChannels;
  const pauseLength = Math.round(pauseSeconds * sampleRate);
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0) + (pauseLength * (buffers.length - 1));
  const output = new AudioContext().createBuffer(channelCount, totalLength, sampleRate);

  let offset = 0;

  buffers.forEach((buffer, index) => {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const outputData = output.getChannelData(channel);
      const inputData = buffer.getChannelData(channel < buffer.numberOfChannels ? channel : 0);
      outputData.set(inputData, offset);
    }
    offset += buffer.length;
    if (index < buffers.length - 1) {
      offset += pauseLength;
    }
  });

  return output;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dictionary' | 'tts'>('dictionary');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newWords, setNewWords] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [ttsVoice, setTtsVoice] = useState('en-US');
  const [status, setStatus] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [combinedOnlyUrl, setCombinedOnlyUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pauseSeconds, setPauseSeconds] = useState(3);
  const [includeDefinition, setIncludeDefinition] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [downloadAll, setDownloadAll] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editingId, setEditingId] = useState<{ msgId: string, lineIdx: number } | null>(null);
  const [onlyCombined, setOnlyCombined] = useState(false);

  // Persistence logic
  useEffect(() => {
    const savedGroups = localStorage.getItem('tts-groups');
    if (savedGroups) {
      try {
        const parsed = JSON.parse(savedGroups);
        setGroups(parsed);
        if (parsed.length > 0) setSelectedGroupId(parsed[0].id);
      } catch (e) {
        console.error('Lỗi khi tải dữ liệu đã lưu:', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('tts-groups', JSON.stringify(groups));
  }, [groups]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId],
  );

  const playAudio = async (text: string, voice: string) => {
    try {
      const blob = await fetchSpeechBlob(text, voice);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (error) {
      console.error('Lỗi khi phát âm thanh:', error);
    }
  };

  const deleteGroup = (id: string) => {
    if (!confirm('Bạn có chắc muốn xóa nhóm này?')) return;
    setGroups((prev) => prev.filter((g) => g.id !== id));
    if (selectedGroupId === id) setSelectedGroupId('');
  };

  const deleteWord = (groupId: string, wordIdx: number) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      const newWords = [...g.words];
      newWords.splice(wordIdx, 1);
      return { ...g, words: newWords };
    }));
  };

  const handleDictionarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    const words = input.split(/[\n,]+/).map((w) => w.trim()).filter(Boolean);

    try {
      const response = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      });
      const data = await response.json();

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: data.error ? data.error : data.results.join('\n'),
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: 'Lỗi khi tra cứu từ điển.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateMessage = (msgId: string, lineIdx: number, parts: string[]) => {
    setMessages((prev) => prev.map((msg) => {
      if (msg.id !== msgId) return msg;
      const lines = msg.content.split('\n');
      lines[lineIdx] = parts.join(',');
      return { ...msg, content: lines.join('\n') };
    }));
  };

  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      setStatus('Nhóm đã tồn tại.');
      return;
    }

    const id = `${Date.now()}-${name.replace(/\s+/g, '-')}`;
    const group: Group = { id, name, words: [] };
    setGroups((prev) => [...prev, group]);
    setSelectedGroupId(id);
    setNewGroupName('');
    setStatus(`Đã tạo nhóm “${name}”.`);
  };

  const addWordsToGroup = (wordsToAdd?: string[]) => {
    if (!selectedGroup) {
      setStatus('Vui lòng tạo và chọn nhóm trước.');
      return;
    }

    const parsed = wordsToAdd || newWords.split(/[\n,]+/).map((w) => w.trim()).filter(Boolean);
    if (parsed.length === 0) {
      setStatus('Vui lòng nhập ít nhất một từ.');
      return;
    }

    setGroups((prev) => prev.map((group) => {
      if (group.id !== selectedGroup.id) return group;
      return { ...group, words: [...group.words, ...parsed] };
    }));
    setNewWords('');
    setStatus(`Đã thêm ${parsed.length} từ vào nhóm “${selectedGroup.name}”.`);
  };

  const createZip = async (mode: 'zip' | 'combined-only' = 'zip') => {
    const targets = downloadAll ? groups : (selectedGroup ? [selectedGroup] : []);

    if (targets.length === 0) {
      setStatus(downloadAll ? 'Chưa có nhóm nào để tải.' : 'Vui lòng chọn nhóm cần tải.');
      return;
    }

    setProcessing(true);
    setStatus('Đang bắt đầu...');
    setDownloadUrl(null);
    setCombinedOnlyUrl(null);
    setProgress(0);

    try {
      const zip = new JSZip();
      const totalWords = targets.reduce((sum, g) => sum + g.words.length, 0);
      let processedWords = 0;

      for (const group of targets) {
        if (group.words.length === 0) continue;

        const folder = zip.folder(normalizeFileName(group.name)) || zip;
        const allBuffers: AudioBuffer[] = [];

        for (let i = 0; i < group.words.length; i++) {
          const rawWord = group.words[i];
          let wordToSpeak = rawWord;
          let fileName = rawWord;

          if (autoTranslate) {
            setStatus(`${group.name}: Đang dịch ${rawWord}...`);
            const res = await fetch('/api/lookup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ words: [rawWord] }),
            });
            const data = await res.json();
            if (data.results && data.results[0]) {
              wordToSpeak = data.results[0].split(',')[1] || rawWord;
            }
          }

          processedWords++;
          setProgress(Math.round((processedWords / totalWords) * 90));
          setStatus(`${group.name}: ${i + 1}/${group.words.length} - ${rawWord}`);

          const wordBlob = await fetchSpeechBlob(wordToSpeak, ttsVoice);
          const wordBuffer = await decodeAudioBuffer(wordBlob);
          allBuffers.push(wordBuffer);

          if (mode !== 'combined-only') {
            folder.file(`${i + 1}. ${normalizeFileName(fileName)}.mp3`, wordBlob);
          }

          if (includeDefinition) {
            const res = await fetch('/api/lookup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ words: [rawWord] }),
            });
            const data = await res.json();
            if (data.results && data.results[0]) {
              const definition = data.results[0].split(',')[1] || '';
              if (definition) {
                const defBlob = await fetchSpeechBlob(definition, 'vi-VN');
                const defBuffer = await decodeAudioBuffer(defBlob);
                allBuffers.push(defBuffer);
                if (mode !== 'combined-only') {
                  folder.file(`${i + 1}. ${normalizeFileName(fileName)}_definition.mp3`, defBlob);
                }
              }
            }
          }
          await delay(300);
        }

        if (allBuffers.length > 0) {
          const merged = joinAudioBuffers(allBuffers, pauseSeconds);
          const combinedBlob = audioBufferToWav(merged);

          if (mode === 'combined-only' && !downloadAll) {
            setCombinedOnlyUrl(URL.createObjectURL(combinedBlob));
          } else {
            folder.file('0. Combined.wav', combinedBlob);
          }
        }
      }

      if (mode === 'zip' || downloadAll) {
        setStatus('Đang nén ZIP...');
        setProgress(95);
        const content = await zip.generateAsync({ type: 'blob' });
        setDownloadUrl(URL.createObjectURL(content));
      }

      setProgress(100);
      setStatus('Hoàn thành! Nhấn tải về.');
    } catch (error) {
      console.error(error);
      setStatus('Lỗi khi tạo âm thanh.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.25),_transparent_30%),#0f172a] text-slate-100 font-sans">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-[32px] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-200/80">Tra Tu</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Test cho Tran Hung</h1>
            </div>
            <div className="flex gap-2 rounded-3xl bg-slate-950/50 px-4 py-3 text-sm text-slate-200 shadow-lg shadow-slate-950/20">
              <button className={activeTab === 'dictionary' ? 'rounded-full bg-cyan-500/95 px-6 py-2 font-semibold text-white shadow-lg shadow-cyan-500/20' : 'px-6 py-2 transition hover:text-cyan-400'} onClick={() => setActiveTab('dictionary')}>Tra từ</button>
              <button className={activeTab === 'tts' ? 'rounded-full bg-cyan-500/95 px-6 py-2 font-semibold text-white shadow-lg shadow-cyan-500/20' : 'px-6 py-2 transition hover:text-cyan-400'} onClick={() => setActiveTab('tts')}>Quản lý Nhóm</button>
            </div>
          </div>
        </header>

        <main>
          {activeTab === 'dictionary' ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
              <section className="space-y-6">
                <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-xl">
                  <h2 className="text-2xl font-semibold mb-6">Tra cứu từ điển</h2>
                  <form onSubmit={handleDictionarySubmit} className="space-y-4">
                    <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} placeholder="Nhập danh sách từ (xuống dòng hoặc dấu phẩy)..." className="w-full resize-none rounded-3xl border border-slate-700/80 bg-slate-950/80 px-6 py-4 text-slate-100 outline-none transition focus:border-cyan-400 text-lg" />
                    <button type="submit" disabled={loading} className="rounded-full bg-cyan-500 px-10 py-4 font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition shadow-lg shadow-cyan-500/20">{loading ? 'Đang tra...' : 'Tra cứu ngay'}</button>
                  </form>
                </div>

                <div className="space-y-4">
                  {messages.filter(m => m.type === 'bot').map((msg) => (
                    <div key={msg.id} className="space-y-4">
                      {msg.content.split('\n').map((line, i) => {
                        const parts = line.split(',');
                        const word = parts[0];
                        const meanings = parts[1];
                        const ipa = parts[2];
                        const type = parts[3];
                        const isError = meanings?.includes('(error)');
                        const isEditing = editingId?.msgId === msg.id && editingId?.lineIdx === i;

                        return (
                          <div key={i} className="rounded-3xl bg-slate-950/70 p-6 border border-white/5 shadow-lg group transition hover:border-cyan-500/30">
                            <div className="flex flex-col gap-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {isEditing ? (
                                    <input
                                      autoFocus
                                      defaultValue={word}
                                      className="bg-transparent border-b border-cyan-500 text-2xl font-bold text-white outline-none"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === word) return;
                                        const newParts = [...parts];
                                        newParts[0] = e.target.value;
                                        handleUpdateMessage(msg.id, i, newParts);
                                      }}
                                    />
                                  ) : (
                                    <span className="text-2xl font-bold text-white">{word}</span>
                                  )}

                                  {isEditing ? (
                                    <input
                                      defaultValue={type}
                                      className="bg-slate-800 rounded-md px-2 py-0.5 text-[10px] text-slate-400 font-bold uppercase outline-none w-20"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === type) return;
                                        const newParts = [...parts];
                                        newParts[3] = e.target.value;
                                        handleUpdateMessage(msg.id, i, newParts);
                                      }}
                                    />
                                  ) : (
                                    type && <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-wider">{type}</span>
                                  )}

                                  {isEditing ? (
                                    <input
                                      defaultValue={ipa}
                                      className="text-sm text-cyan-400/60 font-mono bg-transparent border-b border-cyan-500/30 outline-none"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === ipa) return;
                                        const newParts = [...parts];
                                        newParts[2] = e.target.value;
                                        handleUpdateMessage(msg.id, i, newParts);
                                      }}
                                    />
                                  ) : (
                                    ipa && <span className="text-sm text-cyan-400/60 font-mono">{ipa}</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => setEditingId(isEditing ? null : { msgId: msg.id, lineIdx: i })}
                                  className={`p-2 rounded-full hover:bg-white/10 transition ${isEditing ? 'opacity-100 bg-cyan-500/20' : 'opacity-0 group-hover:opacity-100'}`}
                                >
                                  {isEditing ? '✅' : '✏️'}
                                </button>
                              </div>

                              {isEditing ? (
                                <textarea
                                  defaultValue={meanings}
                                  rows={2}
                                  className="w-full bg-slate-900/50 border border-cyan-500/30 rounded-2xl px-4 py-3 text-slate-200 text-lg outline-none focus:border-cyan-500"
                                  onBlur={(e) => {
                                    if (e.target.value === meanings) return;
                                    const newParts = [...parts];
                                    newParts[1] = e.target.value;
                                    handleUpdateMessage(msg.id, i, newParts);
                                  }}
                                />
                              ) : (
                                <p className={`${isError ? 'text-red-400' : 'text-slate-200'} text-lg leading-relaxed`}>
                                  {meanings}
                                </p>
                              )}

                              <div className="flex gap-3 pt-2">
                                <button onClick={() => playAudio(word, ttsVoice)} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 rounded-full text-sm font-semibold transition flex items-center gap-2">🔊 Nghe</button>
                                <button onClick={() => addWordsToGroup([word])} className="px-5 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 rounded-full text-sm font-semibold transition flex items-center gap-2">➕ Thêm vào nhóm</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {messages.length === 0 && <div className="text-center py-20 text-slate-500 italic">Nhập danh sách từ ở trên để bắt đầu tra cứu...</div>}
                </div>
              </section>
              <aside className="space-y-6">
                <div className="rounded-[32px] border border-white/10 bg-slate-950/50 p-6 shadow-xl backdrop-blur-xl">
                  <h3 className="text-xl font-semibold mb-4">Nhóm đang chọn</h3>
                  {selectedGroup ? (
                    <div className="p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                      <p className="font-bold text-cyan-300">{selectedGroup.name}</p>
                      <p className="text-xs text-slate-400 mt-1">{selectedGroup.words.length} từ đã lưu</p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 text-center py-4">Vui lòng chọn nhóm trong tab "Quản lý Nhóm" trước khi thêm từ.</p>
                  )}
                </div>
              </aside>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[280px_1fr_320px]">
              <aside className="space-y-6">
                <div className="rounded-[32px] border border-white/10 bg-slate-950/50 p-6 shadow-xl backdrop-blur-xl h-fit">
                  <h3 className="text-lg font-semibold mb-4">Danh sách nhóm</h3>
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                    {groups.map((group) => (
                      <div
                        key={group.id}
                        onClick={() => setSelectedGroupId(group.id)}
                        className={`w-full p-4 rounded-2xl text-left transition relative group cursor-pointer ${selectedGroupId === group.id ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-white/5 hover:bg-white/10 text-slate-300'}`}
                      >
                        <div className="truncate pr-6">{group.name}</div>
                        <div className={`text-[10px] mt-1 ${selectedGroupId === group.id ? 'text-slate-900' : 'text-slate-500'}`}>{group.words.length} từ</div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                          className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-red-500/20 transition opacity-0 group-hover:opacity-100`}
                        >🗑️</button>
                      </div>
                    ))}
                    <div className="pt-4 border-t border-white/5 mt-4">
                      <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Tên nhóm mới..." className="w-full bg-transparent border-b border-slate-700 px-2 py-2 outline-none focus:border-cyan-400 text-sm mb-3" />
                      <button onClick={createGroup} className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold transition">➕ Tạo nhóm</button>
                    </div>
                  </div>
                </div>
              </aside>

              <section className="space-y-6">
                {selectedGroup ? (
                  <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-xl min-h-[600px]">
                    <div className="flex justify-between items-end mb-8">
                      <div>
                        <h2 className="text-3xl font-bold text-white">{selectedGroup.name}</h2>
                        <p className="text-slate-400 mt-2">Danh sách từ vựng hiện tại</p>
                      </div>
                    </div>

                    <div className="mb-8">
                      <p className="text-sm font-semibold mb-3 text-slate-300">Thêm nhanh (Xuống dòng cho mỗi từ)</p>
                      <div className="flex gap-3">
                        <textarea value={newWords} onChange={(e) => setNewWords(e.target.value)} rows={2} placeholder="ví dụ:&#10;hello&#10;world" className="flex-1 rounded-2xl bg-slate-950/70 border border-slate-700/80 px-4 py-3 outline-none focus:border-cyan-400 text-sm leading-relaxed" />
                        <button onClick={() => addWordsToGroup()} className="bg-cyan-500 text-slate-950 rounded-2xl px-6 font-bold hover:bg-cyan-400 transition shadow-lg shadow-cyan-500/20 h-[fit-content] py-4 self-end">Thêm</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {selectedGroup.words.map((word, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-slate-900/40 p-4 rounded-2xl border border-white/5 group hover:bg-slate-900/60 transition">
                          <div className="flex items-center gap-4">
                            <span className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded-full text-[10px] text-slate-500 font-bold">{idx + 1}</span>
                            <span className="text-lg font-medium">{word}</span>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => playAudio(word, ttsVoice)} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition" title="Nghe">🔊</button>
                            <button onClick={() => deleteWord(selectedGroup.id, idx)} className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition" title="Xóa">🗑️</button>
                          </div>
                        </div>
                      ))}
                      {selectedGroup.words.length === 0 && (
                        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl text-slate-500 italic">Chưa có từ nào. Hãy thêm từ hoặc tra cứu ở tab bên kia!</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-xl backdrop-blur-xl flex flex-col items-center justify-center min-h-[600px] text-slate-500">
                    <div className="text-6xl mb-4">👈</div>
                    <p className="text-lg">Vui lòng chọn một nhóm ở bên trái để bắt đầu.</p>
                  </div>
                )}
              </section>

              <aside className="space-y-6">
                <div className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl sticky top-6">
                  <h3 className="text-xl font-bold mb-6 text-cyan-400 border-b border-white/10 pb-4">Xuất âm thanh</h3>

                  <div className="space-y-6">
                    {processing && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex justify-between text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
                          <span>Đang xử lý...</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ngôn ngữ TTS</p>
                      <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} className="w-full rounded-xl bg-slate-900 border border-slate-700 px-4 py-3 outline-none focus:border-cyan-400 text-sm appearance-none cursor-pointer">
                        {voices.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nghỉ giữa các từ</p>
                        <span className="text-xs font-bold text-cyan-400">{pauseSeconds} giây</span>
                      </div>
                      <input type="range" min="1" max="10" value={pauseSeconds} onChange={(e) => setPauseSeconds(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/5 mt-4">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-slate-300">Bao gồm nghĩa Việt</span>
                        <div className={`w-10 h-5 rounded-full transition relative ${includeDefinition ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                          <input type="checkbox" checked={includeDefinition} onChange={(e) => setIncludeDefinition(e.target.checked)} className="hidden" />
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${includeDefinition ? 'left-6' : 'left-1'}`} />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-slate-300">Dịch từ sang TTS</span>
                        <div className={`w-10 h-5 rounded-full transition relative ${autoTranslate ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                          <input type="checkbox" checked={autoTranslate} onChange={(e) => setAutoTranslate(e.target.checked)} className="hidden" />
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${autoTranslate ? 'left-6' : 'left-1'}`} />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-slate-300">Chỉ tải Audio Ghép</span>
                        <div className={`w-10 h-5 rounded-full transition relative ${onlyCombined ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                          <input type="checkbox" checked={onlyCombined} onChange={(e) => setOnlyCombined(e.target.checked)} className="hidden" />
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${onlyCombined ? 'left-6' : 'left-1'}`} />
                        </div>
                      </label>
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-slate-300">Tải tất cả nhóm</span>
                        <div className={`w-10 h-5 rounded-full transition relative ${downloadAll ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                          <input type="checkbox" checked={downloadAll} onChange={(e) => setDownloadAll(e.target.checked)} className="hidden" />
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${downloadAll ? 'left-6' : 'left-1'}`} />
                        </div>
                      </label>
                    </div>

                    <div className="pt-4 space-y-3">
                      <button
                        onClick={() => createZip(onlyCombined ? 'combined-only' : 'zip')}
                        disabled={processing || (!downloadAll && !selectedGroup)}
                        className="w-full bg-cyan-500 text-slate-950 rounded-2xl py-4 font-black text-sm hover:bg-cyan-400 shadow-xl shadow-cyan-500/20 disabled:opacity-50 transition-all active:scale-95 uppercase"
                      >
                        {processing ? 'Đang xử lý...' : (
                          onlyCombined
                            ? (downloadAll ? 'TẢI AUDIO GHÉP TẤT CẢ' : 'TẢI AUDIO GHÉP')
                            : (downloadAll ? 'TẢI TẤT CẢ (ZIP)' : 'TẠO FILE ZIP')
                        )}
                      </button>

                      {downloadUrl && (
                        <a href={downloadUrl} download={downloadAll ? "all-groups.zip" : `${normalizeFileName(selectedGroup?.name || 'audio')}.zip`} className="block text-center w-full bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 rounded-2xl py-4 text-sm font-bold hover:bg-cyan-500/30 transition animate-pulse">
                          📥 Tải File .ZIP
                        </a>
                      )}

                      {combinedOnlyUrl && (
                        <a href={combinedOnlyUrl} download={`${normalizeFileName(selectedGroup?.name || 'combined')}_combined.wav`} className="block text-center w-full bg-white/10 text-white rounded-2xl py-4 text-sm font-bold hover:bg-white/20 transition animate-pulse">
                          📥 Tải Audio Ghép (.wav)
                        </a>
                      )}
                    </div>

                    <div className="min-h-[20px]">
                      <p className="text-[10px] text-center text-cyan-400 font-bold uppercase tracking-tight leading-tight">{status}</p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
