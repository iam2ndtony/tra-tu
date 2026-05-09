import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text')?.trim() ?? '';
  const voice = url.searchParams.get('voice') ?? 'en-US';

  if (!text) {
    return NextResponse.json({ error: 'Missing text parameter' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;

  if (apiKey) {
    const langCode = voice.split('-').slice(0, 2).join('-');
    const requestBody = {
      input: { text },
      voice: { 
        languageCode: langCode,
        name: voice.includes('-') && voice.split('-').length > 2 ? voice : `${langCode}-Neural2-F` // Default to high quality if only en-US is passed
      },
      audioConfig: { audioEncoding: 'MP3' }
    };

    try {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const data = await response.json();
        const audioBuffer = Buffer.from(data.audioContent, 'base64');
        return new Response(audioBuffer, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
      } else {
        console.error('Google Cloud TTS Error:', await response.text());
        // Fallback to free API on error
      }
    } catch (e) {
      console.error('Google Cloud TTS Request Failed:', e);
      // Fallback to free API on error
    }
  }

  // Fallback to free Google Translate TTS
  const fallbackVoice = voice.split('-').slice(0, 2).join('-');
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(fallbackVoice)}&client=tw-ob&q=${encodeURIComponent(text)}`;

  const response = await fetch(ttsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9',
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
