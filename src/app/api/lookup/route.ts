import { NextRequest, NextResponse } from 'next/server';

function formatGoogleTranslateWord(word: string, data: any): string {
  if (!data) {
    return `${word},(error) Từ không tìm thấy`;
  }

  const ipa = data[0]?.[1]?.[3] || '';
  let meaningsStr = '';
  let typeStr = '';

  if (data[1] && Array.isArray(data[1])) {
    const parts = data[1].map((p: any) => {
      let pos = p[0];
      if (pos === 'noun') pos = 'n';
      else if (pos === 'verb') pos = 'v';
      else if (pos === 'adjective') pos = 'adj';
      else if (pos === 'adverb') pos = 'adv';
      else if (pos === 'pronoun') pos = 'pron';
      else if (pos === 'preposition') pos = 'prep';
      else if (pos === 'conjunction') pos = 'conj';
      
      const definitions = p[1].slice(0, 3).join('/ ');
      return `(${pos}) ${definitions}`;
    });
    meaningsStr = parts.join(' ');
    
    const types = data[1].map((p: any) => {
      let pos = p[0];
      if (pos === 'noun') pos = 'n';
      else if (pos === 'verb') pos = 'v';
      else if (pos === 'adjective') pos = 'adj';
      else if (pos === 'adverb') pos = 'adv';
      else if (pos === 'pronoun') pos = 'pron';
      else if (pos === 'preposition') pos = 'prep';
      else if (pos === 'conjunction') pos = 'conj';
      return `(${pos})`;
    });
    typeStr = types.join(' ');
  } else if (data[0] && data[0][0] && data[0][0][0]) {
    meaningsStr = data[0][0][0];
  } else {
    return `${word},(error) Từ không tìm thấy`;
  }

  const ipaPart = ipa ? `/${ipa}/` : '';
  return `${word},${meaningsStr},${ipaPart},${typeStr}`.normalize('NFC');
}

export async function POST(request: NextRequest) {
  const { words } = await request.json();

  const results = await Promise.all(words.map(async (word: string) => {
    try {
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=bd&dt=t&dt=rm&q=${encodeURIComponent(word)}`);
      
      if (!response.ok) {
        return `${word},(error) Free API ${response.status}`;
      }

      const data = await response.json();
      return formatGoogleTranslateWord(word, data);
    } catch (error) {
      return `${word},(error) Lỗi khi tra cứu`;
    }
  }));

  return NextResponse.json({ results });
}
