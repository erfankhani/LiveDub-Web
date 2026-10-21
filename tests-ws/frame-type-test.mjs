// Test: what frame type does Gemini Live WS use for its responses?
// Node 24 native WebSocket: text frames arrive as `string`, binary frames as `ArrayBuffer`/`Blob`
const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=INVALID_KEY_TEST_FRAMETYPE';

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

ws.addEventListener('open', () => {
  console.log('[open] connected');
  const setup = {
    setup: {
      model: 'models/gemini-3.5-live-translate-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: 'fa', echoTargetLanguage: true },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
  console.log('[send] setup message');
  ws.send(JSON.stringify(setup));
  const b64 = Buffer.alloc(1600).toString('base64');
  ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } }));
  console.log('[send] audio chunk');
});

ws.addEventListener('message', (ev) => {
  const d = ev.data;
  const type = typeof d === 'string' ? 'TEXT FRAME (string)' : (d instanceof ArrayBuffer ? 'BINARY FRAME (ArrayBuffer)' : typeof d);
  console.log('>>> message | type =', type);
  const text = typeof d === 'string' ? d : Buffer.from(d).toString('utf8');
  console.log('    utf8 preview:', text.slice(0, 400));
});

ws.addEventListener('close', (ev) => {
  console.log('[close] code =', ev.code, '| reason =', ev.reason);
  process.exit(0);
});

ws.addEventListener('error', (err) => {
  console.log('[error]', err.message || err);
});

setTimeout(() => { console.log('[timeout] exiting'); process.exit(0); }, 15000);
