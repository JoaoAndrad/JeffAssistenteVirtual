function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function removerConteudoDaMensagem(msg) {
    try {
        const message = msg.message || {};

        if (message.conversation) {
            return message.conversation.trim();
        }

        if (message.extendedTextMessage?.text) {
            return message.extendedTextMessage.text.trim();
        }

        if (message.ephemeralMessage?.message) {
            const ephemeralContent = message.ephemeralMessage.message;
            if (ephemeralContent.conversation) {
                return ephemeralContent.conversation.trim();
            }
            if (ephemeralContent.extendedTextMessage?.text) {
                return ephemeralContent.extendedTextMessage.text.trim();
            }
        }

        return '';
    } catch (error) {
        console.error('Erro ao extrair conteúdo:', error);
        return '';
    }
}

async function simularDigitar(sock, chatId, duration = 2000) {
    await sock.sendPresenceUpdate("composing", chatId);
    await delay(duration);
    await sock.sendPresenceUpdate("paused", chatId);
}

/**
 * Extrai o mês e o ano de uma mensagem.
 * @param {string} messageContent - Conteúdo da mensagem.
 * @returns {string} Mês no formato "YYYY-MM".
 */
function extrairMesAno(messageContent) {
    const mesesPTBR = {
        janeiro: "01", fevereiro: "02", março: "03", abril: "04",
        maio: "05", junho: "06", julho: "07", agosto: "08",
        setembro: "09", outubro: "10", novembro: "11", dezembro: "12"
    };

    const regex = /(\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|\b\d{1,2}\/\d{4}\b|\b\d{4}\b)/gi;
    const match = messageContent.match(regex);

    if (match) {
        let mes, ano;

        match.forEach(part => {
            const lowerPart = part.toLowerCase();
            if (mesesPTBR[lowerPart]) {
                mes = mesesPTBR[lowerPart];
            } else if (/\d{1,2}\/\d{4}/.test(part)) {
                [mes, ano] = part.split("/");
            } else if (/^\d{4}$/.test(part)) {
                ano = part;
            }
        });

        if (!ano) {
            ano = new Date().getFullYear(); // Ano atual se não especificado
        }

        if (mes) {
            return `${ano}-${mes.padStart(2, "0")}`;
        }
    }

    // Retorna o mês atual se nenhum mês/ano for detectado
    const moment = require("moment-timezone");
    return moment().format("YYYY-MM");
}

/**
 * Coloca a primeira letra da string em maiúsculo.
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { delay, removerConteudoDaMensagem, simularDigitar, extrairMesAno, capitalize };