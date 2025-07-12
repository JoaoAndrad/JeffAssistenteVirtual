// Pacotes externos
require("dotenv").config();
const moment = require("moment-timezone");
const natural = require("natural");
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');

// Utilitários e logger
const logger = require("../Utils/logger");
const db = require("./firebaseFolder/firebase");
const { removerConteudoDaMensagem, simularDigitar, extrairMesAno, capitalize } = require("./utilitariosComandos");
const { gerarRelatorioMensal } = require("./relatorio/relatorios");

// Comandos de movimentação financeira
const { tratarDetalhesAdicionais, detalhesPendentes } = require("./movimentacao/adicionarTransacao");
const { tratarRespostaDePropostaDeTransacao, tratarComandoDeEdicao } = require("./movimentacao/transacoesPendentes");
const { enviarPropostaPendente, limparPropostaPendente, receberPropostaPendente } = require("./movimentacao/utilitariosProposta");
const { tratarComandoPendentes, tratarSelecaoPendentes, estadoSelecionarPendentes } = require("./movimentacao/visualizarPendentes");

// Comandos de perfil financeiro
const { tratarCriarPerfil, estadoPendentePerfil } = require("./perfilFinanceiro/perfil");
const { tratarAtualizarSaldo, estadoPendenteSaldo } = require("./perfilFinanceiro/atualizarSaldo");

// Comando de ajuda
const { tratarComandoAjuda } = require("./ajuda");

// Comandos de rotinas
const { criarRotina, tratarDetalhesRotinas, estadoPendenteRotinas } = require("./rotinas/criarRotina");
const { tratarRespostaDeLembrete } = require("./rotinas/utilitariosRotina");
const { tratarVisualizacaoRotina } = require("./rotinas/verRotina");
const editarRotina = require("./rotinas/editarRotina");

// Importar o classificador treinado
const classifier = require("./classifier");
const { transcreverAudioAssemblyAI } = require("./movimentacao/assemblyApi/assemblyAiClient");
const fs = require("fs");
const path = require("path");
const { sendGroqChat } = require("../routes/groq");

const commands = {
    adicionarTransacao: require("./movimentacao/adicionarTransacao"),
};

// Estado global para armazenar detalhes pendentes por chatId
const AUTHORIZED_NUMBERS = ["558182132346@s.whatsapp.net"];



// Estado global para propostas de transação pendentes por chatId
async function processarComando(sock, msg, timezone, authorizedNumbers) {
    const chatId = msg.key.remoteJid;

    // Ignorar mensagens enviadas em grupos
    if (chatId.endsWith("@g.us")) {
        return;
    }

    const messageContent = removerConteudoDaMensagem(msg);

    // Detectar comando /testealarme logo no início
    if (messageContent.toLowerCase().trim() === "/testealarme") {
        const { enviarAlarmeFCM } = require("./rotinas/criarAlarme");
        const mensagem = "Alarme de teste";
        const horario = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos depois
        const resultado = await enviarAlarmeFCM(mensagem, horario);
        await simularDigitar(sock, chatId);
        if (resultado.success) {
            await sock.sendMessage(chatId, { text: `✅ Alarme de teste enviado para o app Android!\n\nHorário: ${horario}` });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Falha ao enviar alarme de teste.\n\nErro: ${resultado.error?.message || resultado.error}` });
        }
        return;
    }

    if (receberPropostaPendente(chatId)) {
        logger.info(`[LOG] Proposta de transação pendente detectada para o chat ${chatId}. Encaminhando para tratarRespostaDePropostaDeTransacao.`);
        const userPhone = chatId.replace(/@s\.whatsapp\.net$/, "");
        const proposalHandled = await tratarRespostaDePropostaDeTransacao(sock, userPhone, messageContent);
        if (proposalHandled) {
            logger.info(`[LOG] Mensagem processada como resposta à proposta de transação para ${userPhone}`);
            return;
        }
    }
        if (["cancelar", "cancele", "deixa pra lá", "deixa pra la"].includes(messageContent.toLowerCase())) {
        const estadosPendentes = [
            { state: estadoPendentePerfil, name: "perfil financeiro" },
            { state: estadoPendenteRotinas, name: "criação de rotina" },
            { state: detalhesPendentes, name: "transação" },
            { state: estadoPendenteSaldo, name: "atualização de saldo" }
        ];

        let fluxoCancelado = false;

        for (const { state, name } of estadosPendentes) {
            try {
                if (state && state[chatId]) {
                    delete state[chatId];
                    fluxoCancelado = true;
                    logger.info(`[LOG] Fluxo de ${name} cancelado para o chat ${chatId}.\n`);
                    break;
                }
            } catch (error) {
                logger.error(`[ERRO] Falha ao cancelar fluxo de ${name} para o chat ${chatId}.\nErro: ${error.message}`);
            }
        }

        if (fluxoCancelado) {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "🚫 *Fluxo cancelado com sucesso!*\n\nSe precisar de algo, é só me chamar. 😉"
            });
        }

        return;
    }
    // Detecta se é mensagem de áudio
    if (msg.message && msg.message.audioMessage) {
        logger.info(`[AUDIO] Áudio recebido de ${chatId}`);
        let tempFile = null;
        let tempMp3File = null;
        try {
            // Buscar nome do usuário no Firestore
            let nomeUsuario = '';
            try {
                const senderNumber = chatId.split("@")[0];
                const userRef = db.collection("users").doc(senderNumber);
                const userDoc = await userRef.get();
                nomeUsuario = userDoc.exists ? (userDoc.data().name || senderNumber) : senderNumber;
            } catch (e) {
                nomeUsuario = chatId;
            }
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, { text: `👋 Olá, *${nomeUsuario}*!
\n🎤 Recebi o seu áudio e já estou analisando com atenção...\nSó um momento, por gentileza 😉` });

            if (!process.env.ASSEMBLYAI_API_KEY) {
                logger.error('[AUDIO] Chave ASSEMBLYAI_API_KEY não definida no .env!');
                await sock.sendMessage(chatId, { text: '❌ Erro de configuração: chave da API AssemblyAI não encontrada.' });
                return;
            }


            // Salva o áudio em arquivo temporário


            const buffer = await downloadMediaMessage(msg, 'buffer');
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const timestamp = Date.now();
            tempFile = path.join(tempDir, `audio_${chatId.replace(/[@.]/g, '_')}_${timestamp}.ogg`);
            fs.writeFileSync(tempFile, buffer);
            logger.info(`[AUDIO] Arquivo salvo em: ${tempFile}`);

            // Converter para mp3


            tempMp3File = tempFile.replace(/\.ogg$/, '.mp3');
            logger.info(`[AUDIO] Convertendo para mp3: ${tempMp3File}`);
            await new Promise((resolve, reject) => {
                ffmpeg(tempFile)
                    .toFormat('mp3')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(tempMp3File);
            });
            logger.info(`[AUDIO] Conversão para mp3 concluída: ${tempMp3File}`);


            // Monta metadados para rastreio


            const audioInfo = {
                chatId,
                timestamp,
                fileName: path.basename(tempMp3File),
                fileSize: fs.statSync(tempMp3File).size,
                from: msg.pushName || msg.key.participant || chatId,
            };
            logger.info(`[AUDIO] Metadados do áudio: ${JSON.stringify(audioInfo)}`);

            // Envia para AssemblyAI com metadados
            const textoTranscrito = await transcreverAudioAssemblyAI(tempMp3File, audioInfo);
            logger.info(`[AUDIO] Transcrição recebida: ${textoTranscrito}`);

            
            if (textoTranscrito && textoTranscrito.trim()) {
                // NOVO: Tentar classificar via Groq
                let intencaoGroq = await obterIntencaoViaGroq(textoTranscrito);
                logger.info(`[AUDIO][GROQ] Intenção detectada: ${intencaoGroq}`);
                if (intencaoGroq === 'adicionarTransacao') {
                    const fakeMsg = { ...msg, message: { conversation: textoTranscrito } };
                    await commands.adicionarTransacao.comecarProcessoDeTransacao(sock, chatId, fakeMsg);
                    return;
                } else if (intencaoGroq === 'criarRotina' || intencaoGroq === 'lembrete') {
                    await criarRotina(sock, chatId, { ...msg, message: { conversation: textoTranscrito } });
                    return;
                } else if (intencaoGroq && intencaoGroq !== 'desconhecido') {
                    // Outras intenções: pode expandir conforme necessário
                    await sock.sendMessage(chatId, { text: `⚠️ Detected intent: ${intencaoGroq}. (Ação não implementada para áudio)` });
                    return;
                }
                // Se Groq falhar, segue fluxo antigo:
                // 1. Sempre tentar processar como transação primeiro
                let transacaoReconhecida = false;
                if (commands.adicionarTransacao && typeof commands.adicionarTransacao.comecarProcessoDeTransacao === 'function') {
                    try {
                        // Cria uma mensagem fake para manter compatibilidade
                        const fakeMsg = { ...msg, message: { conversation: textoTranscrito } };
                        await commands.adicionarTransacao.comecarProcessoDeTransacao(sock, chatId, fakeMsg);
                        // Se detalhesPendentes[chatId] foi criado, é uma transação
                        if (detalhesPendentes && detalhesPendentes[chatId]) {
                            transacaoReconhecida = true;
                        }
                    } catch (e) {
                        logger.info(`[AUDIO] Não reconhecido como transação: ${e.message}`);
                    }
                }
                // 2. Se não for transação, encaminhar para rotinas
                if (!transacaoReconhecida) {
                    if (estadoPendenteRotinas && estadoPendenteRotinas[chatId]) {
                        logger.info(`[AUDIO] Encaminhando transcrição para tratarDetalhesRotinas: ${textoTranscrito}`);
                        await tratarDetalhesRotinas(sock, chatId, textoTranscrito);
                    } else {
                        logger.info(`[AUDIO] Encaminhando transcrição para criarRotina: ${textoTranscrito}`);
                        await criarRotina(sock, chatId, { ...msg, message: { conversation: textoTranscrito } });
                    }
                }
                // Não enviar a transcrição como mensagem para o usuário
            } else {
                await sock.sendMessage(chatId, { text: '⚠️ Não foi possível entender o áudio enviado.' });
            }
        } catch (err) {
            logger.error(`[AUDIO] Erro ao processar áudio: ${err.stack || err.message}`);
            await sock.sendMessage(chatId, { text: '❌ Erro ao transcrever o áudio. Verifique os logs.' });
        } finally {
            if (tempFile && fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                    logger.info(`[AUDIO] Arquivo temporário removido: ${tempFile}`);
                } catch (e) {
                    logger.warn(`[AUDIO] Falha ao remover arquivo temporário: ${tempFile}`);
                }
            }
            if (tempMp3File && fs.existsSync(tempMp3File)) {
                try {
                    fs.unlinkSync(tempMp3File);
                    logger.info(`[AUDIO] Arquivo temporário removido: ${tempMp3File}`);
                } catch (e) {
                    logger.warn(`[AUDIO] Falha ao remover arquivo temporário: ${tempMp3File}`);
                }
            }
        }
        return;
    }

    // ...existing code...

    // Redirecionar comando /pendentes ou /pendencias
    if (["/pendentes", "/pendencias"].includes(messageContent.toLowerCase().trim())) {
        await tratarComandoPendentes(sock, chatId);
        return;
    }
    // Redirecionar comando /editarrotinas
    const { tratarComandoEditarRotinas, tratarSelecaoEditarRotinas, tratarEdicaoDeCampoRotina, estadoSelecionarRotinas } = require("./rotinas/editarRotina");
    if (messageContent.toLowerCase().trim() === "/editarrotinas") {
        await tratarComandoEditarRotinas(sock, chatId);
        return;
    }
    // Se está aguardando seleção de rotina para edição
    if (estadoSelecionarRotinas[chatId]) {
        // Se já selecionou rotina, trata edição de campo
        if (estadoSelecionarRotinas[chatId].rotinaSelecionada) {
            await tratarEdicaoDeCampoRotina(sock, chatId, messageContent);
        } else {
            await tratarSelecaoEditarRotinas(sock, chatId, messageContent);
        }
        return;
    }

    // Ignorar mensagens enviadas pelo próprio bot
    if (msg.key.fromMe) {
        return;
    }

    // Verificar se a mensagem é de um número autorizado
    if (!AUTHORIZED_NUMBERS.includes(chatId.trim())) {
        return;
    }
    logger.info(`[Mensagem Recebida de número autorizado]\n\nConteúdo: ${messageContent}\n`);

    // Verificar se há um lembrete ativo aguardando resposta
    //logger.info(`[LOG] Verificando se há lembrete ativo para chat ${chatId}...`);
    const handled = await tratarRespostaDeLembrete(sock, chatId, messageContent);
    if (handled) {
        logger.info(`[LOG] Mensagem processada como resposta de lembrete para chat ${chatId}`);
        return; // Se a mensagem foi processada como resposta de lembrete, não continuar
    }
    //logger.info(`[LOG] Nenhum lembrete ativo encontrado, continuando processamento normal...`);

    // NOVO: Verificar se há proposta de transação pendente para este chat
    if (receberPropostaPendente(chatId)) {
        logger.info(`[LOG] Proposta de transação pendente detectada para o chat ${chatId}. Encaminhando para tratarRespostaDePropostaDeTransacao.`);
        const userPhone = chatId.replace(/@s\.whatsapp\.net$/, "");
        const proposalHandled = await tratarRespostaDePropostaDeTransacao(sock, userPhone, messageContent);
        if (proposalHandled) {
            logger.info(`[LOG] Mensagem processada como resposta à proposta de transação para ${userPhone}`);
            return;
        }
    }

    // Verificar se é comando de edição de transação


    const editCommandMatch = messageContent.match(/^\/(\w+)(?:\s+(.+))?$/);
    if (editCommandMatch) {
        const [, command, value] = editCommandMatch;
        logger.info(`[LOG] Comando de edição detectado: /${command} ${value || ''}`);
        const userPhone = chatId.replace(/@s\.whatsapp\.net$/, "");
        const editHandled = await tratarComandoDeEdicao(sock, userPhone, command, value || '');
        if (editHandled) {
            logger.info(`[LOG] Comando de edição processado: /${command}`);
            return;
        }
    }

    // Detectar comando "/comandos" diretamente (antes do classificador)
    if (messageContent.toLowerCase().trim() === "/comandos") {
        logger.info(`[LOG] Comando /comandos detectado diretamente. Executando menu de ajuda...\n`);
        await tratarComandoAjuda(sock, chatId);
        return;
    }


    // Verificar se há um estado pendente para este chat
    if (estadoPendentePerfil && estadoPendentePerfil[chatId]) {
        logger.info(`[LOG] Estado pendente encontrado para o chat ${chatId} (perfil financeiro). Encaminhando para tratarCriarPerfil.\n`);
        await tratarCriarPerfil(sock, chatId, messageContent);
        return;
    }

    if (estadoPendenteRotinas && estadoPendenteRotinas[chatId]) {
        logger.info(`[LOG] Estado pendente encontrado para o chat ${chatId} (criação de rotina). Encaminhando para tratarDetalhesRotinas.\n`);
        await tratarDetalhesRotinas(sock, chatId, messageContent);
        return;
    }

    if (detalhesPendentes && detalhesPendentes[chatId]) {
        logger.info(`[LOG] Estado pendente encontrado para o chat ${chatId} (detalhes de transação). Encaminhando para tratarDetalhesAdicionais.\n`);
        await tratarDetalhesAdicionais(sock, chatId, messageContent, detalhesPendentes);
        return;
    }

    if (estadoPendenteSaldo && estadoPendenteSaldo[chatId]) {
        logger.info(`[LOG] Estado pendente encontrado para o chat ${chatId} (atualização de saldo). Encaminhando para tratarAtualizarSaldo.\n`);
        await tratarAtualizarSaldo(sock, chatId, messageContent);
        return;
    }

    // Processar comandos normais (sem estado pendente)
    try {
        // NOVO: Tentar classificar via Groq primeiro
        let intencaoGroq = await obterIntencaoViaGroq(messageContent);
        logger.info(`[GROQ] Intenção detectada: ${intencaoGroq}`);
        if (intencaoGroq && intencaoGroq !== 'desconhecido') {
            switch (intencaoGroq) {
                case "adicionarTransacao":
                    logger.info(`[GROQ] Comando identificado: adicionarTransacao. Iniciando processamento...\n`);
                    const messageText = removerConteudoDaMensagem(msg);
                    if (detalhesPendentes[chatId]) {
                        await commands.adicionarTransacao.tratarDetalhesAdicionais(sock, chatId, messageText, detalhesPendentes);
                    } else {
                        await commands.adicionarTransacao.comecarProcessoDeTransacao(sock, chatId, msg);
                    }
                    return;
                case "criarPerfil":
                    logger.info(`[GROQ] Comando identificado: criar perfil financeiro. Iniciando processamento...\n`);
                    await tratarCriarPerfil(sock, chatId, messageContent);
                    return;
                case "consultarSaldo":
                    logger.info(`[GROQ] Comando identificado: consultarSaldo. Iniciando processamento...\n`);
                    const senderNumber = chatId.split("@")[0];
                    try {
                        const userRef = db.collection("users").doc(senderNumber);
                        const userDoc = await userRef.get();
                        if (!userDoc.exists) {
                            await simularDigitar(sock, chatId);
                            await sock.sendMessage(chatId, {
                                text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
                            });
                            return;
                        }
                        const userData = userDoc.data();
                        const accounts = userData.accounts || [];
                        if (accounts.length === 0) {
                            await simularDigitar(sock, chatId);
                            await sock.sendMessage(chatId, {
                                text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
                            });
                            return;
                        }
                        const allBalances = accounts.map(account => ({
                            name: account.name,
                            balance: parseFloat(account.balance) || 0
                        }));
                        const formattedBalances = allBalances.map(account =>
                            `• ${account.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account.balance)}`
                        ).join("\n");
                        const totalBalance = allBalances.reduce((sum, account) => sum + account.balance, 0);
                        const formattedTotalBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBalance);
                        const message = `✅ *Saldos Atuais:*\n\n${formattedBalances}\n\n🧮 *Saldo Total:* ${formattedTotalBalance}`;
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, { text: message });
                        logger.info(`[GROQ] Comando saldo atual executado com sucesso para o chat ${chatId}.\n`);
                    } catch (error) {
                        logger.error(`[GROQ][ERRO] Falha ao consultar saldos para o chat ${chatId}.\nErro: ${error.message}\n`);
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: "❌ Ocorreu um erro ao consultar os saldos.\n\n🔍 Verifique os *logs* para mais detalhes."
                        });
                    }
                    return;
                case "atualizarSaldo":
                    logger.info(`[GROQ] Comando identificado: atualizarSaldo. Iniciando processamento...\n`);
                    await tratarAtualizarSaldo(sock, chatId, messageContent);
                    return;
                case "relatorioMensal":
                    logger.info(`[GROQ] Comando identificado: relatorioMensal. Iniciando processamento...\n`);
                    const senderNumberRelatorio = chatId.split("@")[0];
                    const mesAno = extrairMesAno(messageContent);
                    try {
                        const relatorio = await gerarRelatorioMensal(senderNumberRelatorio, mesAno);
                        if (relatorio.message) {
                            await simularDigitar(sock, chatId);
                            await sock.sendMessage(chatId, { text: relatorio.message });
                            return;
                        }
                        const { totalReceitas, totalDespesas, saldoFinal, categoriasDetalhadas, graficoPizzaPath, graficoColunasPath, userName } = relatorio;
                        const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
                        const textoRelatorio = `📊 *Relatório Mensal - ${moment(mesAno, "YYYY-MM").format("MMMM [de] YYYY")}*\n\n👤 *Usuário:* ${userName || "Desconhecido"}\n\n💰 *Receitas Totais:* ${formatter.format(totalReceitas)}\n💸 *Despesas Totais:* ${formatter.format(totalDespesas)}\n🧾 *Balanço Final:* ${formatter.format(saldoFinal)}\n\n📂 *Detalhes das Receitas:*\n${categoriasDetalhadas.filter(cat => cat.receita > 0).map(cat => `• ${capitalize(cat.categoria)}: ${formatter.format(cat.receita)}`).join("\n")}\n\n📂 *Detalhes das Despesas:*\n${categoriasDetalhadas.filter(cat => cat.despesa > 0).map(cat => `• ${capitalize(cat.categoria)}: ${formatter.format(cat.despesa)}`).join("\n")}`;
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, { text: textoRelatorio });
                        await sock.sendMessage(chatId, {
                            image: { url: graficoPizzaPath },
                            caption: "📊 *Gráfico de Gastos por Categoria*"
                        });
                        await sock.sendMessage(chatId, {
                            image: { url: graficoColunasPath },
                            caption: "📊 *Gráfico de Receitas vs Despesas*"
                        });
                        logger.info(`[GROQ] Relatório mensal enviado com sucesso para o chat ${chatId}.\n`);
                    } catch (error) {
                        logger.error(`[GROQ][ERRO] Falha ao gerar relatório mensal para o chat ${chatId}.\nErro: ${error.message}\n`);
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: "❌ Ocorreu um erro ao gerar o relatório mensal.\n\n🔍 Verifique os *logs* para mais detalhes."
                        });
                    }
                    return;
                case "criarRotina":
                case "lembrete":
                    logger.info(`[GROQ] Comando identificado: criarRotina/lembrete. Iniciando processamento...\n`);
                    if (estadoPendenteRotinas && estadoPendenteRotinas[chatId]) {
                        await tratarDetalhesRotinas(sock, chatId, messageContent);
                    } else {
                        await criarRotina(sock, chatId, msg);
                    }
                    return;
                case "verRotinas":
                    logger.info(`[GROQ] Comando identificado: verRotinas. Iniciando processamento...\n`);
                    await tratarVisualizacaoRotina(sock, chatId, msg);
                    return;
                case "editarRotina":
                    logger.info(`[GROQ] Comando identificado: editarRotina. Iniciando processamento...\n`);
                    await editarRotina(sock, chatId, msg);
                    return;
                case "comandos":
                    logger.info(`[GROQ] Comando identificado: comandos. Iniciando processamento...\n`);
                    await tratarComandoAjuda(sock, chatId);
                    return;
                default:
                    logger.info(`[GROQ] Intenção detectada mas ação não implementada: ${intencaoGroq}`);
                    await sock.sendMessage(chatId, { text: `⚠️ Detected intent: ${intencaoGroq}. (Ação não implementada)` });
                    return;
            }
        }
        // Se Groq falhar, segue para classificador local (NLP)
        let intent = classifier.classify(messageContent);
        const classifications = classifier.getClassifications(messageContent);

        // Verificação manual para transações (fallback)
        const transactionKeywords = ['recebi', 'gastei', 'paguei', 'comprei', 'salário', 'salario', 'entrou', 'depositaram', 'caiu na conta'];
        const hasTransactionKeyword = transactionKeywords.some(keyword =>
            messageContent.toLowerCase().includes(keyword)
        );

        // Se contém palavra-chave de transação e não foi classificado corretamente, forçar classificação
        if (hasTransactionKeyword && intent !== "adicionarTransacao") {
            logger.info(`[LOG] Palavra-chave de transação detectada. Forçando classificação para adicionarTransacao`);
            logger.info(`[LOG] Intent original: ${intent} → Novo intent: adicionarTransacao`);
            intent = "adicionarTransacao";
        }

        logger.info(`[LOG] Intenção identificada: ${intent}`);
        logger.info(`[LOG] Classificações detalhadas: ${JSON.stringify(classifications.slice(0, 3))}`); // Top 3 classificações

        // Log adicional para debug de transações
        if (hasTransactionKeyword) {
            logger.info(`[LOG] Mensagem contém palavras-chave de transação. Intent final: ${intent}`);
        }

        switch (intent) {
            case "adicionarTransacao":
                logger.info(`[LOG] Comando identificado: adicionarTransacao. Iniciando processamento...\n`);
                const messageText = removerConteudoDaMensagem(msg);
                if (detalhesPendentes[chatId]) {
                    await commands.adicionarTransacao.tratarDetalhesAdicionais(sock, chatId, messageText, detalhesPendentes);
                } else {
                    await commands.adicionarTransacao.comecarProcessoDeTransacao(sock, chatId, msg);
                }
                break;

            case "criarPerfil":
                logger.info(`[LOG] Comando identificado: criar perfil financeiro. Iniciando processamento...\n`);
                await tratarCriarPerfil(sock, chatId, messageContent);
                break;

            case "consultarSaldo":
                logger.info(`[LOG] Comando identificado: consultarSaldo. Iniciando processamento...\n`);
                const senderNumber = chatId.split("@")[0];

                try {
                    // Buscar contas do Firebase
                    const userRef = db.collection("users").doc(senderNumber);
                    const userDoc = await userRef.get();

                    if (!userDoc.exists) {
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
                        });
                        return;
                    }

                    const userData = userDoc.data();
                    const accounts = userData.accounts || [];

                    if (accounts.length === 0) {
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, {
                            text: "📭 Não encontrei nenhuma conta cadastrada para o seu perfil.\n\nParece que você ainda não possui um *perfil financeiro* configurado. Vamos criar um agora?\n\nDigite *\"Criar perfil financeiro\"* para começar!"
                        });
                        return;
                    }

                    // Formatar os saldos das contas
                    const allBalances = accounts.map(account => ({
                        name: account.name,
                        balance: parseFloat(account.balance) || 0
                    }));

                    const formattedBalances = allBalances.map(account =>
                        `• ${account.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(account.balance)}`
                    ).join("\n");

                    const totalBalance = allBalances.reduce((sum, account) => sum + account.balance, 0);
                    const formattedTotalBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBalance);

                    const message = `✅ *Saldos Atuais:*\n\n${formattedBalances}\n\n🧮 *Saldo Total:* ${formattedTotalBalance}`;

                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, { text: message });

                    logger.info(`[LOG] Comando saldo atual executado com sucesso para o chat ${chatId}.\n`);
                } catch (error) {
                    logger.error(`[ERRO] Falha ao consultar saldos para o chat ${chatId}.\nErro: ${error.message}\n`);
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "❌ Ocorreu um erro ao consultar os saldos.\n\n🔍 Verifique os *logs* para mais detalhes."
                    });
                }
                break;

            case "atualizarSaldo":
                logger.info(`[LOG] Comando identificado: atualizarSaldo. Iniciando processamento...\n`);
                await tratarAtualizarSaldo(sock, chatId, messageContent);
                break;

            case "relatorioMensal":
                logger.info(`[LOG] Comando identificado: relatorioMensal. Iniciando processamento...\n`);
                const senderNumberRelatorio = chatId.split("@")[0];
                const mesAno = extrairMesAno(messageContent); // Extrai o mês e ano da mensagem

                try {
                    const relatorio = await gerarRelatorioMensal(senderNumberRelatorio, mesAno);

                    if (relatorio.message) {
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, { text: relatorio.message });
                        return;
                    }

                    const { totalReceitas, totalDespesas, saldoFinal, categoriasDetalhadas, graficoPizzaPath, graficoColunasPath, userName } = relatorio;

                    const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

                    const textoRelatorio = `📊 *Relatório Mensal - ${moment(mesAno, "YYYY-MM").format("MMMM [de] YYYY")}*

👤 *Usuário:* ${userName || "Desconhecido"}

💰 *Receitas Totais:* ${formatter.format(totalReceitas)}
💸 *Despesas Totais:* ${formatter.format(totalDespesas)}
🧾 *Balanço Final:* ${formatter.format(saldoFinal)}

📂 *Detalhes das Receitas:*
${categoriasDetalhadas
                            .filter(cat => cat.receita > 0)
                            .map(cat => `• ${capitalize(cat.categoria)}: ${formatter.format(cat.receita)}`)
                            .join("\n")}

📂 *Detalhes das Despesas:*
${categoriasDetalhadas
                            .filter(cat => cat.despesa > 0)
                            .map(cat => `• ${capitalize(cat.categoria)}: ${formatter.format(cat.despesa)}`)
                            .join("\n")}`;

                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, { text: textoRelatorio });

                    // Enviar gráfico de pizza
                    await sock.sendMessage(chatId, {
                        image: { url: graficoPizzaPath },
                        caption: "📊 *Gráfico de Gastos por Categoria*"
                    });

                    // Enviar gráfico de colunas
                    await sock.sendMessage(chatId, {
                        image: { url: graficoColunasPath },
                        caption: "📊 *Gráfico de Receitas vs Despesas*"
                    });

                    logger.info(`[LOG] Relatório mensal enviado com sucesso para o chat ${chatId}.\n`);
                } catch (error) {
                    logger.error(`[ERRO] Falha ao gerar relatório mensal para o chat ${chatId}.\nErro: ${error.message}\n`);
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "❌ Ocorreu um erro ao gerar o relatório mensal.\n\n🔍 Verifique os *logs* para mais detalhes."
                    });
                }
                break;

            case "criarRotina":
                logger.info(`[LOG] Comando identificado: criarRotina. Iniciando processamento...\n`);
                await criarRotina(sock, chatId, msg);
                break;

            case "verRotinas":
                logger.info(`[LOG] Comando identificado: verRotinas. Iniciando processamento...\n`);
                await tratarVisualizacaoRotina(sock, chatId, msg);
                break;

            case "editarRotina":
                logger.info(`[LOG] Comando identificado: editarRotina. Iniciando processamento...\n`);
                await editarRotina(sock, chatId, msg);
                break;

            // Comando para teste de envio de alarme FCM
            case "/testealarme":
                const { enviarAlarmeFCM } = require("./rotinas/criarAlarme");
                const titulo = "Alarme de Teste";
                const mensagem = "Este é um alarme de teste enviado pelo bot.";
                const horario = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos depois
                const resultado = await enviarAlarmeFCM(titulo, mensagem, horario, { prioridade: "alta" });
                await simularDigitar(sock, chatId);
                if (resultado.success) {
                    await sock.sendMessage(chatId, { text: `✅ Alarme de teste enviado para o app Android!\n\nHorário: ${horario}` });
                } else {
                    await sock.sendMessage(chatId, { text: `❌ Falha ao enviar alarme de teste.\n\nErro: ${resultado.error?.message || resultado.error}` });
                }
                return;

            default:
                logger.info(`[LOG] Nenhum comando identificado para a mensagem: "${messageContent}".\n`);
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "🤔 Não faço ideia do que você quis dizer.\n\nDigite *\"/comandos\"* para ver o menu completo de ajuda com todas as funcionalidades!"
                });
                break;
        }
    } catch (error) {
        logger.error(`[ERRO] Falha ao executar o comando para o chat ${chatId}.\nErro: ${error}\n`);
        await sock.sendMessage(chatId, {
            text: "❌ Opa! Houve um erro ao processar sua solicitação.\n\n🛠️ Verifique os *logs* para mais detalhes."
        });
    }
}

/**
 * Consulta a intenção da mensagem usando Groq LLM, com contexto e exemplos detalhados.
 * @param {string} texto
 * @returns {Promise<string|null>} intenção ou null se falhar
 */
async function obterIntencaoViaGroq(texto) {
    try {
        const moment = require("moment-timezone");
        const saoPauloNow = moment.tz("America/Sao_Paulo");
        const dataAtual = saoPauloNow.format("YYYY-MM-DD");
        const horaAtual = saoPauloNow.format("HH:mm");
        const prompt = [
            `Horário atual em São Paulo: ${dataAtual} ${horaAtual}`,
            "Classifique a intenção da mensagem abaixo em uma das opções: adicionarTransacao, criarRotina, lembrete, consultarSaldo, atualizarSaldo, relatorioMensal, editarRotina, verRotinas, criarPerfil, comandos, desconhecido.",
            "Sempre responda apenas com a intenção (exatamente igual a uma das opções, sem explicação).",
            "Considere nuances como comandos mistos, datas relativas, recorrência, linguagem natural, e priorize a intenção mais relevante para assistentes financeiros.",
            "Exemplos:",
            'Mensagem: "Gastei 50 reais no mercado ontem"',
            'Resposta: adicionarTransacao',
            'Mensagem: "Me lembra amanhã às 09:30 de ligar para o João"',
            'Resposta: criarRotina',
            'Mensagem: "Preciso pagar a conta de luz na próxima segunda-feira"',
            'Resposta: criarRotina',
            'Mensagem: "Me lembra de pagar aluguel todo dia 5 do mês"',
            'Resposta: criarRotina',
            'Mensagem: "Recebi meu salário hoje"',
            'Resposta: adicionarTransacao',
            'Mensagem: "Quero ver meu saldo atual"',
            'Resposta: consultarSaldo',
            'Mensagem: "próxima quarta vou pro shopping',
            'Resposta: criarRotina',
            'Mensagem: "Atualizar o saldo da minha conta para 1000 reais"',
            'Resposta: atualizarSaldo',
            'Mensagem: "Quero um relatório do mês passado"',
            'Resposta: relatorioMensal',
            'Mensagem: "Quarta feira às 15:00, preciso comprar remédio"',
            'Resposta: criarRotina',
            'Mensagem: "Qual meu saldo?"',
            'Resposta: consultarSaldo',
            'Mensagem: "Quero atualizar o saldo da conta"',
            'Resposta: atualizarSaldo',
            'Mensagem: "Relatório de junho"',
            'Resposta: relatorioMensal',
            'Mensagem: "Editar rotina de tomar remédio"',
            'Resposta: editarRotina',
            'Mensagem: "Ver todas as rotinas"',
            'Resposta: verRotinas',
            'Mensagem: "Criar perfil financeiro"',
            'Resposta: criarPerfil',
            'Mensagem: "/comandos"',
            'Resposta: comandos',
            `Mensagem: "${texto}"`
        ].join("\n");
        const resposta = await sendGroqChat(prompt, {
            systemMessage: 'Você é um classificador de intenções para um assistente financeiro. Responda apenas com a intenção, você deve captar a intenção mais relevante da mensagem, diferenciando bem se um usuário quer adicionar uma transação ou criar uma rotina/lembrete/tarefa.',
        });
        if (!resposta) return null;
        const intencao = resposta.trim().split(/\s|\n/)[0];
        return intencao;
    } catch (e) {
        logger.warn(`[GROQ] Falha ao obter intenção: ${e.message}`);
        return null;
    }
}

// Exportar utilitários de proposta
module.exports = { processarComando, detalhesPendentes, enviarPropostaPendente, limparPropostaPendente, receberPropostaPendente };