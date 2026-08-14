# st-mistral-TTS

A private-use SillyTavern extension that adds Mistral Voxtral as a native text-to-speech provider.

## Features

- Registers **Mistral** in SillyTavern's existing TTS provider selector.
- Uses SillyTavern's automatic narration, message narration buttons, playback queue, and character voice maps.
- Loads preset and custom voices from the Mistral API.
- Supports voice previews and non-streaming MP3 speech generation.
- Optionally removes Markdown, code blocks, and emoji before narration.
- Requires no server plugin or build step.

## Install

1. In SillyTavern, open **Extensions**.
2. Choose **Install Extension**.
3. Paste this repository's Git URL.
4. Reload SillyTavern if prompted.

For local development, clone this repository into:

```text
SillyTavern/public/scripts/extensions/third-party/st-mistral-TTS
```

## Configure

1. Open SillyTavern's **Text To Speech** extension panel.
2. Select **Mistral** as the provider.
3. Paste a Mistral API key and select **Save key**.
4. Select **Refresh** to load voices.
5. Assign a voice to the current character in SillyTavern's voice map.
6. Enable TTS and, optionally, automatic generation.

The default model is `voxtral-mini-tts-2603`. It can be changed in the provider settings if Mistral introduces a newer model identifier.

## API-key notice

This MVP calls `https://api.mistral.ai` directly from the browser. The API key is stored in browser `localStorage` under `st-mistral-tts-api-key`; it is not stored in the provider settings and is never deliberately logged.

Browser-side SillyTavern extensions running on the same installation may be able to access local storage. Use this version only in an installation where you trust every extension. The key can be removed with the provider's **Clear** button.

## Troubleshooting

### Mistral rejected the API key

Confirm that the key is current and that the Mistral account has access to Voxtral TTS.

### No voices appear

Select **Refresh** after saving the key. You can also switch **Voices to load** to **Preset and custom**.

### Network or CORS error

Open the browser developer console and look for a blocked request to `https://api.mistral.ai`. Direct browser access depends on the API's current CORS policy.

### HTTP 403 while generating speech

Mistral applies content moderation to TTS requests. The input may have been rejected even if the API key is valid.

## Current scope

This first version intentionally does not create, edit, or delete custom voices. Voice cloning and streaming playback can be added later.

