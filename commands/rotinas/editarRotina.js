const { obterRotinas } = require("./utilitariosRotina");
const { atualizarRotinas } = require("../firebaseFolder/rotinasFirebase");

async function editarRotina(sock, chatId, msg) {
    try {
        const messageContent = msg.text.trim();
        const [id, field, ...newValueParts] = messageContent.split(" ");
        const routineId = parseInt(id, 10);
        const newValue = newValueParts.join(" ");

        if (isNaN(routineId) || !field || !newValue) {
            await sock.sendMessage(chatId, {
                text: "Formato inválido! Use: <ID> <campo> <novo valor>. Campos válidos: horário, dias, mensagem.",
            });
            return;
        }

        const routines = await obterRotinas();
        const routineIndex = routines.findIndex((routine) => parseInt(routine[0], 10) === routineId);

        if (routineIndex === -1) {
            await sock.sendMessage(chatId, { text: `Nenhuma rotina encontrada com o ID ${routineId}.` });
            return;
        }

        // Preparar os dados de atualização baseado no campo especificado
        let updateData = {};
        switch (field.toLowerCase()) {
            case "horário":
            case "horario":
                updateData.time = newValue;
                break;
            case "dias":
                updateData.days = newValue;
                break;
            case "mensagem":
                updateData.message = newValue;
                break;
            default:
                await sock.sendMessage(chatId, { text: "Campo inválido! Use: horário, dias ou mensagem." });
                return;
        }

        // Atualizar no Firebase
        await atualizarRotinas(routineId.toString(), updateData);

        await sock.sendMessage(chatId, { text: `✅ Rotina com ID ${routineId} atualizada com sucesso.` });
        console.log(`[LOG] Rotina com ID ${routineId} atualizada no Firebase. Campo: ${field}, Novo valor: ${newValue}`);
    } catch (error) {
        console.error(`[LOG] Erro ao editar rotina:`, error);
        await sock.sendMessage(chatId, { text: "Ocorreu um erro ao editar a rotina no Firebase. Verifique os logs." });
    }
}

module.exports = editarRotina;