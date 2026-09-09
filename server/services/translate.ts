import { config } from '../config';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const OPENCODE_MODEL = 'deepseek-v4-flash';

function detectLanguage(text: string): 'vi' | 'en' {
  // Simple detection: if contains Vietnamese-specific chars, treat as VN
  const vnPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  return vnPattern.test(text) ? 'vi' : 'en';
}

async function complete(url: string, model: string, apiKey: string, text: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a translator. Translate Vietnamese to English. Return ONLY the English translation, no explanations, no quotes.',
        },
        { role: 'user', content: text },
      ],
      max_tokens: 256,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Translate failed (${model}): ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return data.choices[0].message.content.trim();
}

export async function translatePrompt(text: string): Promise<{
  original: string;
  translated: string;
  detectedLanguage: 'vi' | 'en';
}> {
  const detectedLanguage = detectLanguage(text);

  if (detectedLanguage === 'en') {
    return { original: text, translated: text, detectedLanguage: 'en' };
  }

  let translated: string;
  if (config.deepseekKey) {
    try {
      translated = await complete(DEEPSEEK_URL, 'deepseek-chat', config.deepseekKey, text);
    } catch (err) {
      if (!config.opencodeKey) throw err;
      translated = await complete(OPENCODE_URL, OPENCODE_MODEL, config.opencodeKey, text);
    }
  } else if (config.opencodeKey) {
    translated = await complete(OPENCODE_URL, OPENCODE_MODEL, config.opencodeKey, text);
  } else {
    throw new Error('No translation API key configured (DEEPSEEK_API_KEY or OPENCODE_API_KEY)');
  }

  return { original: text, translated, detectedLanguage };
}
