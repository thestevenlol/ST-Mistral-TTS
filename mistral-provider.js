import { getPreviewString, saveTtsProviderSettings } from '/scripts/extensions/tts/index.js';

const API_BASE_URL = 'https://api.mistral.ai/v1';
const API_KEY_STORAGE_KEY = 'st-mistral-tts-api-key';
const DEFAULT_MODEL = 'voxtral-mini-tts-2603';
const MAX_ERROR_LENGTH = 500;

const MIME_TYPES = Object.freeze({
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    pcm: 'audio/wav',
    flac: 'audio/flac',
    opus: 'audio/ogg; codecs=opus',
});

/**
 * A native SillyTavern TTS provider backed by Mistral's Voxtral TTS API.
 */
export class MistralTtsProvider {
    settings;
    voices = [];
    separator = ' ... ';
    audioElement = document.createElement('audio');
    apiKey = '';

    defaultSettings = Object.freeze({
        voiceMap: {},
        model: DEFAULT_MODEL,
        voiceType: 'all',
        cleanText: true,
    });

    get settingsHtml() {
        return `
            <div class="mistral-tts-settings">
                <p>Use Mistral Voxtral to narrate SillyTavern messages.</p>

                <div class="mistral-tts-warning">
                    <strong>Private-use MVP:</strong> the API key is stored in this browser's local storage.
                    Other browser-side extensions on this SillyTavern installation may be able to access it.
                </div>

                <label for="mistral_tts_api_key">Mistral API key</label>
                <div class="mistral-tts-key-row">
                    <input
                        id="mistral_tts_api_key"
                        class="text_pole"
                        type="password"
                        autocomplete="off"
                        placeholder="Paste a key to save or replace the current key"
                    />
                    <button id="mistral_tts_save_key" class="menu_button" type="button">Save key</button>
                    <button id="mistral_tts_clear_key" class="menu_button" type="button">Clear</button>
                </div>
                <small id="mistral_tts_key_state"></small>

                <label for="mistral_tts_model">Model</label>
                <input id="mistral_tts_model" class="text_pole" type="text" value="${DEFAULT_MODEL}" />

                <label for="mistral_tts_voice_type">Voices to load</label>
                <select id="mistral_tts_voice_type" class="text_pole">
                    <option value="all">Preset and custom</option>
                    <option value="preset">Preset only</option>
                    <option value="custom">Custom only</option>
                </select>

                <label class="checkbox_label mistral-tts-checkbox" for="mistral_tts_clean_text">
                    <input id="mistral_tts_clean_text" type="checkbox" />
                    <span>Remove Markdown, code blocks, and emoji before narration</span>
                </label>

                <div id="mistral_tts_status" class="mistral-tts-status" role="status" aria-live="polite"></div>
            </div>
        `;
    }

    async loadSettings(savedSettings) {
        this.settings = {
            ...structuredClone(this.defaultSettings),
            ...structuredClone(savedSettings ?? {}),
        };
        this.apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';

        $('#mistral_tts_model').val(this.settings.model);
        $('#mistral_tts_voice_type').val(this.settings.voiceType);
        $('#mistral_tts_clean_text').prop('checked', this.settings.cleanText);

        $('#mistral_tts_save_key').on('click', () => this.saveApiKey());
        $('#mistral_tts_clear_key').on('click', () => this.clearApiKey());
        $('#mistral_tts_api_key').on('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.saveApiKey();
            }
        });
        $('#mistral_tts_model').on('change', () => this.onSettingsChange());
        $('#mistral_tts_voice_type').on('change', async () => {
            this.onSettingsChange();
            await this.refreshVoicesWithFeedback({ throwOnError: false });
        });
        $('#mistral_tts_clean_text').on('change', () => this.onSettingsChange());

        this.updateKeyState();

        if (this.apiKey) {
            await this.refreshVoicesWithFeedback({ showToast: false, throwOnError: false });
        } else {
            this.setStatus('Enter a Mistral API key, then choose Refresh in the TTS panel.', 'warning');
        }
    }

    dispose() {
        this.audioElement.pause();
        this.audioElement.removeAttribute('src');
    }

    onSettingsChange() {
        this.settings.model = String($('#mistral_tts_model').val() || DEFAULT_MODEL).trim();
        this.settings.voiceType = String($('#mistral_tts_voice_type').val() || 'all');
        this.settings.cleanText = Boolean($('#mistral_tts_clean_text').prop('checked'));
        saveTtsProviderSettings();
    }

    async saveApiKey() {
        const input = document.getElementById('mistral_tts_api_key');
        const value = input?.value?.trim() ?? '';

        if (!value) {
            globalThis.toastr?.warning('Paste a Mistral API key first.', 'Mistral TTS');
            return;
        }

        localStorage.setItem(API_KEY_STORAGE_KEY, value);
        this.apiKey = value;
        input.value = '';
        this.updateKeyState();
        await this.refreshVoicesWithFeedback({ throwOnError: false });
    }

    clearApiKey() {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        this.apiKey = '';
        this.voices = [];
        $('#mistral_tts_api_key').val('');
        this.updateKeyState();
        this.setStatus('API key cleared.', 'warning');
        globalThis.toastr?.success('The locally stored Mistral API key was removed.', 'Mistral TTS');
    }

    updateKeyState() {
        const state = $('#mistral_tts_key_state');
        state.text(this.apiKey ? 'A key is saved locally in this browser.' : 'No API key is saved.');
        state.toggleClass('mistral-tts-key-saved', Boolean(this.apiKey));
    }

    async checkReady() {
        this.requireApiKey();

        if (!this.voices.length) {
            this.voices = await this.fetchTtsVoiceObjects();
        }
    }

    async onRefreshClick() {
        await this.refreshVoicesWithFeedback();
    }

    async refreshVoicesWithFeedback({ showToast = true, throwOnError = true } = {}) {
        try {
            this.requireApiKey();
            this.setStatus('Loading voices…');
            this.voices = await this.fetchTtsVoiceObjects();
            this.setStatus(`${this.voices.length} Mistral voice${this.voices.length === 1 ? '' : 's'} available.`, 'success');

            if (showToast) {
                globalThis.toastr?.success(`Loaded ${this.voices.length} Mistral voices.`, 'Mistral TTS');
            }

            return this.voices;
        } catch (error) {
            const message = this.toUserMessage(error);
            this.setStatus(message, 'error');

            if (showToast) {
                globalThis.toastr?.error(message, 'Mistral TTS');
            }

            if (throwOnError) {
                throw error;
            }

            return [];
        }
    }

    async fetchTtsVoiceObjects() {
        this.requireApiKey();
        const type = encodeURIComponent(this.settings?.voiceType ?? 'all');
        const pageSize = 100;
        const voices = [];
        let offset = 0;

        while (true) {
            const response = await this.mistralFetch(`/audio/voices?limit=${pageSize}&offset=${offset}&type=${type}`);
            const data = await response.json();

            if (!Array.isArray(data?.items)) {
                throw new Error('Mistral returned an invalid voice list.');
            }

            voices.push(...data.items);

            const total = Number(data.total);
            if (data.items.length === 0 || data.items.length < pageSize || (Number.isFinite(total) && voices.length >= total)) {
                break;
            }

            offset += data.items.length;
        }

        const namesSeen = new Map();
        return voices.map(voice => {
            const baseName = String(voice.name || voice.slug || voice.id || 'Unnamed voice');
            const count = namesSeen.get(baseName) ?? 0;
            namesSeen.set(baseName, count + 1);
            const displayName = count === 0 ? baseName : `${baseName} (${String(voice.id).slice(-6)})`;

            return {
                name: displayName,
                voice_id: String(voice.id),
                lang: Array.isArray(voice.languages) ? voice.languages[0] : undefined,
            };
        });
    }

    async getVoice(voiceName) {
        if (!this.voices.length) {
            this.voices = await this.fetchTtsVoiceObjects();
        }

        const voice = this.voices.find(item => item.name === voiceName || item.voice_id === voiceName);
        if (!voice) {
            throw new Error(`Mistral voice not found: ${voiceName}`);
        }

        return voice;
    }

    async generateTts(text, voiceId) {
        this.requireApiKey();

        const input = this.settings?.cleanText ? cleanNarrationText(text) : String(text ?? '').trim();
        if (!input) {
            throw new Error('There is no speakable text after cleanup.');
        }

        const response = await this.mistralFetch('/audio/speech', {
            method: 'POST',
            body: JSON.stringify({
                model: this.settings?.model || DEFAULT_MODEL,
                input,
                voice_id: voiceId,
                response_format: 'mp3',
                stream: false,
            }),
        });
        const data = await response.json();

        if (!data?.audio_data || typeof data.audio_data !== 'string') {
            throw new Error('Mistral returned no audio data.');
        }

        return createAudioResponse(data.audio_data, 'mp3');
    }

    async previewTtsVoice(voiceId) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;

        let audioResponse;
        try {
            const response = await this.mistralFetch(`/audio/voices/${encodeURIComponent(voiceId)}/sample`);
            audioResponse = await normalizeSampleResponse(response);
        } catch (error) {
            console.warn('[Mistral TTS] Voice sample unavailable; generating a short preview.', error);
            audioResponse = await this.generateTts(getPreviewString('en-US'), voiceId);
        }

        const audio = await audioResponse.blob();
        const url = URL.createObjectURL(audio);
        this.audioElement.src = url;
        this.audioElement.onended = () => URL.revokeObjectURL(url);
        this.audioElement.onerror = () => URL.revokeObjectURL(url);
        await this.audioElement.play();
    }

    async processText(text) {
        return this.settings?.cleanText ? cleanNarrationText(text) : text;
    }

    requireApiKey() {
        if (!this.apiKey) {
            throw new Error('No Mistral API key is saved.');
        }
    }

    async mistralFetch(path, options = {}) {
        try {
            const response = await fetch(`${API_BASE_URL}${path}`, {
                ...options,
                headers: {
                    Accept: 'application/json, audio/*',
                    Authorization: `Bearer ${this.apiKey}`,
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers ?? {}),
                },
            });

            if (!response.ok) {
                const detail = await readErrorDetail(response);
                throw new MistralApiError(response.status, detail);
            }

            return response;
        } catch (error) {
            if (error instanceof MistralApiError) {
                throw error;
            }

            throw new Error(
                'Could not reach the Mistral API. Check the network connection and browser CORS errors.',
                { cause: error },
            );
        }
    }

    setStatus(message, type = '') {
        const status = $('#mistral_tts_status');
        status
            .removeClass('success warning error')
            .addClass(type)
            .text(message);
    }

    toUserMessage(error) {
        if (error instanceof MistralApiError) {
            if (error.status === 401) return 'Mistral rejected the API key.';
            if (error.status === 403) return 'Mistral rejected this request (permission or content moderation).';
            if (error.status === 429) return 'Mistral rate limit reached. Try again shortly.';
            return `Mistral API error ${error.status}: ${error.detail}`;
        }

        return String(error?.message ?? error);
    }
}

class MistralApiError extends Error {
    constructor(status, detail) {
        const formattedDetail = formatErrorDetail(detail);
        super(`Mistral API error ${status}: ${formattedDetail}`);
        this.name = 'MistralApiError';
        this.status = status;
        this.detail = formattedDetail;
    }
}

async function readErrorDetail(response) {
    const text = (await response.text()).slice(0, MAX_ERROR_LENGTH);
    if (!text) return response.statusText || 'Request failed';

    try {
        const data = JSON.parse(text);
        return formatErrorDetail(data?.message ?? data?.detail ?? data?.error?.message ?? data);
    } catch {
        return text;
    }
}

function formatErrorDetail(detail) {
    if (detail === null || detail === undefined) {
        return 'Request failed';
    }

    if (typeof detail !== 'object') {
        return String(detail);
    }

    if (Array.isArray(detail)) {
        return detail.map(formatErrorDetail).filter(Boolean).join('; ') || 'Request failed';
    }

    const message = detail.message ?? detail.msg;
    if (message !== undefined) {
        const location = Array.isArray(detail.loc) ? detail.loc.join('.') : '';
        return `${location ? `${location}: ` : ''}${formatErrorDetail(message)}`;
    }

    if (detail.detail !== undefined) {
        return formatErrorDetail(detail.detail);
    }

    if (detail.error !== undefined) {
        return formatErrorDetail(detail.error);
    }

    try {
        return JSON.stringify(detail);
    } catch {
        return 'Request failed';
    }
}

async function normalizeSampleResponse(response) {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
        const audio = await response.blob();
        return new Response(audio, {
            headers: {
                'Content-Type': contentType.startsWith('audio/') ? contentType : 'audio/mpeg',
            },
        });
    }

    const text = await response.text();
    let base64 = text;

    try {
        const data = JSON.parse(text);
        base64 = data?.audio_data ?? data?.data ?? data;
    } catch {
        // Some API variants return a bare base64 string.
    }

    if (typeof base64 !== 'string' || !base64.trim()) {
        throw new Error('The voice sample response contained no audio.');
    }

    return createAudioResponse(base64.replace(/^"|"$/g, ''), 'mp3');
}

function createAudioResponse(base64, format) {
    const normalized = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Response(bytes, {
        headers: {
            'Content-Type': MIME_TYPES[format] ?? 'audio/mpeg',
        },
    });
}

export function cleanNarrationText(value) {
    return String(value ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*[-+*]\s+/gm, '')
        .replace(/[*_~|]/g, '')
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

