import { getRequestHeaders } from '../../../../script.js';

const BUTTON_ID = 'mistral_stt_button';
const TRANSCRIPTION_ENDPOINT = '/api/openai/mistral/transcribe-audio';
const TRANSCRIPTION_MODEL = 'voxtral-mini-latest';
const COMPOSER_TIMEOUT_MS = 15_000;

let initializationPromise;
let button;
let mediaRecorder;
let mediaStream;
let audioChunks = [];
let state = 'idle';
let composerObserver;
let remountQueued = false;

export function init() {
    initializationPromise ??= initialize();
    return initializationPromise;
}

async function initialize() {
    await domReady();
    await mountButton();
    observeComposer();
}

async function mountButton() {
    const existingButton = document.getElementById(BUTTON_ID);
    if (existingButton) {
        button = existingButton;
        updateButtonState(state);
        return;
    }

    const container = await findComposerContainer();
    button = document.createElement('div');
    button.id = BUTTON_ID;
    button.className = 'fa-solid fa-microphone speech-toggle interactable mistral-stt-button';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.addEventListener('click', toggleRecording);
    button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleRecording();
        }
    });

    container.prepend(button);
    updateButtonState('idle');
    console.info('[Mistral STT] Microphone button ready.');
}

function observeComposer() {
    composerObserver?.disconnect();
    composerObserver = new MutationObserver(() => {
        if (document.getElementById(BUTTON_ID) || remountQueued) {
            return;
        }

        remountQueued = true;
        setTimeout(() => {
            remountQueued = false;
            void mountButton().catch(error => console.error('[Mistral STT] Could not remount microphone button.', error));
        }, 0);
    });
    composerObserver.observe(document.body, { childList: true, subtree: true });
}

async function toggleRecording() {
    if (state === 'starting' || state === 'transcribing') {
        return;
    }

    if (state === 'recording') {
        stopRecording();
        return;
    }

    await startRecording();
}

async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        showError('This browser does not support microphone recording.');
        return;
    }

    updateButtonState('starting');

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            },
        });

        audioChunks = [];
        const mimeType = getPreferredRecordingMimeType();
        mediaRecorder = mimeType
            ? new MediaRecorder(mediaStream, { mimeType })
            : new MediaRecorder(mediaStream);

        mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data?.size) {
                audioChunks.push(event.data);
            }
        });
        mediaRecorder.addEventListener('stop', handleRecordingStopped, { once: true });
        mediaRecorder.addEventListener('error', event => {
            console.error('[Mistral STT] MediaRecorder error.', event.error ?? event);
            cleanupMedia();
            updateButtonState('idle');
            showError('Recording failed. Check the browser microphone permission.');
        }, { once: true });

        mediaRecorder.start();
        updateButtonState('recording');
    } catch (error) {
        console.error('[Mistral STT] Could not start recording.', error);
        cleanupMedia();
        updateButtonState('idle');

        if (error?.name === 'NotAllowedError') {
            showError('Microphone permission was denied. Allow it for this SillyTavern site and try again.');
        } else {
            showError('Could not access the microphone.');
        }
    }
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        cleanupMedia();
        updateButtonState('idle');
        return;
    }

    updateButtonState('transcribing');
    mediaRecorder.stop();
}

async function handleRecordingStopped() {
    const recordingType = mediaRecorder?.mimeType || audioChunks[0]?.type || 'audio/webm';
    const recordedAudio = new Blob(audioChunks, { type: recordingType });
    audioChunks = [];
    cleanupMedia();

    try {
        if (!recordedAudio.size) {
            throw new Error('The recording was empty.');
        }

        const wavAudio = await convertToMonoWav(recordedAudio);
        const transcript = await transcribe(wavAudio);
        insertTranscript(transcript);
        globalThis.toastr?.success('Transcript added to the message box.', 'Mistral STT');
    } catch (error) {
        console.error('[Mistral STT] Transcription failed.', error);
        showError(toUserMessage(error));
    } finally {
        updateButtonState('idle');
    }
}

async function transcribe(wavAudio) {
    const requestData = new FormData();
    requestData.append('avatar', wavAudio, 'record.wav');
    requestData.append('model', TRANSCRIPTION_MODEL);

    const response = await fetch(TRANSCRIPTION_ENDPOINT, {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: requestData,
    });

    if (!response.ok) {
        const detail = await readErrorDetail(response);
        const error = new Error(detail);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    const transcript = String(data?.text ?? '').trim();
    if (!transcript) {
        throw new Error('Mistral returned an empty transcript.');
    }

    return transcript;
}

function insertTranscript(transcript) {
    const textarea = document.getElementById('send_textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error('SillyTavern message box was not found.');
    }

    const existing = textarea.value;
    const separator = existing && !/\s$/.test(existing) ? ' ' : '';
    textarea.value = `${existing}${separator}${transcript}`;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function convertToMonoWav(recordedAudio) {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) {
        throw new Error('This browser cannot convert the recording to WAV.');
    }

    const audioContext = new AudioContextClass();
    try {
        const source = await recordedAudio.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(source.slice(0));
        return encodeMonoPcm16Wav(audioBuffer);
    } finally {
        await audioContext.close().catch(() => undefined);
    }
}

function encodeMonoPcm16Wav(audioBuffer) {
    const frameCount = audioBuffer.length;
    const channelCount = audioBuffer.numberOfChannels;
    const bytesPerSample = 2;
    const dataSize = frameCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
        let sample = 0;
        for (const channel of channels) {
            sample += channel[frame];
        }
        sample = Math.max(-1, Math.min(1, sample / channelCount));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
    }
}

function getPreferredRecordingMimeType() {
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
    }

    const candidates = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ];

    return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

function updateButtonState(nextState) {
    state = nextState;
    if (!button) {
        return;
    }

    button.classList.remove('fa-microphone', 'fa-stop', 'fa-spinner', 'fa-spin', 'recording', 'transcribing');

    if (state === 'recording') {
        button.classList.add('fa-stop', 'recording');
        button.title = 'Stop recording and transcribe';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', 'true');
        return;
    }

    if (state === 'transcribing') {
        button.classList.add('fa-spinner', 'fa-spin', 'transcribing');
        button.title = 'Transcribing with Mistral';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', 'false');
        return;
    }

    if (state === 'starting') {
        button.classList.add('fa-spinner', 'fa-spin', 'transcribing');
        button.title = 'Opening microphone';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', 'false');
        return;
    }

    button.classList.add('fa-microphone');
    button.title = 'Record with Mistral speech-to-text';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', 'false');
}

function cleanupMedia() {
    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = undefined;
    mediaRecorder = undefined;
}

async function readErrorDetail(response) {
    const text = await response.text();
    if (!text) {
        return response.statusText || `HTTP ${response.status}`;
    }

    try {
        const data = JSON.parse(text);
        return formatErrorDetail(data?.message ?? data?.detail ?? data?.error ?? data);
    } catch {
        return text.slice(0, 500);
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
        return detail.map(formatErrorDetail).join('; ');
    }
    return formatErrorDetail(detail.message ?? detail.msg ?? detail.detail ?? JSON.stringify(detail));
}

function toUserMessage(error) {
    if (error?.status === 400) {
        return 'Mistral transcription was rejected. Make sure a MistralAI API key is saved in SillyTavern.';
    }
    if (error?.status === 404) {
        return 'This SillyTavern version does not provide the Mistral transcription route. Update SillyTavern and try again.';
    }
    if (error?.status === 401 || error?.status === 403) {
        return 'Mistral rejected the saved API key or its permissions.';
    }
    return String(error?.message ?? error);
}

function showError(message) {
    globalThis.toastr?.error(message, 'Mistral STT', {
        timeOut: 10_000,
        extendedTimeOut: 20_000,
        preventDuplicates: true,
    });
}

function domReady() {
    if (document.readyState !== 'loading') {
        return Promise.resolve();
    }
    return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

function findComposerContainer() {
    const find = () => document.getElementById('send_but_sheld')
        ?? document.getElementById('rightSendForm')
        ?? document.getElementById('send_form')
        ?? document.getElementById('send_textarea')?.parentElement;
    const existing = find();
    if (existing) {
        return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => {
            const container = find();
            if (container) {
                observer.disconnect();
                clearTimeout(timeout);
                resolve(container);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error('SillyTavern message controls were not found.'));
        }, COMPOSER_TIMEOUT_MS);
    });
}

export function dispose() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
    }
    cleanupMedia();
    composerObserver?.disconnect();
    composerObserver = undefined;
    button?.remove();
    button = undefined;
    initializationPromise = undefined;
    state = 'idle';
}

void init().catch(error => {
    console.error('[Mistral STT] Initialization failed.', error);
    showError('Could not add the Mistral microphone button. Check the browser console.');
});

