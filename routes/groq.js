const fetch = require('node-fetch');
require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama3-8b-8192';

/**
 * Envia um prompt para o modelo LLM da Groq e retorna a resposta.
 * @param {string} prompt - Texto do usuário ou instrução.
 * @param {object} [options] - Opções adicionais (model, temperature, max_tokens, systemMessage).
 * @returns {Promise<string>} - Resposta do modelo.
 */
async function sendGroqChat(prompt, options = {}) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não definida no .env');
    const {
        model = DEFAULT_MODEL,
        temperature = 0.2,
        max_tokens = 512,
        systemMessage = 'Você é um assistente útil.'
    } = options;
    const body = {
        model,
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt }
        ],
        max_tokens,
        temperature
    };
    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`[GROQ] Erro ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return content;
}

module.exports = { sendGroqChat };
