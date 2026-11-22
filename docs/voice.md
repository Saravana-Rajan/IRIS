# Talking to Iris (voice)

The Chat panel's mic sends what you say to Iris as a chat message, so voice can do anything chat can, filters
included ("colour the services by system", "isolate the ducts on Level 02": [filters.md](filters.md)). Recognition is
Gemini Flash on Vertex AI (`GEMINI_FAST_MODEL`). Iris answers in text.

Code:
- `server/iris/voice_live.py`: the server-side relay that buffers audio and sends whole clips to the fast model;
- `/api/voice/live` and `/api/transcribe` in `app.py`;
- `web/src/voice.ts`: `LiveVoice` (live) and `VoiceRecorder` (the upload fallback);
- `web/src/Chat.tsx`: the mic, the hands-free toggle, captions and the sentence queue.

## Using it

- **Hold to talk** (the default): hold the mic and speak. The clip is transcribed when you let go, and the message goes
  then (no partial words while you speak). A quick tap (under 300 ms) keeps the mic open; the next press sends. Space or Enter
  held on the focused mic works the same.
- **Hands-free** (the toggle beside the mic, remembered per browser): press the mic once, then just talk. Each
  sentence goes when you pause; sentences said while Iris is still answering wait their turn ("Next: …"). The mic
  closes on a press, after 2 minutes, after 30 s without speech, or when the tab is hidden. A single word is not sent
  (a cough, an "um").
- The status line sits above the message box, so the mic doesn't move under your finger.

## How it works

The model credentials (Vertex AI Application Default Credentials, or an optional `GEMINI_API_KEY`) stay on the
server, so the browser cannot call the model itself: the server relays.

```
mic → AudioWorklet (16 kHz, 16-bit, 80 ms frames) → /api/voice/live → buffer (+ RMS segments) → GEMINI_FAST_MODEL
                         words in the box ←  final  ←
```

**Browser → Iris:** one JSON frame `{mode: "hold" | "hands_free", report_id}`, binary audio frames, then
`{"type": "end"}`. The worklet averages the microphone down to 16 kHz itself; Firefox refuses to connect a microphone
to a 16 kHz AudioContext. The mic starts while the socket connects, and up to 1.5 s of early audio is sent at once when
it is ready, so the first words are not lost.

**Iris → Gemini:** Iris buffers the audio and sends whole clips to `model_client.transcribe` on the fast model
(`GEMINI_FAST_MODEL`), with the prompt biased by keywords: BIM words plus the open report's element names and titles,
as for the upload path. Hold sends the whole clip once, when the user lets go. Hands-free cuts segments by loudness
(`voice_live.Segmenter`): a frame whose RMS reaches `IRIS_VOICE_VAD_RMS` (default 500) starts speech, with 0.3 s of
audio kept from before it; `IRIS_VOICE_SILENCE_MS` (default 700) of quiet ends the segment, which is transcribed
then while the mic stays open. There are no partial words mid-speech.

**Iris → browser:** `ready {max_s}`, `final {text, turn}` (hold: once,
at the end; hands-free: each segment, in order), `speech {on}` (hands-free: speech started or ended), `limit`, `error {detail}`, then the socket closes (a `partial` event is not sent). Upstream
failures become words the user can act on (refused, a problem, busy).

**Limits:** one session counts as one voice message against `IRIS_VOICE_PER_HOUR` / `DAY` (hands-free too); the
owner has none. Hold runs up to 60 s, hands-free `IRIS_VOICE_LIVE_MAX_S` (120 s). Frames over 32 KB are refused.
A page on another origin cannot open the socket (its `Origin` must match `Host`), so other sites can't spend the model
budget through a visitor's browser. The owner cookie reaches the socket through `_OwnerContext`.

**Fallback:** if the socket can't open or isn't ready within 8 s, hold to talk records a clip instead (tap to stop),
which goes to `POST /api/transcribe` as before. Hands-free needs the live socket.

**Dev:** Vite proxies `/api` with `ws: true` and keeps the Host header, so the origin check passes on `localhost:5173`.

## Checked

- In Chromium with recorded speech as a fake microphone (Playwright, chat stubbed): a quick tap latches and the second
  press sends; with the socket blocked, the upload path transcribes and sends.
- A connection from another origin is refused (HTTP 403).
- Recognition latency and accuracy are not yet measured on Gemini. Not yet checked: a real human voice and a real
  microphone.
