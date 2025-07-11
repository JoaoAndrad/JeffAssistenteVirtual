const { simularDigitar } = require("./utilitariosComandos");

async function onCommand(sock, chatId) {
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: "Opa chefe, fala ai!" });
}

module.exports = onCommand;