const db = require("../firebaseFolder/firebase");
const { simularDigitar } = require("../utilitariosComandos");
const { enviarPropostaPendente } = require("./utilitariosProposta");

// Estado global para seleção de pendência por chatId
const estadoSelecionarPendentes = {};

async function tratarComandoPendentes(sock, chatId) {
    const userPhone = chatId.replace(/@s\.whatsapp\.net$/, "");
    // Buscar todas as pendências do usuário
    const snapshot = await db.collection("pending_transactions")
        .where("userId", "==", userPhone)
        .where("status", "in", ["pending_confirmation", "editing"])
        .orderBy("createdAt", "asc")
        .get();
    if (snapshot.empty) {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, { text: "✅ Você não possui transações pendentes para confirmar ou editar." });
        return;
    }
    // Montar menu numerado estilizado
    let menu = "*📋 TRANSAÇÕES PENDENTES*\n";
    const pendencias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    pendencias.forEach((p, idx) => {
        const tipoEmoji = p.transactionData.type === 'receita' ? '🟢' : '🔴';
        const valor = Number(p.transactionData.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const data = p.transactionData.date || '-';
        const conta = p.transactionData.account || '-';
        const categoria = p.transactionData.category || '-';
        const descricao = (p.transactionData.description || '').slice(0, 40);
        menu += `\n*${idx + 1}.* ${tipoEmoji} *${valor}*  |  *${p.transactionData.type?.toUpperCase() || '-'}*  |  ${data}\n`;
        menu += `   🏦 *Conta:* ${conta}\n`;
        menu += `   🏷️ *Categoria:* ${categoria}\n`;
        menu += `   📝 *Descrição:* ${descricao}\n`;
        menu += `   🆔 *ID:* [36m${p.id}\n`;
        menu += `───────────────────────────────\n`;
    });

    // Tutorial separado
    const tutorial = [
        "ℹ️ *Como gerenciar suas pendências:*",
        "",
        "• Digite o *número* da transação para selecionar, ou *0* para sair.",
        "• Para excluir uma pendência, digite: *excluir N* (ex: excluir 2)",
        "• Para excluir várias, digite: *excluir N1,N2* (ex: excluir 1,3,4)",
        "• Para excluir todas, digite: *excluir todos*"
    ].join('\n');

    // Salvar estado de seleção
    estadoSelecionarPendentes[chatId] = { pendencias };
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: menu });
    await sock.sendMessage(chatId, { text: tutorial });
    console.log(`Pendências enviadas para ${chatId}`);
}

// Função para formatar detalhes da transação pendente (estilo notificationIntegration)
function formatPendingTransactionDetails(pendencia) {
    const { transactionData, originalData } = pendencia;
    const emoji = transactionData.type === 'receita' ? '🟢' : '🔴';
    const operacao = transactionData.type === 'receita' ? 'Receita' : 'Despesa';
    const valor = Number(transactionData.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    let message = `🤖 *DETALHES DA TRANSAÇÃO PENDENTE*\n\n`;
    message += `${emoji} *${operacao}*\n`;
    message += `💵 *Valor:* ${valor}\n`;
    message += `💼 *Conta:* ${transactionData.account || '-'}\n`;
    message += `🏷️ *Categoria:* ${transactionData.category || '(preencher)'}\n`;
    message += `📅 *Data:* ${transactionData.date || '-'}\n`;
    if (transactionData.type === 'receita' && originalData?.from) {
        message += `👤 *De:* ${originalData.from}\n`;
    } else if (transactionData.type === 'despesa' && originalData?.to) {
        message += `👤 *Para:* ${originalData.to}\n`;
    }
    if (originalData?.bank) {
        message += `🏦 *Banco:* ${originalData.bank}\n`;
    }
    if (transactionData.description) {
        message += `📝 *Descrição:* ${transactionData.description}\n`;
    }
    message += `\n❓ *Deseja confirmar, editar ou cancelar esta transação?*\n`;
    message += `✅ Digite \`SIM\` para confirmar\n`;
    message += `✏️ Digite \`EDITAR\` para modificar\n`;
    message += `➡️ Digite \`DEPOIS\` para decidir depois\n`;
    message += `❌ Digite \`NÃO\` para cancelar\n`;
    message += `\n📱 ID: \`${transactionData.id}\``;
    return message;
}

async function tratarSelecaoPendentes(sock, chatId, messageContent) {
    const { pendencias } = estadoSelecionarPendentes[chatId];
    const msg = messageContent.trim().toLowerCase();
    // Excluir todos
    if (msg === 'excluir todos') {
        const ids = pendencias.map(p => p.id);
        for (const id of ids) {
            await db.collection("pending_transactions").doc(id).delete();
        }
        delete estadoSelecionarPendentes[chatId];
        await sock.sendMessage(chatId, { text: `✅ Todas as pendências foram excluídas!` });
        return;
    }
    // Excluir múltiplos: excluir 1,2,4
    const multiMatch = msg.match(/^excluir\s+([\d,\s]+)$/);
    if (multiMatch) {
        const nums = multiMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const invalids = nums.filter(n => n < 1 || n > pendencias.length);
        if (nums.length === 0 || invalids.length > 0) {
            await sock.sendMessage(chatId, { text: "❌ Números inválidos para exclusão. Use: excluir N1,N2 (ex: excluir 1,3,4)" });
            return;
        }
        // Excluir do Firestore e array local (ordem decrescente para não bagunçar os índices)
        nums.sort((a, b) => b - a);
        for (const idx of nums) {
            const pendencia = pendencias[idx - 1];
            await db.collection("pending_transactions").doc(pendencia.id).delete();
            pendencias.splice(idx - 1, 1);
        }
        if (pendencias.length === 0) {
            delete estadoSelecionarPendentes[chatId];
            await sock.sendMessage(chatId, { text: "✅ Pendências excluídas. Não há mais pendências." });
            return;
        }
        estadoSelecionarPendentes[chatId] = { pendencias };
        await sock.sendMessage(chatId, { text: `✅ Pendências excluídas com sucesso!` });
        await tratarComandoPendentes(sock, chatId);
        return;
    }
    // Excluir único: excluir N
    const excluirMatch = msg.match(/^excluir\s+(\d+)$/);
    if (excluirMatch) {
        const idx = parseInt(excluirMatch[1], 10);
        if (isNaN(idx) || idx < 1 || idx > pendencias.length) {
            await sock.sendMessage(chatId, { text: "❌ Número inválido para exclusão. Use: excluir N (ex: excluir 2)" });
            return;
        }
        const pendencia = pendencias[idx - 1];
        await db.collection("pending_transactions").doc(pendencia.id).delete();
        pendencias.splice(idx - 1, 1);
        if (pendencias.length === 0) {
            delete estadoSelecionarPendentes[chatId];
            await sock.sendMessage(chatId, { text: "✅ Pendência excluída. Não há mais pendências." });
            return;
        }
        estadoSelecionarPendentes[chatId] = { pendencias };
        await sock.sendMessage(chatId, { text: `✅ Pendência excluída com sucesso!` });
        await tratarComandoPendentes(sock, chatId);
        return;
    }
    const num = parseInt(messageContent.trim(), 10);
    if (isNaN(num) || num < 0 || num > pendencias.length) {
        await sock.sendMessage(chatId, { text: "❌ Resposta inválida. Digite o número da transação ou 0 para sair." });
        return;
    }
    if (num === 0) {
        delete estadoSelecionarPendentes[chatId];
        await sock.sendMessage(chatId, { text: "✅ Seleção de pendência cancelada." });
        return;
    }
    // Selecionou uma pendência
    const pendencia = pendencias[num - 1];
    console.log(`[PENDENTES] ID da pendência selecionada: ${pendencia.id}`); // Log do ID selecionado
    enviarPropostaPendente(chatId, pendencia);
    delete estadoSelecionarPendentes[chatId];
    // Envia detalhes da transação antes de pedir confirmação
    const detalhes = formatPendingTransactionDetails(pendencia);
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, { text: detalhes });
    // O próximo input cairá no fluxo de tratarRespostaDePropostaDeTransacao normalmente
}

module.exports = {
    tratarComandoPendentes,
    tratarSelecaoPendentes,
    estadoSelecionarPendentes
};
