import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 4096;

app.use(cors());
app.use(express.json());

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'google/gemini-2.5-flash';
/** Optional: OpenAI subscription / GPT-5.x models often need e.g. medium, high, low */
const OPENCODE_VARIANT = process.env.OPENCODE_VARIANT?.trim();

console.log({ PORT, OPENCODE_VARIANT, DEFAULT_MODEL });

function callOpenAI(prompt, model = DEFAULT_MODEL) {
  return new Promise((resolve, reject) => {
    const args = ['run', prompt, `--model=${model}`];
    if (OPENCODE_VARIANT) {
      args.push(`--variant=${OPENCODE_VARIANT}`);
    }

    const proc = spawn('opencode', args, {
      env: {
        ...process.env,
        OPENCODE_NO_BROWSER: '1',
        CI: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `Process exited with code ${code}`));
        return;
      }

      const lines = stdout.trim().split('\n');
      const response = lines
        .filter(
          (line) =>
            !line.includes('>>>') &&
            !line.includes('Positionals:') &&
            !line.includes('Options:') &&
            !line.includes('-h,') &&
            !line.includes('--help') &&
            !line.includes('message  ') &&
            line.trim()
        )
        .join('\n')
        .trim();

      resolve(response || stdout.trim());
    });

    proc.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, 120000);
  });
}

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model } = req.body;

    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    const response = await callOpenAI(prompt, model || DEFAULT_MODEL);
    console.log({ response });

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || DEFAULT_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response,
          },
          finish_reason: 'stop',
        },
      ],
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/completions', async (req, res) => {
  try {
    const { prompt, model } = req.body;

    const response = await callOpenAI(prompt, model || DEFAULT_MODEL);

    res.json({
      id: `cmpl-${Date.now()}`,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: model || DEFAULT_MODEL,
      choices: [
        {
          text: response,
          index: 0,
          finish_reason: 'stop',
        },
      ],
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'google/gemini-2.5-flash', object: 'model', owned_by: 'google' },
      { id: 'google/gemini-2.5-pro', object: 'model', owned_by: 'google' },
    ],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: 'opencode' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Nemoris LLM Service (OpenCode Proxy) running on http://localhost:${PORT}`
  );
  console.log(
    `Default model: ${DEFAULT_MODEL}${
      OPENCODE_VARIANT ? ` (variant: ${OPENCODE_VARIANT})` : ''
    }`
  );
});
