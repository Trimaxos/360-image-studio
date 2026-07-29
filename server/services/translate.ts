import { config } from '../config';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

function detectLanguage(text: string): 'vi' | 'en' {
  // Simple detection: if contains Vietnamese-specific chars, treat as VN
  const vnPattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  return vnPattern.test(text) ? 'vi' : 'en';
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

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.deepseekKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
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
    throw new Error(`DeepSeek translate failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const translated = data.choices[0].message.content.trim();
  return { original: text, translated, detectedLanguage };
}
