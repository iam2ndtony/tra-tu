import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text')?.trim() ?? '';
  const voice = url.searchParams.get('voice') ?? 'en-US';

  if (!text) {
    return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
  }

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(voice)}&client=tw-ob&q=${encodeURIComponent(text)}`;

  const response = await fetch(ttsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
      Accept: 'audio/mpeg',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'text/plain' } });
  }

  const buffer = await response.arrayBuffer();
  return new Response(buffer, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
}
