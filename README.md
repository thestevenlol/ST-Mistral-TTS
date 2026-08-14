# Mistral Speech to Text for SillyTavern

A focused SillyTavern extension that records your microphone, transcribes the recording with Mistral Voxtral, and inserts the transcript into the chat message box for review.

It never sends the message automatically.

## Requirements

- A current SillyTavern installation with the Mistral transcription route.
- A MistralAI API key saved in SillyTavern under **API Connections → Chat Completion → MistralAI**.
- A browser with microphone and `MediaRecorder` support.
- HTTPS when SillyTavern is accessed from another device or hostname. Browsers generally block microphone access on insecure non-local origins.

The extension uses SillyTavern's `/api/openai/mistral/transcribe-audio` backend route, so the API key stays in SillyTavern and is not stored by this extension.

## Install

In SillyTavern, open **Extensions → Install Extension** and paste:

```text
https://github.com/thestevenlol/ST-Mistral-TTS
```

Reload SillyTavern after installation.

## Use

1. Click the microphone button beside the message controls.
2. Speak. The button changes to a red stop icon while recording.
3. Click the button again.
4. Wait for the spinner to finish.
5. Review or edit the transcript in the message box, then send it normally.

If text is already in the message box, the transcript is appended without deleting the draft.

## Troubleshooting

### No microphone prompt

Allow microphone access for the SillyTavern site in the browser's site permissions. If SillyTavern is hosted remotely, access it over HTTPS.

### Mistral transcription was rejected

Save or replace the MistralAI API key in SillyTavern, then try again. The extension deliberately has no separate API-key field.

### Transcription route not found

Update SillyTavern. Older versions do not include the Mistral transcription backend used by this extension.

### Two microphone buttons

SillyTavern's full Speech Recognition extension also supports Mistral. Disable that extension if you only want this focused microphone workflow.

