const { createCanvas } = require('@napi-rs/canvas');
const { obterRotinas } = require('../firebaseFolder/rotinasFirebase');

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function hexToRGBA(hex, alpha = 1) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + ' ' + word).width;
        if (width < maxWidth) {
            currentLine += ' ' + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
            if (lines.length >= maxLines - 1) {
                while (ctx.measureText(currentLine + '...').width > maxWidth && currentLine.length > 0) {
                    currentLine = currentLine.slice(0, -1);
                }
                currentLine += '...';
                lines.push(currentLine);
                return lines;
            }
        }
    }
    lines.push(currentLine);
    return lines;
}

const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const mapaDias = {
    domingo: 0, segunda: 1, terça: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6,
    dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sáb: 6
};

async function gerarImagemRotinas() {
    const largura = 1000;
    const alturaBase = 720;
    const larguraLabelHoras = 60;
    const titleHeight = 40;
    const headerAltura = 40;
    const topoTotal = titleHeight + headerAltura;

    // Primeiro obtemos todas as rotinas para determinar os horários
    const rotinas = await obterRotinas();

    // Determinar hora mínima e máxima considerando todos os eventos
    let horaMinima = 8; // padrão
    let horaMaxima = 22; // padrão

    rotinas.forEach(rotina => {
        const [_, horario] = rotina;
        const [hora, minuto] = horario.split(':').map(Number);

        if (hora < horaMinima) horaMinima = Math.max(0, hora - 1); // Margem de 1 hora
        if (hora > horaMaxima) horaMaxima = Math.min(23, hora + 1); // Margem de 1 hora
    });

    // Ajustar para múltiplos de hora cheia e garantir mínimo de 8-22
    horaMinima = Math.min(Math.floor(horaMinima), 8);
    horaMaxima = Math.max(Math.ceil(horaMaxima), 22);

    const totalHoras = horaMaxima - horaMinima;
    const colunas = 7;
    const linhas = totalHoras;

    // Calcular altura dinâmica mantendo proporção
    const alturaLinhaBase = (alturaBase - topoTotal) / 14; // 14 horas padrão (8-22)
    const altura = Math.max(alturaBase, topoTotal + (alturaLinhaBase * totalHoras));

    const larguraColuna = (largura - larguraLabelHoras) / colunas;
    const alturaLinha = (altura - topoTotal) / linhas;

    const canvas = createCanvas(largura, altura);
    const ctx = canvas.getContext('2d');

    // Fundo
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, largura, altura);

    // Título
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Agenda Semanal', largura / 2, titleHeight / 2);

    // Cabeçalho com datas
    const hoje = new Date();
    const fusoRecife = new Date().toLocaleString("en-US", { timeZone: "America/Recife" });
    const hojeRecife = new Date(fusoRecife);
    const diaHoje = hojeRecife.getDay();

    const domingoBase = new Date(hojeRecife);
    domingoBase.setDate(hojeRecife.getDate() - diaHoje);

    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 7; i++) {
        const diaAtual = new Date(domingoBase);
        diaAtual.setDate(domingoBase.getDate() + i);
        const data = `${diaAtual.getDate().toString().padStart(2, '0')}/${(diaAtual.getMonth() + 1).toString().padStart(2, '0')}`;
        const x = larguraLabelHoras + i * larguraColuna;

        ctx.fillStyle = i === diaHoje ? '#2D2D2D' : '#1E1E1E';
        ctx.fillRect(x, titleHeight, larguraColuna, headerAltura);

        ctx.fillStyle = '#BB86FC';
        ctx.fillText(`${diasSemana[i]} ${data}`, x + 8, titleHeight + headerAltura / 2);
    }

    // Grade - linhas horizontais (horas)
    ctx.strokeStyle = '#333333';
    ctx.font = '12px Arial';
    ctx.fillStyle = '#BBBBBB';
    for (let i = 0; i <= linhas; i++) {
        const y = topoTotal + i * alturaLinha;
        ctx.beginPath();
        ctx.moveTo(larguraLabelHoras, y);
        ctx.lineTo(largura, y);
        ctx.stroke();
        if (i < linhas) {
            const hora = horaMinima + i;
            const label = `${hora.toString().padStart(2, '0')}:00`;
            ctx.fillText(label, 5, y + alturaLinha / 2);
        }
    }

    // Grade - linhas verticais (dias)
    for (let i = 0; i <= colunas; i++) {
        const x = larguraLabelHoras + i * larguraColuna;
        ctx.beginPath();
        ctx.moveTo(x, topoTotal);
        ctx.lineTo(x, altura);
        ctx.stroke();
    }

    // Cores para os tipos de rotina
    const cores = {
        unica: '#29B6F6',
        repetitiva: '#AB47BC'
    };

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Desenhar os eventos
    rotinas.forEach(rotina => {
        const [
            id, horario, dias, mensagem, status, repeticao, tipo,
            isTask, isDone, dataConclusao
        ] = rotina;

        const [hora, minuto] = horario.split(':').map(Number);
        const linha = hora - horaMinima + minuto / 60;
        if (linha < 0 || linha >= totalHoras) return;

        const diasIndices = dias.toLowerCase().includes('todos')
            ? [0, 1, 2, 3, 4, 5, 6]
            : dias.split(',').map(d => mapaDias[d.trim().toLowerCase()] ?? -1).filter(d => d >= 0);

        const corBase = tipo.toLowerCase() === 'unica' ? cores['unica'] : cores['repetitiva'];
        const opacidade = status.toLowerCase() === 'ativo' ? 1 : 0.3;
        const fillColor = hexToRGBA(corBase, opacidade);

        diasIndices.forEach(diaSemana => {
            const dataReferencia = new Date(domingoBase);
            dataReferencia.setDate(domingoBase.getDate() + diaSemana);
            dataReferencia.setHours(0, 0, 0, 0);

            let riscar = false;
            if (
                tipo.toLowerCase() === 'repetitiva' &&
                isTask?.toLowerCase() === 'sim' &&
                isDone?.toLowerCase() === 'sim' &&
                dataConclusao
            ) {
                const dataString = dataConclusao.split(' ')[0];
                const [year, month, day] = dataString.split('-').map(Number);
                const dataConcluida = new Date(year, month - 1, day);
                dataConcluida.setHours(0, 0, 0, 0);
                riscar = dataReferencia <= dataConcluida;
            }

            const x = larguraLabelHoras + diaSemana * larguraColuna + 3;
            const y = topoTotal + linha * alturaLinha + 2;
            const larguraBloco = larguraColuna - 6;
            const alturaBloco = alturaLinha - 4;

            ctx.fillStyle = fillColor;
            drawRoundedRect(ctx, x, y, larguraBloco, alturaBloco, 6);
            ctx.fill();

            if (isTask?.toLowerCase() === 'sim') {
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#FFFFFF';
                drawRoundedRect(ctx, x, y, larguraBloco, alturaBloco, 6);
                ctx.stroke();
            }

            let texto = `${horario} - ${mensagem}`;
            ctx.font = '11px Arial';
            const maxTextWidth = larguraBloco - 12;
            const maxLines = 2;

            const lines = wrapText(ctx, texto, maxTextWidth, maxLines);

            ctx.fillStyle = '#FFFFFF';
            lines.forEach((line, index) => {
                ctx.fillText(line, x + 6, y + 10 + (index * 15));
            });

            if (riscar) {
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x + 4, y + 4);
                ctx.lineTo(x + larguraBloco - 4, y + alturaBloco - 4);
                ctx.moveTo(x + larguraBloco - 4, y + 4);
                ctx.lineTo(x + 4, y + alturaBloco - 4);
                ctx.stroke();
            }
        });
    });

    return canvas.toBuffer('image/png');
}

async function tratarVisualizacaoRotina(sock, chatId) {
    try {
        const buffer = await gerarImagemRotinas();
        await sock.sendMessage(chatId, {
            image: buffer,
            caption: "*Visualização das Rotinas*\n\nAqui está a agenda semanal com os eventos."
        });
        console.log('[LOG] Imagem de rotinas enviada com sucesso.');
    } catch (error) {
        console.error('[ERRO] Falha ao gerar ou enviar a imagem de rotinas:', error);
        await sock.sendMessage(chatId, {
            text: "❌ *Erro:* Não foi possível gerar a imagem das rotinas. Verifique os logs."
        });
    }
}

module.exports = { tratarVisualizacaoRotina };