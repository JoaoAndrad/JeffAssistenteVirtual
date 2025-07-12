const { obterRotinas } = require("./utilitariosRotina");
const { atualizarRotinas } = require("../firebaseFolder/rotinasFirebase");
const {simularDigitar} = require("../utilitariosComandos");


// Estado global para seleção de rotina por chatId
const estadoSelecionarRotinas = {};

// Função para exibir menu de rotinas para edição
async function tratarComandoEditarRotinas(sock, chatId) {
    const routines = await obterRotinas();
    const rotinasAtivas = routines.filter(r => r[4] === "Ativo");
    if (!rotinasAtivas.length) {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: "✅ Você não possui rotinas ativas para editar." });
        return;
    }
    let menu = "*📝 ROTINAS ATIVAS PARA EDIÇÃO*\n";
    rotinasAtivas.forEach((r, idx) => {
        menu += `\n*${idx + 1}.* 🕒 *${r[1]}*  |  *${r[3]}*\n   📅 *Dias:* ${r[2]}\n   📝 *Mensagem:* ${r[3]}\n   🆔 *ID:* \x1b[36m${r[0]}\n   ───────────────────────────────\n`;
    });
    const tutorial = [
        "ℹ️ *Como editar suas rotinas:*",
        "",
        "• Digite o *número* da rotina para editar, ou *0* para sair.",
        "• Para excluir uma rotina, digite: *excluir N* (ex: excluir 2)",
        "• Para excluir várias, digite: *excluir N1,N2* (ex: excluir 1,3,4)",
        "• Para excluir todas, digite: *excluir todos*"
    ].join('\n');
    estadoSelecionarRotinas[chatId] = { rotinas: rotinasAtivas };
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: menu });
    await sock.sendMessage(chatId, { text: tutorial });
}

// Função para tratar seleção e edição interativa
async function tratarSelecaoEditarRotinas(sock, chatId, messageContent) {
    const { rotinas } = estadoSelecionarRotinas[chatId] || {};
    if (!rotinas) return;
    const msg = messageContent.trim().toLowerCase();
    // Excluir todos
    if (msg === 'excluir todos') {
        for (const r of rotinas) {
            await atualizarRotinas(r[0], { deletar: true });
        }
        delete estadoSelecionarRotinas[chatId];
        await sock.sendMessage(chatId, { text: `✅ Todas as rotinas foram excluídas!` });
        return;
    }
    // Excluir múltiplos: excluir 1,2,4
    const multiMatch = msg.match(/^excluir\s+([\d,\s]+)$/);
    if (multiMatch) {
        const nums = multiMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const invalids = nums.filter(n => n < 1 || n > rotinas.length);
        if (nums.length === 0 || invalids.length > 0) {
            await sock.sendMessage(chatId, { text: "❌ Números inválidos para exclusão. Use: excluir N1,N2 (ex: excluir 1,3,4)" });
            return;
        }
        nums.sort((a, b) => b - a);
        for (const idx of nums) {
            const r = rotinas[idx - 1];
            await atualizarRotinas(r[0], { deletar: true });
            rotinas.splice(idx - 1, 1);
        }
        if (!rotinas.length) {
            delete estadoSelecionarRotinas[chatId];
            await sock.sendMessage(chatId, { text: "✅ Rotinas excluídas. Não há mais rotinas." });
            return;
        }
        estadoSelecionarRotinas[chatId] = { rotinas };
        await sock.sendMessage(chatId, { text: `✅ Rotinas excluídas com sucesso!` });
        await tratarComandoEditarRotinas(sock, chatId);
        return;
    }
    // Excluir único: excluir N
    const excluirMatch = msg.match(/^excluir\s+(\d+)$/);
    if (excluirMatch) {
        const idx = parseInt(excluirMatch[1], 10);
        if (isNaN(idx) || idx < 1 || idx > rotinas.length) {
            await sock.sendMessage(chatId, { text: "❌ Número inválido para exclusão. Use: excluir N (ex: excluir 2)" });
            return;
        }
        const r = rotinas[idx - 1];
        await atualizarRotinas(r[0], { deletar: true });
        rotinas.splice(idx - 1, 1);
        if (!rotinas.length) {
            delete estadoSelecionarRotinas[chatId];
            await sock.sendMessage(chatId, { text: "✅ Rotina excluída. Não há mais rotinas." });
            return;
        }
        estadoSelecionarRotinas[chatId] = { rotinas };
        await sock.sendMessage(chatId, { text: `✅ Rotina excluída com sucesso!` });
        await tratarComandoEditarRotinas(sock, chatId);
        return;
    }
    const num = parseInt(messageContent.trim(), 10);
    if (isNaN(num) || num < 0 || num > rotinas.length) {
        await sock.sendMessage(chatId, { text: "❌ Resposta inválida. Digite o número da rotina ou 0 para sair." });
        return;
    }
    if (num === 0) {
        delete estadoSelecionarRotinas[chatId];
        await sock.sendMessage(chatId, { text: "✅ Seleção de rotina cancelada." });
        return;
    }
    // Selecionou uma rotina
    const rotina = rotinas[num - 1];
    // Exibir detalhes e pedir campo para editar
    let detalhes = `📝 *DETALHES DA ROTINA*\n\n`;
    detalhes += `🕒 *Horário:* ${rotina[1]}\n`;
    detalhes += `📅 *Dias:* ${rotina[2]}\n`;
    detalhes += `📝 *Mensagem:* ${rotina[3]}\n`;
    detalhes += `🆔 *ID:* ${rotina[0]}\n`;
    detalhes += `\nQual campo deseja editar?\nDigite: \n- \`horário NOVO_VALOR\`\n- \`dias NOVO_VALOR\`\n- \`mensagem NOVO_VALOR\``;
    estadoSelecionarRotinas[chatId] = { rotinas, rotinaSelecionada: rotina };
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: detalhes });
}

// Função para tratar edição do campo escolhido
async function tratarEdicaoDeCampoRotina(sock, chatId, messageContent) {
    const { rotinas, rotinaSelecionada } = estadoSelecionarRotinas[chatId] || {};
    if (!rotinas || !rotinaSelecionada) return;
    const match = messageContent.trim().match(/^(hor[áa]rio|dias|mensagem)\s+(.+)$/i);
    if (!match) {
        await sock.sendMessage(chatId, { text: "❌ Formato inválido! Use: horário NOVO_VALOR, dias NOVO_VALOR ou mensagem NOVO_VALOR." });
        return;
    }
    const campo = match[1].toLowerCase();
    const novoValor = match[2].trim();
    let updateData = {};
    switch (campo) {
        case "horário":
        case "horario":
            updateData.time = novoValor;
            break;
        case "dias":
            updateData.days = novoValor;
            break;
        case "mensagem":
            updateData.message = novoValor;
            break;
        default:
            await sock.sendMessage(chatId, { text: "Campo inválido! Use: horário, dias ou mensagem." });
            return;
    }
    await atualizarRotinas(rotinaSelecionada[0], updateData);
    await sock.sendMessage(chatId, { text: `✅ Rotina com ID ${rotinaSelecionada[0]} atualizada com sucesso.` });
    console.log(`[LOG] Rotina com ID ${rotinaSelecionada[0]} atualizada no Firebase. Campo: ${campo}, Novo valor: ${novoValor}`);
    delete estadoSelecionarRotinas[chatId];
}

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

module.exports = {
    editarRotina,
    tratarComandoEditarRotinas,
    tratarSelecaoEditarRotinas,
    tratarEdicaoDeCampoRotina,
    estadoSelecionarRotinas
};

