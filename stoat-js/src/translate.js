import config from '../config.js';

const FALLBACK_DICTIONARY = {
  es: {
    hello: 'hola',
    hi: 'hola',
    bye: 'adios',
    thanks: 'gracias',
    thank: 'gracias',
    please: 'por favor',
    yes: 'si',
    no: 'no',
    server: 'servidor',
    channel: 'canal',
    message: 'mensaje',
    event: 'evento',
    bot: 'bot',
    owner: 'dueno',
    user: 'usuario',
    users: 'usuarios',
  },
  fr: {
    hello: 'bonjour',
    hi: 'salut',
    bye: 'au revoir',
    thanks: 'merci',
    please: 's il vous plait',
    yes: 'oui',
    no: 'non',
    server: 'serveur',
    channel: 'canal',
    message: 'message',
    event: 'evenement',
    bot: 'bot',
    owner: 'proprietaire',
    user: 'utilisateur',
    users: 'utilisateurs',
  },
  de: {
    hello: 'hallo',
    hi: 'hallo',
    bye: 'tschuss',
    thanks: 'danke',
    please: 'bitte',
    yes: 'ja',
    no: 'nein',
    server: 'server',
    channel: 'kanal',
    message: 'nachricht',
    event: 'ereignis',
    bot: 'bot',
    owner: 'inhaber',
    user: 'benutzer',
    users: 'benutzer',
  },
  ar: {
    hello: 'marhaban',
    hi: 'ahlan',
    bye: 'ma as salama',
    thanks: 'shukran',
    please: 'min fadlak',
    yes: 'naam',
    no: 'la',
    server: 'khadim',
    channel: 'qana',
    message: 'risala',
    event: 'hadath',
    bot: 'robot',
    owner: 'malik',
    user: 'mustakhdim',
    users: 'mustakhdimun',
  },
};

function normalizeLanguage(language) {
  if (!language) return 'en';
  return String(language).trim().toLowerCase().split('-')[0];
}

function detectSourceLanguage(text) {
  const value = String(text || '');
  if (/[ء-ي]/.test(value)) return 'ar';
  if (/[a-z]/i.test(value)) return 'en';
  return 'auto';
}

function preserveCase(original, translated) {
  if (!translated) return translated;
  if (original.toUpperCase() === original) return translated.toUpperCase();
  if (original[0] && original[0].toUpperCase() === original[0]) {
    return translated[0].toUpperCase() + translated.slice(1);
  }
  return translated;
}

function fallbackTranslate(text, targetLanguage) {
  const target = normalizeLanguage(targetLanguage);
  const dict = FALLBACK_DICTIONARY[target];
  if (!dict) return text;
  return String(text || '').replace(/[A-Za-z']+/g, (word) => {
    const mapped = dict[word.toLowerCase()];
    if (!mapped) return word;
    return preserveCase(word, mapped);
  });
}

async function providerTranslate(text, targetLanguage, sourceLanguage) {
  if (!config.translateProviderUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const payload = {
      q: text,
      source: sourceLanguage || 'auto',
      target: targetLanguage,
      format: 'text',
    };
    if (config.translateProviderApiKey) payload.api_key = config.translateProviderApiKey;
    const res = await fetch(config.translateProviderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const translated = data?.translatedText || data?.translated_text || data?.text;
    if (typeof translated !== 'string' || translated.length === 0) return null;
    return translated;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateMessageContent({ text, targetLanguage, sourceLanguage = 'auto' }) {
  const rawText = String(text || '');
  const target = normalizeLanguage(targetLanguage);
  const source = sourceLanguage === 'auto' ? detectSourceLanguage(rawText) : normalizeLanguage(sourceLanguage);

  if (!rawText.trim().length) {
    return {
      translated_text: '',
      source_language: source === 'auto' ? 'unknown' : source,
      target_language: target,
      provider: 'none',
    };
  }

  if (source === target) {
    return {
      translated_text: rawText,
      source_language: source,
      target_language: target,
      provider: 'identity',
    };
  }

  const remote = await providerTranslate(rawText, target, source);
  if (remote) {
    return {
      translated_text: remote,
      source_language: source === 'auto' ? 'unknown' : source,
      target_language: target,
      provider: 'remote',
    };
  }

  return {
    translated_text: fallbackTranslate(rawText, target),
    source_language: source === 'auto' ? 'unknown' : source,
    target_language: target,
    provider: 'fallback',
  };
}

