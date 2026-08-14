import { MistralTtsProvider } from './mistral-provider.js';

const PROVIDER_NAME = 'Mistral';
let initialized = false;

/**
 * Registers the provider with SillyTavern's built-in TTS extension.
 */
export async function init() {
    if (initialized) {
        return;
    }

    initialized = true;

    try {
        const { registerTtsProvider } = await import('/scripts/extensions/tts/index.js');
        registerTtsProvider(PROVIDER_NAME, MistralTtsProvider);
        console.info('[Mistral TTS] Provider registered.');
    } catch (error) {
        initialized = false;

        if (String(error?.message ?? error).includes('already registered')) {
            initialized = true;
            return;
        }

        console.error('[Mistral TTS] Failed to register provider.', error);
        globalThis.toastr?.error(
            'Could not register the Mistral TTS provider. Check the browser console for details.',
            'Mistral TTS',
        );
    }
}

jQuery(async () => {
    await init();
});

