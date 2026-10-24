import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return done(new Error('Please send a JPEG, PNG, or WebP image.'));
    }
    done(null, true);
  },
});

const port = Number(process.env.PORT || 3000);
const dirname = path.dirname(fileURLToPath(import.meta.url));

const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const rawOpenAIKey = (process.env.OPENAI_API_KEY || '').trim();
const isOpenAI = rawOpenAIKey.startsWith('sk-');
const openai = isOpenAI ? new OpenAI({ apiKey: rawOpenAIKey, timeout: 30000, maxRetries: 1 }) : null;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(geminiKey || openai),
    providers: {
      gemini: Boolean(geminiKey),
      openai: Boolean(openai),
    },
    activeProvider: geminiKey ? (openai ? 'gemini+openai' : 'gemini') : (openai ? 'openai' : 'none'),
  });
});

/* ---- Hindi Detection (Devanagari or Roman Hinglish) ---- */
function isHindiText(text) {
  if (!text) return false;
  if (/[\u0900-\u097F]/.test(text)) return true;
  return /\b(ki|kya|hai|hain|samne|saamne|aage|dikhao|dikh|batao|bataiye|dekh|dekho|yeh|ye|woh|wo|kahan|kidhar|mera|meri|mere|kaun|kitna|kitne|kaise|padh|padho|madad|namaste|shukriya|dhanyawad|ruko|bas|chup|phir|dobara|bata|likha|note|rupaye|paisa|paise|dawa|dawai|darwaza|kursi|table)\b/i.test(text);
}

/* ---- Indian Banknote Currency Parser & Validator (₹10, ₹50, ₹100, ₹500) ---- */
export function parseCurrencyResult(rawText, isHindi = false) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      recognized: false,
      denomination: null,
      text: isHindi
        ? 'नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।'
        : 'Unable to identify the note confidently. Please reposition the note and try again.',
    };
  }

  const lower = rawText.toLowerCase();

  // If model explicitly indicates unable/unclear/unrecognized
  if (
    lower.includes('unable to identify') ||
    lower.includes('reposition') ||
    lower.includes('not clearly') ||
    lower.includes('cannot determine') ||
    lower.includes('no note') ||
    lower.includes('not visible') ||
    lower.includes('not recognized') ||
    lower.includes('uncertain') ||
    rawText.includes('स्पष्ट पहचान नहीं') ||
    rawText.includes('दोबारा प्रयास')
  ) {
    return {
      recognized: false,
      denomination: null,
      text: isHindi
        ? 'नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।'
        : 'Unable to identify the note confidently. Please reposition the note and try again.',
    };
  }

  // 1. ₹500 (Stone grey / Red Fort)
  if (/(500\b|five\s*hundred|पाँच\s*सौ|पांच\s*सौ)/iu.test(rawText)) {
    return {
      recognized: true,
      denomination: 500,
      text: isHindi
        ? 'पहचाना गया नोट पाँच सौ रुपये का प्रतीत होता है।'
        : 'The detected note appears to be five hundred rupees.',
    };
  }

  // 2. ₹100 (Lavender / Rani ki Vav)
  if (/(100\b|one\s*hundred|hundred\b|एक\s*सौ|सौ\s*रुपये)/iu.test(rawText)) {
    return {
      recognized: true,
      denomination: 100,
      text: isHindi
        ? 'पहचाना गया नोट एक सौ रुपये का प्रतीत होता है।'
        : 'The detected note appears to be one hundred rupees.',
    };
  }

  // 3. ₹50 (Fluorescent blue / Hampi Chariot)
  if (/(50\b|fifty\b|पचास)/iu.test(rawText)) {
    return {
      recognized: true,
      denomination: 50,
      text: isHindi
        ? 'पहचाना गया नोट पचास रुपये का प्रतीत होता है।'
        : 'The detected note appears to be fifty rupees.',
    };
  }

  // 4. ₹10 (Chocolate brown / Konark Sun Temple)
  if (/(10\b|ten\b|दस\s*रुपये|दस\b)/iu.test(rawText)) {
    return {
      recognized: true,
      denomination: 10,
      text: isHindi
        ? 'पहचाना गया नोट दस रुपये का प्रतीत होता है।'
        : 'The detected note appears to be ten rupees.',
    };
  }

  // Unsupported denomination or ambiguous image
  return {
    recognized: false,
    denomination: null,
    text: isHindi
      ? 'नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।'
      : 'Unable to identify the note confidently. Please reposition the note and try again.',
  };
}

/* ---- System Prompt with High-Speed Concise Multilingual Rules ---- */
function buildPrompt(question, mode, userLang) {
  const isHindi = userLang?.startsWith('hi') || isHindiText(question);
  const isCurrencyMode = mode === 'currency' || /\b(note|currency|money|paisa|paise|rupaye|banknote|denomination|fake|real|genuine)\b/i.test(question || '');

  let taskInstruction = '';
  if (isCurrencyMode) {
    if (isHindi) {
      taskInstruction =
        'आप एक दृष्टिबाधित व्यक्ति के लिए भारतीय मुद्रा (Indian Currency) पहचान सहायक हैं।\n' +
        'छवि में दिख रहे भारतीय नोट की जांच करें। समर्थित मूल्यवर्ग: ₹10, ₹50, ₹100, ₹500।\n' +
        '- ₹10: चॉकलेट भूरा, कोणार्क सूर्य मंदिर\n' +
        '- ₹50: फ़िरोज़ा नीला, हम्पी रथ\n' +
        '- ₹100: लैवेंडर, रानी की वाव\n' +
        '- ₹500: स्टोन ग्रे, लाल किला\n' +
        'यदि ₹10, ₹50, ₹100, या ₹500 का नोट स्पष्ट दिखाई दे रहा है, तो कहें: "पहचाना गया नोट [दस / पचास / एक सौ / पाँच सौ] रुपये का प्रतीत होता है।"\n' +
        'यदि नोट अस्पष्ट, धुंधला, आंशिक रूप से कटा हुआ, या पहचाना नहीं जा सका, तो सटीक रूप से यह कहें: "नोट की स्पष्ट पहचान नहीं हो सकी। कृपया नोट को सीधा करके दोबारा प्रयास करें।"\n' +
        'कभी भी गलत या मनगढ़ंत मूल्यवर्ग न बताएं।';
    } else {
      taskInstruction =
        'You are an Indian currency recognition assistant for a blind or visually impaired user.\n' +
        'Inspect the image for an Indian Rupee banknote. Supported denominations: ₹10, ₹50, ₹100, ₹500.\n' +
        '- ₹10: Chocolate brown, Konark Sun Temple motif\n' +
        '- ₹50: Fluorescent blue, Hampi chariot motif\n' +
        '- ₹100: Lavender, Rani ki Vav motif\n' +
        '- ₹500: Stone grey, Red Fort motif\n' +
        'If a ₹10, ₹50, ₹100, or ₹500 note is clearly visible, reply: "The detected note appears to be [ten / fifty / one hundred / five hundred] rupees."\n' +
        'If the note is blurry, unclear, partially visible, uncertain, or not a recognized Indian banknote, you MUST reply: "Unable to identify the note confidently. Please reposition the note and try again."\n' +
        'Never invent or guess a denomination.';
    }
  } else if (mode === 'read') {
    if (isHindi) {
      taskInstruction =
        'कार्य: आप दृष्टिबाधित उपयोगकर्ता की आँखें हैं। सामने दिख रहे किसी भी लेख, दवा के नाम, एक्सपायरी डेट, बोर्ड या नोट को पढ़कर सुनाएं। उत्तर 2 से 3 सरल वाक्यों में दें।';
    } else {
      taskInstruction =
        'TASK: You are the eyes for a blind or low-vision user. Read aloud all clearly visible text, brand names, medicine labels, expiry dates, signs, or currency notes/coins verbatim. Keep it direct and under 3 simple sentences.';
    }
  } else if (question) {
    if (isHindi) {
      taskInstruction =
        `कार्य: दृष्टिबाधित उपयोगकर्ता के इस सवाल का सटीक उत्तर दें: "${question}"। जो सामने साफ दिख रहा है केवल वही बताएं। दिशा (सीधे आगे, बाएं, दाएं) बताएं। उत्तर 2 सरल वाक्यों में दें।`;
    } else {
      taskInstruction =
        `TASK: Answer the blind user's specific question: "${question}". Use only what is clearly visible. State spatial positions (e.g. directly in front, to your left, to your right, on the table/floor). If currency or medicine is asked, state exact details. Keep answer direct and under 3 simple sentences.`;
    }
  } else {
    if (isHindi) {
      taskInstruction =
        'कार्य: दृष्टिबाधित व्यक्ति के लिए, सीधे सामने क्या है उसका स्पष्ट और सजीव वर्णन करें। तुरंत आने वाली रुकावटों (कुर्सी, दरवाजा, सीढ़ी, व्यक्ति) को प्राथमिकता दें। उत्तर 2 से 3 सरल वाक्यों में दें।';
    } else {
      taskInstruction =
        'You are an assistant for a visually impaired user. Examine the image. If a currency note/banknote is present, state its denomination, currency, and whether it appears genuine or suspicious. Then describe any immediate obstacles or safety hazards. Keep your answer brief, direct, and under 3 simple sentences.';
    }
  }

  let languageDirective = '';
  if (isHindi) {
    languageDirective =
      'MANDATORY LANGUAGE RULE (HINDI):\n' +
      'The user communicates in Hindi.\n' +
      'Reply ENTIRELY in natural, fluent Hindi using Devanagari script (हिन्दी).\n' +
      'Keep it strictly under 3 simple sentences. Do not use complex jargon.';
  } else {
    languageDirective =
      'CRITICAL MULTILINGUAL INSTRUCTION:\n' +
      'If the question is in any language other than English, respond in that exact same language.\n' +
      'Strictly under 3 simple sentences. Direct and practical for a blind user.';
  }

  return `${taskInstruction}\n\n${languageDirective}`;
}

/* ---- High-Speed Gemini Caller with Fast-First Fallbacks ---- */
async function callGeminiVision(base64Data, mimeType, prompt, customKey) {
  const activeKey = (customKey || geminiKey || '').trim();
  if (!activeKey) {
    throw new Error('Gemini API key is missing. Please configure it in .env or provide your key in the app.');
  }

  // Active high-speed vision models (fastest 1.5s model first)
  const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Data } },
            ],
          }],
          generationConfig: { maxOutputTokens: 90, temperature: 0.1 },
        }),
      });

      clearTimeout(timeoutId);
      const data = await response.json();
      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text.trim();
      }

      const errMsg = data.error?.message || `Model ${model} returned status ${response.status}`;
      lastError = new Error(errMsg);
      console.warn(`Model ${model} issue:`, errMsg);
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} error or timeout:`, err.message);
    }
  }

  throw lastError || new Error('AI vision service unavailable.');
}

/* ---- Unified Vision & Analysis Handler ---- */
async function handleVisionRequest(req, res, next) {
  try {
    const customKey = req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || req.body?.apiKey;
    let base64Data = '';
    let mimeType = 'image/jpeg';

    if (req.file) {
      base64Data = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype || 'image/jpeg';
    } else if (req.body?.image) {
      const raw = req.body.image;
      if (raw.startsWith('data:')) {
        const match = raw.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
        } else {
          base64Data = raw.split(',')[1] || raw;
        }
      } else {
        base64Data = raw;
      }
    } else if (req.body?.base64) {
      base64Data = req.body.base64;
    }

    if (!base64Data) {
      return res.status(400).json({ error: 'No image was provided. Please capture or send a frame.' });
    }

    const question = typeof req.body.question === 'string' ? req.body.question.trim().slice(0, 500) : '';
    const mode = req.body.mode || (req.path.includes('currency') ? 'currency' : 'describe');
    const userLang = req.body.language || 'en';
    const prompt = buildPrompt(question, mode, userLang);

    // AI Vision Pipeline: Dual-Engine with Automatic Failover (Gemini + OpenAI)
    let answer = null;
    let primaryErr = null;

    const isCustomOpenAI = typeof customKey === 'string' && customKey.trim().startsWith('sk-');
    const activeOpenAI = isCustomOpenAI
      ? new OpenAI({ apiKey: customKey.trim(), timeout: 25000, maxRetries: 1 })
      : openai;

    // 1. Google Gemini (fast-first cloud engine if not explicitly an OpenAI key)
    if (!isCustomOpenAI && (customKey || geminiKey)) {
      try {
        answer = await callGeminiVision(base64Data, mimeType, prompt, customKey);
      } catch (geminiErr) {
        primaryErr = geminiErr;
        console.warn('[AURA AI] Gemini vision notice:', geminiErr.message, '— falling back to OpenAI.');
      }
    }

    // 2. OpenAI Cloud Engine (seamless fallback or primary if OpenAI key specified)
    if (!answer && activeOpenAI) {
      try {
        const imageUri = `data:${mimeType};base64,${base64Data}`;
        const result = await activeOpenAI.chat.completions.create({
          model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
          max_tokens: 160,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUri, detail: 'low' } },
            ],
          }],
        });

        answer = result.choices?.[0]?.message?.content?.trim();
      } catch (openAiErr) {
        console.error('[AURA AI] OpenAI vision error:', openAiErr.message);
        if (!primaryErr) primaryErr = openAiErr;
      }
    }

    if (answer) {
      if (mode === 'currency') {
        const isHindi = userLang?.startsWith('hi') || isHindiText(question);
        const parsed = parseCurrencyResult(answer, isHindi);
        return res.json({
          answer: parsed.text,
          currency: parsed,
          success: true,
        });
      }
      return res.json({ answer, success: true });
    }

    throw primaryErr || new Error('No description returned. Please check API keys.');
  } catch (error) {
    next(error);
  }
}

import https from 'node:https';

/* ---- Keep-Alive HTTP Connection Pooling & LRU Memory Cache for Instant TTS (<1ms cached) ---- */
const ttsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 24,
  maxFreeSockets: 12,
  timeout: 10000,
});

const ttsCache = new Map();
const MAX_TTS_CACHE = 200;

app.get('/api/tts', (req, res) => {
  const text = (req.query.text || '').trim();
  const rawLang = (req.query.lang || 'en').toLowerCase();
  const lang = rawLang.startsWith('hi') ? 'hi' : 'en';

  if (!text) {
    return res.status(400).send('Text parameter required.');
  }

  const querySlice = text.slice(0, 280);
  const cacheKey = `${lang}:${querySlice}`;

  // 1. Instant L1 RAM Cache Hit (0ms turnaround)
  if (ttsCache.has(cacheKey)) {
    const cachedBuffer = ttsCache.get(cacheKey);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Cache', 'HIT');
    return res.end(cachedBuffer);
  }

  const targetUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(querySlice)}`;

  https.get(targetUrl, { agent: ttsAgent, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (ttsRes) => {
    if (ttsRes.statusCode === 200) {
      const chunks = [];
      ttsRes.on('data', (chunk) => chunks.push(chunk));
      ttsRes.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        // Evict oldest if cache limit reached
        if (ttsCache.size >= MAX_TTS_CACHE) {
          const firstKey = ttsCache.keys().next().value;
          ttsCache.delete(firstKey);
        }
        ttsCache.set(cacheKey, fullBuffer);

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Cache', 'MISS');
        res.end(fullBuffer);
      });
    } else {
      res.status(ttsRes.statusCode || 500).json({ error: 'TTS upstream failed' });
    }
  }).on('error', (err) => {
    console.error('TTS proxy error:', err.message);
    res.status(500).json({ error: err.message });
  });
});

/* ---- Mount both /api/analyze and /api/vision ---- */
app.post('/api/analyze', upload.single('image'), handleVisionRequest);
app.post('/api/vision', upload.single('image'), handleVisionRequest);

/* ---- Error Handler ---- */
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(413).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Image too large.' : 'Single image only.',
    });
  }

  const status = error.status || error.statusCode;
  if (status === 401) {
    return res.status(503).json({ error: 'AI key rejected. Check GEMINI_API_KEY in .env.' });
  }
  if (status === 429) {
    return res.status(503).json({ error: 'Service busy. Please wait a moment.' });
  }

  console.error('Vision request failed:', error.message);
  res.status(500).json({ error: error.message || 'Could not analyze image.' });
});

import fs from 'node:fs';

const distPath = path.join(dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
    next();
  });
}

app.listen(port, () => {
  const activeProviders = [geminiKey && 'Google Gemini', openai && 'OpenAI (gpt-4o-mini)'].filter(Boolean);
  console.log(`AURA AI backend listening on http://localhost:${port}`);
  console.log(`AI active providers: ${activeProviders.join(' + ') || 'None'}`);
});
