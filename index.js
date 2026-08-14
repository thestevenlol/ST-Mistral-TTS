import { MistralTtsProvider } from './mistral-provider.js';
import { registerTtsProvider } from '/scripts/extensions/tts/index.js';

const PROVIDER_NAME = 'Mistral';
let initialized = false;

/**
 * Registers the provider before SillyTavern initializes the saved TTS provider.
 */
function registerProvider() {
    if (initialized) {
        return;
    }

    try {
        registerTtsProvider(PROVIDER_NAME, MistralTtsProvider);
        initialized = true;
        console.info('[Mistral TTS] Provider registered.');
    } catch (error) {
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

// Extension modules are evaluated before their init hooks are activated. Registering
// here prevents the built-in TTS init hook from restoring a provider that is not yet
// present in its registry.
registerProvider();

export async function init() {
    registerProvider();
}

