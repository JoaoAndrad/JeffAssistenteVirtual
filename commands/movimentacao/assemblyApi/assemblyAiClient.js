const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY; // Coloque sua chave no .env

async function transcreverAudioAssemblyAI(audioPath) {
  // 1. Envie o arquivo para o endpoint de upload da AssemblyAI
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  const uploadRes = await axios.post(
    'https://api.assemblyai.com/v2/upload',
    form,
    { headers: { ...form.getHeaders(), authorization: ASSEMBLYAI_API_KEY } }
  );
  const audioUrl = uploadRes.data.upload_url;

  // 2. Solicite a transcrição
  const transcriptRes = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    { audio_url: audioUrl, language_code: 'pt' },
    { headers: { authorization: ASSEMBLYAI_API_KEY } }
  );
  const transcriptId = transcriptRes.data.id;

  // 3. Aguarde a transcrição ficar pronta
  let status = 'queued', text = '';
  while (status !== 'completed' && status !== 'error') {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );
    status = pollRes.data.status;
    if (status === 'completed') text = pollRes.data.text;
    if (status === 'error') throw new Error(pollRes.data.error);
  }
  // Log da transcrição
  console.log(`[ASSEMBLYAI] Transcrição do áudio:`, text);
  return text;
}

module.exports = { transcreverAudioAssemblyAI };