import { NextRequest, NextResponse } from 'next/server';
import idiomsData from '@/data/idioms.json';

const idioms = idiomsData as Record<string, { meaning: string; ipa: string; type: string }>;

async function getOxfordData(word: string) {
  const appId = process.env.OXFORD_APP_ID;
  const appKey = process.env.OXFORD_APP_KEY;

  if (!appId || !appKey) return null;

  try {
    const res = await fetch(
      `https://od-api.oxforddictionaries.com/api/v2/entries/en-us/${encodeURIComponent(word.toLowerCase())}`,
      {
        headers: { app_id: appId, app_key: appKey },
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    
    const entry = data.results?.[0]?.lexicalEntries?.[0]?.entries?.[0];
    const ipa = entry?.pronunciations?.[0]?.phoneticSpelling || '';
    const definition = entry?.senses?.[0]?.definitions?.[0] || '';
    const lexicalCategory = data.results?.[0]?.lexicalEntries?.[0]?.lexicalCategory?.text || '';

    return { ipa, definition, lexicalCategory };
  } catch (error) {
    return null;
  }
}

async function translateText(text: string, tl = 'vi'): Promise<string> {
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`
    );
    if (!res.ok) return text;
    const data = await res.json();
    return data[0]?.[0]?.[0] || text;
  } catch {
    return text;
  }
}

function formatGoogleTranslateWord(word: string, data: any): string {
  if (!data) return `${word},(error) Từ không tìm thấy`;

  const ipa = data[0]?.[1]?.[3] || '';
  let meaningsStr = '';
  let typeStr = '';

  if (data[1] && Array.isArray(data[1])) {
    const parts = data[1].map((p: any) => {
      let pos = p[0];
      const mapping: Record<string, string> = {
        noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv',
        pronoun: 'pron', preposition: 'prep', conjunction: 'conj'
      };
      pos = mapping[pos] || pos;
      const definitions = p[1].slice(0, 3).join('/ ');
      return `(${pos}) ${definitions}`;
    });
    meaningsStr = parts.join(' ');
    
    const types = data[1].map((p: any) => {
      let pos = p[0];
      return `(${mapping[pos] || pos})`;
    });
    typeStr = types.join(' ');
  } else if (data[0]?.[0]?.[0]) {
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
    const lowerWord = word.toLowerCase().trim();

    // 1. Check Idioms Map
    if (idioms[lowerWord]) {
      const { meaning, ipa, type } = idioms[lowerWord];
      return `${word},${meaning},/${ipa}/,(${type})`;
    }

    // 2. Try Oxford API for smarter data
    const oxford = await getOxfordData(word);
    if (oxford && oxford.definition) {
      const translatedMeaning = await translateText(oxford.definition);
      const ipaPart = oxford.ipa ? `/${oxford.ipa}/` : '';
      const typePart = oxford.lexicalCategory ? `(${oxford.lexicalCategory.toLowerCase()})` : '';
      return `${word},${translatedMeaning},${ipaPart},${typePart}`;
    }

    // 3. Fallback to Google Translate
    try {
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=bd&dt=t&dt=rm&q=${encodeURIComponent(word)}`);
      if (!response.ok) return `${word},(error) API Error ${response.status}`;
      const data = await response.json();
      return formatGoogleTranslateWord(word, data);
    } catch (error) {
      return `${word},(error) Lỗi tra cứu`;
    }
  }));

  return NextResponse.json({ results });
}

const mapping: Record<string, string> = {
  noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv',
  pronoun: 'pron', preposition: 'prep', conjunction: 'conj'
};
