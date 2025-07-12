const { criarRotina: criarRotinaFirebase, obterRotinas, getNextRoutineId } = require("../firebaseFolder/rotinasFirebase");
const { validarFormatoHora, initializeSingleReminder, pegarDataHoje, calculateFirstReminder } = require("./utilitariosRotina");
const { analisarRotinaViaGroq } = require("./promptRotinas");
const schedule = require("node-schedule");
const moment = require("moment-timezone");
const { removerConteudoDaMensagem, simularDigitar } = require("../utilitariosComandos");

// Estado para armazenar detalhes pendentes por chatId - seguindo padrão do adicionarTransacao
const estadoPendenteRotinas = {};
const tarefaTimeouts = {};

// Função para analisar entrada compacta
function processarEntradaCompacta(input) {
    console.log(`[LOG] processarEntradaCompacta - Iniciando análise da entrada: "${input}"`);

    const compactRegex = /^(criar rotina|criar lembrete)\s+(\d{2}\/\d{2}\/\d{4}|sempre|todos os dias|dias úteis|segunda|terça|quarta|quinta|sexta|sábado|domingo|.+?)\s+às\s+(\d{2}:\d{2})\s+(.+)$/i;
    const match = input.match(compactRegex);

    if (!match) {
        console.log(`[LOG] processarEntradaCompacta - Entrada não corresponde ao formato compacto: "${input}"`);
        console.log(`[LOG] processarEntradaCompacta - Regex esperado: criar rotina/lembrete + [dia/data] + às + [hora] + [mensagem]`);
        return null;
    }

    const [, , dayOrDate, time, message] = match;

    // Log detalhado dos valores extraídos
    console.log(`[LOG] processarEntradaCompacta - Formato compacto detectado com sucesso!`);
    console.log(`[LOG] processarEntradaCompacta - Data: "${dayOrDate}"`);
    console.log(`[LOG] processarEntradaCompacta - Hora: "${time}"`);
    console.log(`[LOG] processarEntradaCompacta - Descricao: "${message}"`);

    return { dayOrDate, time, message };
}

// Função para analisar entrada natural e flexível
function extrairDadosRotinaNatural(input) {
    // 1. Detectar "me lembra daqui X minutos/horas/dias ..."
    const relativoRegex = /me (?:lembra|lembre|lembrete)?\s*daqui\s*(\d+)\s*(minuto|minutos|hora|horas|dia|dias)\s*(?:depois|para)?\s*(.*)/i;
    const relativoMatch = input.match(relativoRegex);
    if (relativoMatch) {
        const quantidade = parseInt(relativoMatch[1], 10);
        const unidade = relativoMatch[2].toLowerCase();
        const mensagem = relativoMatch[4] ? relativoMatch[4].trim() : 'Lembrete';
        // Calcular data/hora alvo
        const now = moment.tz("America/Sao_Paulo");
        let alvo = now.clone();
        if (unidade.startsWith('min')) alvo.add(quantidade, 'minutes');
        else if (unidade.startsWith('hora')) alvo.add(quantidade, 'hours');
        else if (unidade.startsWith('dia')) alvo.add(quantidade, 'days');
        return {
            dayOrDate: alvo.format("YYYY-MM-DD"),
            time: alvo.format("HH:mm"),
            message: mensagem
        };
    }
    // 2. Regex flexível para padrões comuns
    const regex = /(?:(criar rotina|criar lembrete|lembrete|rotina)\s*)?(?:(todos os dias|dias úteis|dia útil|sempre|hoje|segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo|\d{2}\/\d{2}(?:\/\d{4})?|\d{2}\/\d{2})\s*)?(?:[àa]?s?\s*)?(\d{2}:\d{2})\s+(.+)/i;
    const match = input.match(regex);
    if (!match) return null;
    // match[2]: dia/data, match[3]: hora, match[4]: mensagem
    return {
        dayOrDate: match[2] ? match[2].trim() : undefined,
        time: match[3] ? match[3].trim() : undefined,
        message: match[4] ? match[4].trim() : undefined
    };
}

// Função principal para criação de rotinas - seguindo padrão do adicionarTransacao
async function criarRotina(sock, chatId, msg) {
    console.log("\n[LOG] Iniciando processo de criação de rotina...\n");

    const messageContent = removerConteudoDaMensagem(msg).trim();
    console.log(`[LOG] Mensagem recebida: ${messageContent}`);

    // Verificar se há detalhes pendentes para este chat
    if (estadoPendenteRotinas[chatId]) {
        console.log("\n[LOG] Estado pendente encontrado para o chat. Encaminhando para tratarDetalhesRotinas.");
        await tratarDetalhesRotinas(sock, chatId, messageContent);
        return;
    }

    try {
        // 1. Tentar extrair via Groq primeiro
        const groqData = await analisarRotinaViaGroq(messageContent);
        console.log("\n[LOG] Dados recebidos do Groq:", groqData);

        // Campos vitais: dayOrDate, time, type
        let camposFaltando = [];
        if (!groqData || !groqData.dayOrDate) camposFaltando.push("dayOrDate");
        if (!groqData || !groqData.time) camposFaltando.push("time");
        if (!groqData || !groqData.type) camposFaltando.push("type");

        if (!groqData || (camposFaltando.length === 3)) {
            console.log(`[LOG] Nenhum campo vital encontrado, estado pendente removido para chat ${chatId}`);
            delete estadoPendenteRotinas[chatId];
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
            text: `Hmm... essa eu não entendi 😅 Tenta mandar de outro jeito?

    Exemplos de mensagens que eu entendo:
    • "Amanhã às 10h pegar os exames"
    • "Todo sábado às 18h ir à academia"
    • "Me lembra de pagar o aluguel dia 10"
    • "Daqui a 30 minutos ligar para o João"
    • "Consulta médica em 2 dias às 9h"

    Pode tentar algo nesse estilo 😉`
            });
            return;
        }
        if (camposFaltando.length > 0) {
            console.log(`\n[LOG] Faltando campos vitais: ${camposFaltando.join(", ")}`);
            // Criar estado pendente e perguntar o primeiro campo faltante
            estadoPendenteRotinas[chatId] = {
                ...groqData,
                step: `ask_${camposFaltando[0]}`,
                camposFaltando,
                isCompact: true
            };
            await simularDigitar(sock, chatId);
            let pergunta = "";
            switch (camposFaltando[0]) {
                case "dayOrDate":
                    pergunta = "📅 *Qual o dia/data da rotina?*\nExemplo: 08, 12/07, segunda, todos os dias";
                    break;
                case "time":
                    pergunta = "⏰ *Qual o horário da rotina?*\nExemplo: 08:00";
                    break;
                case "type":
                    pergunta = "🔄 *A rotina é única ou repetitiva?*\nResponda: unica ou repetitiva";
                    break;
            }
            await sock.sendMessage(chatId, { text: pergunta });
            return;
        }

        // Se já tem os campos vitais, montar resumo
        let resumo = `✅ *Resumo da rotina até agora:*\n\n` +
            `📅 *Dia/Data:* ${groqData.dayOrDate || "Não informado"}\n` +
            `⏰ *Horário:* ${groqData.time || "Não informado"}\n` +
            `🔄 *Tipo:* ${groqData.type || "Não informado"}\n` +
            `📝 *Mensagem:* ${groqData.message || "Não informado"}\n` +
            `🔁 *Repetição:* ${groqData.repetition || "Não informado"}\n` +
            `📌 *É tarefa:* ${typeof groqData.isTask === 'boolean' ? (groqData.isTask ? "Sim" : "Não") : "Não informado"}`;

        // Se for alarme, adicionar destaque
        if (groqData.categoria === "alarme") {
            resumo += `\n\n🚨 *Categoria: Alarme*`;
        }

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: resumo +
                "\n\nDeseja salvar assim?\nDigite:\n✅ \`Confirmar\`\n\n✏️ \`editar\`\n\n❌ \`cancelar\`\n\nSe não responder em 30 segundos, será criada automaticamente."
        });

        // Criar estado pendente para confirmação/edição/cancelamento
        estadoPendenteRotinas[chatId] = {
            ...groqData,
            step: "confirmarResumo",
            isCompact: true
        };
        if (tarefaTimeouts[chatId]) clearTimeout(tarefaTimeouts[chatId]);
        tarefaTimeouts[chatId] = setTimeout(async () => {
            if (estadoPendenteRotinas[chatId] && estadoPendenteRotinas[chatId].step === "confirmarResumo") {
                console.log("\n[LOG] Tempo esgotado! Criando rotina automaticamente.");
                // Processar dados e criar rotina
                const processedData = await processarDadosRotina(groqData.dayOrDate, groqData.time, groqData.message);
                if (!processedData) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, { text: "⚠️ *Dados inválidos!*\n\nVerifique o formato e tente novamente." });
                    return;
                }
                processedData.type = groqData.type;
                processedData.repetition = groqData.repetition;
                processedData.isTask = groqData.isTask;
                if (groqData.categoria === "alarme") {
                    processedData.categoria = "alarme";
                }
                await finalizeRoutineCreation(sock, chatId, processedData);
            }
        }, 30 * 1000);
        return;
    } catch (error) {
        console.error(`\n[ERRO] Falha ao processar criação de rotina: ${error}`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "❌ Algo deu errado ao processar sua solicitação.\n\n🔍 Verifique os *logs* para entender melhor o que aconteceu."
        });
        return;
    }
}

/**
 * Função para processar formato compacto de rotina
 */
async function processarRotinaCompacta(sock, chatId, compactData) {
    console.log(`[LOG] processarRotinaCompacta - Iniciando processamento para chat ${chatId}`);
    console.log(`[LOG] processarRotinaCompacta - Dados recebidos: ${JSON.stringify(compactData)}`);

    let { dayOrDate, time, message } = compactData;

    // Se não veio horário, perguntar ao usuário
    if (!time || time.trim() === "") {
        estadoPendenteRotinas[chatId] = {
            dayOrDate,
            time: "",
            message,
            step: "enterTimeFaltante",
            isCompact: true
        };
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⏰ *Qual o horário da rotina?*\n\nPor favor, use o formato `HH:MM` (ex.: `08:00`).\n\nSe não responder em até 5 minutos, será considerado 08:00 por padrão."
        });
        if (tarefaTimeouts[chatId]) clearTimeout(tarefaTimeouts[chatId]);
        tarefaTimeouts[chatId] = setTimeout(async () => {
            if (estadoPendenteRotinas[chatId] && estadoPendenteRotinas[chatId].step === "enterTimeFaltante") {
                estadoPendenteRotinas[chatId].time = "08:00";
                estadoPendenteRotinas[chatId].step = "confirmTask";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⏰ Tempo esgotado! Considerando horário 08:00. Prosseguindo com a criação da rotina."
                });
                await processarRotinaCompacta(sock, chatId, {
                    dayOrDate: estadoPendenteRotinas[chatId].dayOrDate,
                    time: "08:00",
                    message: estadoPendenteRotinas[chatId].message
                });
            }
        }, 5 * 60 * 1000);
        return;
    }

    // Processar os dados de entrada
    console.log(`[LOG] processarRotinaCompacta - Processando dados da rotina...`);
    const processedData = await processarDadosRotina(dayOrDate, time, message);

    if (!processedData) {
        console.log(`[LOG] processarRotinaCompacta - Dados inválidos detectados para chat ${chatId}`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Dados inválidos!*\n\nVerifique o formato e tente novamente."
        });
        return;
    }

    console.log(`[LOG] processarRotinaCompacta - Dados processados com sucesso: ${JSON.stringify(processedData)}`);

    // Configurar estado pendente
    estadoPendenteRotinas[chatId] = {
        ...processedData,
        step: "confirmTask",
        isCompact: true
    };

    console.log(`[LOG] processarRotinaCompacta - Estado pendente configurado para chat ${chatId}`);
    console.log(`[LOG] processarRotinaCompacta - Perguntando se é uma tarefa...`);

    // Perguntar se é uma tarefa
    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "📌 *Essa rotina é uma tarefa?*\n\nResponda com:\n- *Sim* ou *1️⃣* para confirmar que é uma tarefa.\n- *Não* ou *2️⃣* caso contrário.\n\n*Se não responder em até 5 minutos, será considerado como NÃO tarefa.*"
    });
    // Iniciar timeout de 5 minutos
    if (tarefaTimeouts[chatId]) clearTimeout(tarefaTimeouts[chatId]);
    tarefaTimeouts[chatId] = setTimeout(async () => {
        if (estadoPendenteRotinas[chatId] && estadoPendenteRotinas[chatId].step === "confirmTask") {
            estadoPendenteRotinas[chatId].isTask = false;
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⏰ Tempo esgotado! Considerando que NÃO é uma tarefa. Prosseguindo com a criação da rotina."
            });
            await finalizeRoutineCreation(sock, chatId, estadoPendenteRotinas[chatId]);
        }
    }, 5 * 60 * 1000);
}

/**
 * Função para iniciar criação interativa de rotina
 */
async function iniciarCriacaoDeRotinaInterativa(sock, chatId) {
    console.log(`[LOG] iniciarCriacaoDeRotinaInterativa - Iniciando criação interativa para chat ${chatId}`);

    // Configurar estado inicial
    estadoPendenteRotinas[chatId] = {
        step: "selectType",
        isCompact: false
    };

    console.log(`[LOG] iniciarCriacaoDeRotinaInterativa - Estado inicial configurado: step=selectType, isCompact=false`);
    console.log(`[LOG] iniciarCriacaoDeRotinaInterativa - Enviando mensagem de seleção de tipo...`);

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "👋 *Olá! Vamos criar uma nova rotina ou lembrete?*\n\nEscolha o tipo de rotina que deseja criar:\n\n1️⃣ - *unica*: Um lembrete para uma data específica.\n2️⃣ - *Repetitiva*: Um lembrete que se repete em dias específicos."
    });
}

/**
 * Função principal para lidar com detalhes da rotina
 */
async function tratarDetalhesRotinas(sock, chatId, messageContent) {
    const details = estadoPendenteRotinas[chatId];
    console.log(`[LOG] tratarDetalhesRotinas - Processando detalhes da rotina para chat ${chatId}`);
    console.log(`[LOG] tratarDetalhesRotinas - Step atual: ${details.step}`);
    console.log(`[LOG] tratarDetalhesRotinas - Mensagem recebida: "${messageContent}"`);
    console.log(`[LOG] tratarDetalhesRotinas - Estado atual: ${JSON.stringify(details)}`);

    // Permitir cancelamento em qualquer etapa
    if (messageContent.toLowerCase() === "cancelar") {
        console.log(`[LOG] tratarDetalhesRotinas - Cancelamento solicitado para chat ${chatId}`);
        if (tarefaTimeouts[chatId]) {
            clearTimeout(tarefaTimeouts[chatId]);
            delete tarefaTimeouts[chatId];
        }
        delete estadoPendenteRotinas[chatId];
        console.log(`[LOG] tratarDetalhesRotinas - Estado pendente removido para chat ${chatId}`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "❌ *Processo de criação de rotina cancelado com sucesso!*"
        });
        return;
    }

    console.log(`[LOG] tratarDetalhesRotinas - Direcionando para step: ${details.step}`);

    switch (details.step) {
        case "selectType":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarSelecaoTipo`);
            await tratarSelecaoTipo(sock, chatId, messageContent, details);
            break;
        case "enterTime":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarEntradaTempo`);
            await tratarEntradaTempo(sock, chatId, messageContent, details);
            break;
        case "enterDays":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarEntradaDias`);
            await tratarEntradaDias(sock, chatId, messageContent, details);
            break;
        case "enterRepetition":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarEntradaRepeticao`);
            await tratarEntradaRepeticao(sock, chatId, messageContent, details);
            break;
        case "confirmTask":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarConfirmacaoTarefa`);
            await tratarConfirmacaoTarefa(sock, chatId, messageContent, details);
            break;
        case "enterMessage":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarMensagemNotificacao`);
            await tratarMensagemNotificacao(sock, chatId, messageContent, details);
            break;
        case "confirmRoutine":
            console.log(`[LOG] tratarDetalhesRotinas - Executando tratarConfirmacaoRotina`);
            await tratarConfirmacaoRotina(sock, chatId, messageContent, details);
            break;
        case "enterTimeFaltante":
            // Validar horário informado
            if (!validarFormatoHora(messageContent.trim())) {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⏰ *Horário inválido!*\n\nPor favor, use o formato `HH:MM` (ex.: `08:00`)."
                });
                return;
            }
            details.time = messageContent.trim();
            details.step = "confirmTask";
            await processarRotinaCompacta(sock, chatId, {
                dayOrDate: details.dayOrDate,
                time: details.time,
                message: details.message
            });
            return;
        case "ask_time":
        case "ask_dayOrDate":
        case "ask_type": {
            // Identifica qual campo está sendo perguntado
            const campo = details.step.replace("ask_", "");
            const valor = messageContent.trim();
            // Validação básica
            if (campo === "time" && !validarFormatoHora(valor)) {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⏰ *Horário inválido!*\nPor favor, use o formato HH:MM (ex.: 08:00)."
                });
                return;
            }
            // Salva o valor recebido
            details[campo] = valor;
            // Garante que camposFaltando seja array
            if (!Array.isArray(details.camposFaltando)) details.camposFaltando = [];
            details.camposFaltando = details.camposFaltando.filter(f => f !== campo);
            // Se ainda falta algum campo, pergunta o próximo
            if (details.camposFaltando.length > 0) {
                details.step = `ask_${details.camposFaltando[0]}`;
                await simularDigitar(sock, chatId);
                let pergunta = "";
                switch (details.camposFaltando[0]) {
                    case "dayOrDate":
                        pergunta = "📅 *Qual o dia/data da rotina?*\nExemplo: 08, 12/07, segunda, todos os dias";
                        break;
                    case "time":
                        pergunta = "⏰ *Qual o horário da rotina?*\nExemplo: 08:00";
                        break;
                    case "type":
                        pergunta = "🔄 *A rotina é única ou repetitiva?*\nResponda: unica ou repetitiva";
                        break;
                }
                await sock.sendMessage(chatId, { text: pergunta });
                return;
            }
            // Se todos os campos vitais foram preenchidos, exibe resumo para confirmação
            let resumo = `✅ *Resumo da rotina até agora:*\n\n` +
                `📅 *Dia/Data:* ${details.dayOrDate || "Não informado"}\n` +
                `⏰ *Horário:* ${details.time || "Não informado"}\n` +
                `🔄 *Tipo:* ${details.type || "Não informado"}\n` +
                `📝 *Mensagem:* ${details.message || "Não informado"}\n` +
                `🔁 *Repetição:* ${details.repetition || "Não informado"}\n` +
                `📌 *É tarefa:* ${typeof details.isTask === 'boolean' ? (details.isTask ? "Sim" : "Não") : "Não informado"}`;
            details.step = "confirmarResumo";
            if (groqData.categoria === "alarme") {
            resumo += `\n\n🚨 *Categoria: Alarme*`;
            }
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: resumo +
                    "\n\n*Deseja salvar assim?*\n\nDigite:\n✅ \`Sim\`para salvar\n\n✏️ \`editar\` para editar informações\n\n❌ \`Cancelar\`\n\nSe não responder em 30 segundos, será salva automaticamente."
            });

            if (tarefaTimeouts[chatId]) clearTimeout(tarefaTimeouts[chatId]);
            tarefaTimeouts[chatId] = setTimeout(async () => {
                if (estadoPendenteRotinas[chatId] && estadoPendenteRotinas[chatId].step === "confirmarResumo") {
                    console.log("\n[LOG] Tempo esgotado! Criando rotina automaticamente.");
                    // Processar dados e criar rotina
                    const processedData = await processarDadosRotina(details.dayOrDate, details.time, details.message);
                    if (!processedData) {
                        await simularDigitar(sock, chatId);
                        await sock.sendMessage(chatId, { text: "⚠️ *Dados inválidos!*\n\nVerifique o formato e tente novamente." });
                        return;
                    }
                    processedData.type = details.type;
                    processedData.repetition = details.repetition;
                    processedData.isTask = details.isTask;
                    processedData.categoria = details.categoria || "lembrete"; // Define categoria padrão
                    await finalizeRoutineCreation(sock, chatId, processedData);
                }
            }, 30 * 1000);
            return;
        }
        case "confirmarResumo":
            console.log(`[LOG] tratarDetalhesRotinas - Executando confirmação de resumo para chat ${chatId}`);
            if (messageContent.toLowerCase() === "confirmar" || messageContent.includes("sim") || messageContent.toLowerCase() === "quero") {
                // Processar dados antes de finalizar
                const processedData = await processarDadosRotina(details.dayOrDate, details.time, details.message);
                if (!processedData) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, { text: "⚠️ *Dados inválidos!*\n\nVerifique o formato e tente novamente." });
                    return;
                }
                processedData.type = details.type;
                processedData.repetition = details.repetition;
                processedData.isTask = details.isTask;
                processedData.categoria = details.categoria || "lembrete"; // Define categoria padrão
                await finalizeRoutineCreation(sock, chatId, processedData);


                
            } else if (messageContent.toLowerCase() === "editar") {
                // Iniciar fluxo de edição: perguntar qual campo deseja alterar
                details.awaitingEditChoice = true;
                if (tarefaTimeouts[chatId]) {
                    clearTimeout(tarefaTimeouts[chatId]);
                    delete tarefaTimeouts[chatId];
                }
                details.step = "editarResumo";
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: `✏️ *Qual campo deseja editar?*\n\nEscolha o número correspondente:\n\n1️⃣ - Dia/Data\n2️⃣ - Horário\n3️⃣ - Tipo\n4️⃣ - Mensagem\n5️⃣ - Repetição\n6️⃣ - Tarefa\n\n*Envie apenas o número da opção desejada.*\n\n✅ *Digite \`confirmar\` para salvar as alterações.*\n❌ *Digite \`cancelar\` para sair sem salvar.*`
                });
                return;
            } else {
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, {
                    text: "⚠️ Digite \`confirmar\` para salvar, \`editar\` para alterar algum campo ou \`cancelar\` para sair."
                });
            }
            return;
        case "editarResumo": {
            // Exibir menu interativo estilizado para edição
            const menu = `✏️ *Qual campo deseja editar?*\n\nEscolha o número correspondente:\n\n1️⃣ - Dia/Data\n2️⃣ - Horário\n3️⃣ - Tipo\n4️⃣ - Mensagem\n5️⃣ - Repetição\n6️⃣ - Tarefa\n\n*Envie apenas o número da opção desejada.*\n\n✅ *Digite \`confirmar\` para salvar as alterações.*\n❌ *Digite \`cancelar\` para sair sem salvar.*`;
            // Se ainda não está aguardando escolha, envia o menu e aguarda
            if (!details.awaitingEditChoice) {
                details.awaitingEditChoice = true;
                await simularDigitar(sock, chatId);
                await sock.sendMessage(chatId, { text: menu });
                return;
            }
            // Processar escolha do usuário
            const escolha = messageContent.trim().toLowerCase();
            if (escolha === "confirmar" || escolha.includes("sim")) {
                // Salvar a rotina do jeito que está
                details.awaitingEditChoice = false;
                const processedData = await processarDadosRotina(details.dayOrDate, details.time, details.message);
                if (!processedData) {
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, { text: "⚠️ *Dados inválidos!*\n\nVerifique o formato e tente novamente." });
                    return;
                }
                processedData.type = details.type;
                processedData.repetition = details.repetition;
                processedData.isTask = details.isTask;
                processedData.categoria = details.categoria || "lembrete"; // Define categoria padrão
                await finalizeRoutineCreation(sock, chatId, processedData);
                return;
            }
            let campoEscolhido = null;
            switch (escolha) {
                case "1": campoEscolhido = "ask_dayOrDate"; break;
                case "2": campoEscolhido = "ask_time"; break;
                case "3": campoEscolhido = "ask_type"; break;
                case "4": campoEscolhido = "ask_message"; break;
                case "5": campoEscolhido = "ask_repetition"; break;
                case "6": campoEscolhido = "ask_isTask"; break;
                default:
                    await simularDigitar(sock, chatId);
                    await sock.sendMessage(chatId, {
                        text: "⚠️ *Opção inválida!* Escolha um número de 1 a 6, ou digite 'confirmar' para salvar, ou 'cancelar' para sair."
                    });
                    return;
            }
            details.step = campoEscolhido;
            details.awaitingEditChoice = false;
            // Redireciona para função correta
            switch (campoEscolhido) {
                case "ask_dayOrDate":
                    await tratarEntradaDias(sock, chatId, "", details);
                    break;
                case "ask_time":
                    await tratarEntradaTempo(sock, chatId, "", details);
                    break;
                case "ask_type":
                    await tratarSelecaoTipo(sock, chatId, "", details);
                    break;
                case "ask_message":
                    await tratarMensagemNotificacao(sock, chatId, "", details);
                    break;
                case "ask_repetition":
                    await tratarEntradaRepeticao(sock, chatId, "", details);
                    break;
                case "ask_isTask":
                    await tratarConfirmacaoTarefa(sock, chatId, "", details);
                    break;
            }
            return;
        }
        default:
            console.error(`[ERRO] tratarDetalhesRotinas - Step não reconhecido: ${details.step}`);
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ *Erro interno!* Reiniciando processo..."
            });
            delete estadoPendenteRotinas[chatId];
            console.log(`[LOG] tratarDetalhesRotinas - Estado pendente removido após erro para chat ${chatId}`);
            break;
    }
}
/**
 * Função para processar e validar dados da rotina
 */
async function processarDadosRotina(dayOrDate, time, message) {
    console.log(`[LOG] processarDadosRotina - Iniciando processamento dos dados`);
    console.log(`[LOG] processarDadosRotina - dayOrDate: "${dayOrDate}"`);
    console.log(`[LOG] processarDadosRotina - time: "${time}"`);
    console.log(`[LOG] processarDadosRotina - message: "${message}"`);

    // Validar horário
    console.log(`[LOG] processarDadosRotina - Validando formato do horário...`);
    if (!validarFormatoHora(time)) {
        console.log(`[LOG] processarDadosRotina - Horário inválido: "${time}"`);
        return null;
    }
    console.log(`[LOG] processarDadosRotina - Horário válido: "${time}"`);

    let days = null;
    let repetition = null;
    let type = "unica";

    console.log(`[LOG] processarDadosRotina - Processando dias/data...`);

    // Processar dias/data
    if (["sempre", "todos os dias", "todos"].includes(dayOrDate.toLowerCase())) {
        console.log(`[LOG] processarDadosRotina - Detectado: todos os dias`);
        days = "todos";
        repetition = "diariamente";
        type = "repetitiva";
    } else if (dayOrDate.toLowerCase() === "dias úteis") {
        console.log(`[LOG] processarDadosRotina - Detectado: dias úteis`);
        days = ["segunda", "terça", "quarta", "quinta", "sexta"];
        repetition = "semanalmente";
        type = "repetitiva";
    } else if (/^(0?[1-9]|[12][0-9]|3[01])$/.test(dayOrDate)) {
        // Novo: suporte para dia do mês (ex: '08' ou '8' para todo dia 8)
        console.log(`[LOG] processarDadosRotina - Detectado: dia do mês (todo dia ${dayOrDate})`);
        days = dayOrDate.replace(/^0/, ""); // Remove zero à esquerda para padronizar
        repetition = "mensalmente";
        type = "repetitiva";
    } else {
        const dayOfWeekRegex = /^(domingo|segunda|terça|quarta|quinta|sexta|sábado)$/i;
        const dateRegex = /^\d{2}\/\d{2}$/;
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/; // Novo: aceita YYYY-MM-DD

        if (dayOrDate.toLowerCase() === "hoje") {
            console.log(`[LOG] processarDadosRotina - Detectado: hoje`);
            days = moment.tz("America/Sao_Paulo").format("YYYY-MM-DD");
            type = "unica";
        } else if (dateRegex.test(dayOrDate)) {
            console.log(`[LOG] processarDadosRotina - Detectado: data específica`);
            const [day, month, year] = dayOrDate.split("/").map(Number);
            const anoAtual = moment.tz("America/Sao_Paulo").year();
            const targetYear = year || anoAtual;

            console.log(`[LOG] processarDadosRotina - Processando data: ${day}/${month}/${targetYear}`);
            const dataAlvo = moment.tz({ day, month: month - 1, year: targetYear }, "America/Sao_Paulo");

            if (!dataAlvo.isValid() || dataAlvo.isBefore(moment.tz("America/Sao_Paulo"), "day")) {
                console.log(`[LOG] processarDadosRotina - Data inválida ou no passado: ${dataAlvo.format("YYYY-MM-DD")}`);
                return null;
            }

            days = dataAlvo.format("YYYY-MM-DD");
            console.log(`[LOG] processarDadosRotina - Data válida convertida para: ${days}`);
        } else if (isoDateRegex.test(dayOrDate)) {
            days = dayOrDate;
            type = "unica";
        } else if (dayOfWeekRegex.test(dayOrDate) || dayOrDate.includes(",")) {
            console.log(`[LOG] processarDadosRotina - Detectado: dia(s) da semana`);
            const daysArray = dayOrDate
                .split(",")
                .map(day => day.trim().toLowerCase())
                .filter(day => ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"].includes(day));

            console.log(`[LOG] processarDadosRotina - Dias processados: ${JSON.stringify(daysArray)}`);

            if (daysArray.length === 0) {
                console.log(`[LOG] processarDadosRotina - Nenhum dia válido encontrado`);
                return null;
            }

            days = daysArray;
            if (daysArray.length > 1) {
                repetition = "semanalmente";
                type = "repetitiva";
                console.log(`[LOG] processarDadosRotina - Múltiplos dias detectados, tipo: repetitiva`);
            } else {
                console.log(`[LOG] processarDadosRotina - Dia único detectado`);
            }
        } else {
            console.log(`[LOG] processarDadosRotina - Formato de dia/data não reconhecido: "${dayOrDate}" (tipo: ${typeof dayOrDate})`);
            if (dayOrDate && typeof dayOrDate !== 'string') {
                console.log(`[LOG] processarDadosRotina - Valor bruto de dayOrDate:`, dayOrDate);
            }
            return null;
        }
    }

    const result = {
        time,
        days: Array.isArray(days) ? days.join(", ") : days,
        message,
        repetition: repetition || "N/A",
        type
    };

    console.log(`[LOG] processarDadosRotina - Dados processados com sucesso: ${JSON.stringify(result)}`);
    return result;
}
/**
 * Funções de manipulação para cada etapa
 */
async function tratarSelecaoTipo(sock, chatId, messageContent, details) {
    console.log(`[LOG] tratarSelecaoTipo - Processando seleção de tipo para chat ${chatId}`);
    console.log(`[LOG] tratarSelecaoTipo - Resposta recebida: "${messageContent}"`);

    if (messageContent === "1" || messageContent.toLowerCase() === "unica" || messageContent.toLowerCase() === "unica") {
        console.log(`[LOG] tratarSelecaoTipo - Tipo selecionado: unica`);
        details.type = "unica";
    } else if (messageContent === "2" || messageContent.toLowerCase() === "repetitiva") {
        console.log(`[LOG] tratarSelecaoTipo - Tipo selecionado: repetitiva`);
        details.type = "repetitiva";
    } else {
        console.log(`[LOG] tratarSelecaoTipo - Opção inválida recebida: "${messageContent}"`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Opção inválida!*\n\nPor favor, escolha uma das opções:\n\n1️⃣ - *unica*\n2️⃣ - *Repetitiva*"
        });
        return;
    }

    details.step = "enterTime";
    console.log(`[LOG] tratarSelecaoTipo - Avançando para step: enterTime`);
    console.log(`[LOG] tratarSelecaoTipo - Estado atualizado: ${JSON.stringify(details)}`);

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "⏰ *Qual o horário da rotina?*\n\nPor favor, use o formato `HH:MM` (ex.: `14:30`)."
    });
}

async function tratarEntradaTempo(sock, chatId, messageContent, details) {
    console.log(`[LOG] tratarEntradaTempo - Processando entrada de horário para chat ${chatId}`);
    console.log(`[LOG] tratarEntradaTempo - Horário recebido: "${messageContent}"`);

    const trimmedTime = messageContent.trim();
    if (!validarFormatoHora(trimmedTime)) {
        console.log(`[LOG] tratarEntradaTempo - Horário inválido: "${trimmedTime}"`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⏰ *Horário inválido!*\n\nPor favor, use o formato `HH:MM` (ex.: `19:35`)."
        });
        return;
    }

    details.time = trimmedTime;
    details.step = "enterDays";
    console.log(`[LOG] tratarEntradaTempo - Horário válido salvo: "${trimmedTime}"`);
    console.log(`[LOG] tratarEntradaTempo - Avançando para step: enterDays`);
    console.log(`[LOG] tratarEntradaTempo - Estado atualizado: ${JSON.stringify(details)}`);

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "📅 *Qual o dia ou data da rotina?*\n\nPor favor, informe:\n- Um dia ou dias da semana (ex.: *terça*, ou *terça, quarta*)\n- Uma data específica no formato *DD/MM* (ex.: *12/05*)\n- *Hoje* para a data atual\n- *Todos* para todos os dias\n- *Dias úteis* para segunda a sexta-feira"
    });
}

async function tratarEntradaDias(sock, chatId, messageContent, details) {
    const input = messageContent.trim();
    const dayOfWeekRegex = /^(domingo|segunda|terça|quarta|quinta|sexta|sábado)$/i;
    const dateRegex = /^\d{2}\/\d{2}$/;

    if (input.toLowerCase() === "hoje") {
        details.days = moment.tz("America/Sao_Paulo").format("YYYY-MM-DD");
        details.type = "unica";
        details.step = "confirmTask";
    } else if (["dias úteis", "dias uteis", "segunda a sexta", "uteis"].includes(input.toLowerCase())) {
        details.days = ["segunda", "terça", "quarta", "quinta", "sexta"].join(", ");
        details.repetition = "semanalmente";
        details.type = "repetitiva";
        details.step = "confirmTask";
    } else if (input.toLowerCase() === "todos") {
        details.days = "todos";
        details.repetition = "diariamente";
        details.type = "repetitiva";
        details.step = "confirmTask";
    } else if (input.includes(",")) {
        const days = input.split(",").map(day => day.trim().toLowerCase());
        const validDays = days.every(day => dayOfWeekRegex.test(day));

        if (!validDays) {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ *Dias inválidos!* Use nomes válidos separados por vírgulas.\nExemplo: `segunda, terça, quarta`"
            });
            return;
        }

        details.days = days.join(", ");
        details.step = "enterRepetition";
    } else if (dayOfWeekRegex.test(input)) {
        details.days = input.toLowerCase();
        details.step = "enterRepetition";
    } else if (dateRegex.test(input)) {
        const [day, month] = input.split("/").map(Number);
        const dataAlvo = moment({ day, month: month - 1 });

        if (!dataAlvo.isValid() || dataAlvo.isBefore(moment(), "day")) {
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "⚠️ *Data inválida!* Use o formato DD/MM e uma data futura."
            });
            return;
        }

        details.days = dataAlvo.format("YYYY-MM-DD");
        details.type = "unica";
        details.step = "confirmTask";
    } else {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Entrada inválida!* Tente novamente com um formato válido."
        });
        return;
    }

    // Avançar para próxima etapa se não for repetição
    if (details.step === "confirmTask") {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "📌 *Essa rotina é uma tarefa?*\n\nResponda com:\n- *Sim* ou *1️⃣* para confirmar que é uma tarefa.\n- *Não* ou *2️⃣* caso contrário."
        });
    } else if (details.step === "enterRepetition") {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "🔄 *Com que frequência essa rotina deve se repetir?*\n\n1️⃣ - Semanalmente\n2️⃣ - A cada 2 semanas\n3️⃣ - Mensalmente\n4️⃣ - Anualmente\n\nOu envie `N/A` para nenhuma repetição."
        });
    }
}

async function tratarEntradaRepeticao(sock, chatId, messageContent, details) {
    const repetitionOptions = {
        "1": "semanalmente",
        "2": "a cada 2 semanas",
        "3": "mensalmente",
        "4": "anualmente",
        "n/a": "N/A"
    };

    const repetition = repetitionOptions[messageContent.trim().toLowerCase()];
    if (!repetition) {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Opção inválida!* Digite:\n1 - Semanalmente\n2 - A cada 2 semanas\n3 - Mensalmente\n4 - Anualmente\nOu 'N/A' para nenhuma repetição."
        });
        return;
    }

    details.repetition = repetition;
    details.type = repetition !== "N/A" ? "repetitiva" : "unica";
    details.step = "confirmTask";

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: "📌 *Essa rotina é uma tarefa?*\n\nResponda com:\n- *Sim* ou *1️⃣* para confirmar que é uma tarefa.\n- *Não* ou *2️⃣* caso contrário."
    });
}

async function tratarConfirmacaoTarefa(sock, chatId, messageContent, details) {
    console.log(`[LOG] tratarConfirmacaoTarefa - Processando confirmação de tarefa para chat ${chatId}`);
    console.log(`[LOG] tratarConfirmacaoTarefa - Resposta recebida: "${messageContent}"`);
    console.log(`[LOG] tratarConfirmacaoTarefa - isCompact: ${details.isCompact}`);

    let isTask;
    if (["sim", "1", "s"].includes(messageContent.toLowerCase())) {
        console.log(`[LOG] tratarConfirmacaoTarefa - Confirmado como tarefa`);
        isTask = true;
    } else if (["não", "nao", "2", "n"].includes(messageContent.toLowerCase())) {
        console.log(`[LOG] tratarConfirmacaoTarefa - Confirmado como NÃO tarefa`);
        isTask = false;
    } else {
        console.log(`[LOG] tratarConfirmacaoTarefa - Resposta inválida: "${messageContent}"`);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Resposta inválida!* Responda com 'Sim', 'Não', '1' ou '2'."
        });
        return;
    }

    details.isTask = isTask;
    console.log(`[LOG] tratarConfirmacaoTarefa - isTask definido como: ${isTask}`);

    // Se for formato compacto, já temos a mensagem
    if (details.isCompact) {
        console.log(`[LOG] tratarConfirmacaoTarefa - Formato compacto detectado, finalizando criação...`);
        await finalizeRoutineCreation(sock, chatId, details);
    } else {
        details.step = "enterMessage";
        console.log(`[LOG] tratarConfirmacaoTarefa - Formato interativo, avançando para step: enterMessage`);
        console.log(`[LOG] tratarConfirmacaoTarefa - Estado atualizado: ${JSON.stringify(details)}`);

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "📝 *Qual será o conteúdo da rotina ou lembrete?*\n\nPor favor, envie a mensagem que deseja associar a esta rotina."
        });
    }
}

async function tratarMensagemNotificacao(sock, chatId, messageContent, details) {
    const message = messageContent.trim();
    if (!message) {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ *Mensagem inválida!* Por favor, envie o conteúdo da rotina."
        });
        return;
    }

    details.message = message;
    details.step = "confirmRoutine";

    await simularDigitar(sock, chatId);
    await sock.sendMessage(chatId, {
        text: `✅ *Confirme os dados da rotina:*\n\n- 🕒 *Horário:* ${details.time}\n- 📅 *Data/Dias:* ${details.days}\n- 📝 *Mensagem:* "${details.message}"\n- 🔄 *Repetição:* ${details.repetition || "N/A"}\n- 📌 *É tarefa:* ${details.isTask ? "Sim" : "Não"}\n\nDigite *confirmar* para salvar ou *cancelar* para sair.`
    });
}

async function tratarConfirmacaoRotina(sock, chatId, messageContent, details) {
    if (messageContent.toLowerCase() !== "confirmar") {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "⚠️ Digite 'confirmar' para salvar a rotina ou 'cancelar' para sair."
        });
        return;
    }

    await finalizeRoutineCreation(sock, chatId, details);
}

/**
 * Função para finalizar a criação da rotina
 */
async function finalizeRoutineCreation(sock, chatId, details) {
    console.log(`[LOG] finalizeRoutineCreation - Iniciando finalização para chat ${chatId}`);
    console.log(`[LOG] finalizeRoutineCreation - Detalhes da rotina: ${JSON.stringify(details)}`);

    try {
        console.log(`[LOG] finalizeRoutineCreation - Obtendo próximo ID...`);
        const nextId = await getNextRoutineId();
        console.log(`[LOG] finalizeRoutineCreation - Próximo ID obtido: ${nextId}`);

        console.log(`[LOG] finalizeRoutineCreation - Calculando primeiro lembrete...`);
        const proximoLembrete = calculateFirstReminder(details.time, details.days, details.repetition, details.type);
        console.log(`[LOG] finalizeRoutineCreation - Primeiro lembrete calculado: ${proximoLembrete}`);

        // Novos campos inteligentes para rotinas
        let ultimaNotificacao = null;
        let proximaNotificacao = proximoLembrete;
        let ultimaRealizacao = null;
        let proximaRealizacao = null;

        if (details.type === "repetitiva") {
            // Para rotina repetitiva, próxima notificação é o próximo lembrete
            proximaNotificacao = proximoLembrete;
            // Se for tarefa, controlar realização
            if (details.isTask) {
                // Para tarefas repetitivas, próxima realização é igual à próxima notificação
                proximaRealizacao = proximoLembrete;
                // ultimaRealizacao só será preenchida ao concluir
            }
        } else {
            // Para rotina unica, só há próxima notificação
            proximaNotificacao = proximoLembrete;
        }

        // Preservar categoria do details, mesmo após processarDadosRotina
        let categoria = details.categoria || "lembrete";
        if (!categoria && details.message && /alarme|acordar|despertar|despertador/i.test(details.message)) {
            categoria = "alarme";
        }
        const routineData = {
            id: nextId,
            time: details.time || "08:00",
            days: details.days,
            message: details.message || "Lembrete",
            status: "Ativo",
            repetition: details.repetition || "unica",
            type: details.type,
            isTask: details.isTask ? "Sim" : "Não",
            completed: "Não",
            completionDate: "N/A",
            userId: chatId,
            timezone: "America/Sao_Paulo",
            proximoLembrete: proximoLembrete,
            // Novos campos inteligentes
            ultimaNotificacao,
            proximaNotificacao,
            ultimaRealizacao,
            proximaRealizacao,
            categoria: categoria
        };

        console.log(`[LOG] finalizeRoutineCreation - Dados da rotina preparados: ${JSON.stringify(routineData)}`);
        console.log(`[LOG] finalizeRoutineCreation - Salvando no Firebase...`);
        await criarRotinaFirebase(routineData);
        console.log(`[LOG] finalizeRoutineCreation - Rotina salva com sucesso no Firebase`);

        console.log(`[LOG] finalizeRoutineCreation - Inicializando lembrete...`);
        await initializeSingleReminder(sock);
        console.log(`[LOG] finalizeRoutineCreation - Lembrete inicializado com sucesso`);

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `🎉 *Rotina criada com sucesso!*\n\n📅 *Data/Dias:* ${details.days}\n🕒 *Horário:* ${details.time}\n📝 *Mensagem:* "${details.message}"\n\nSe precisar criar outra rotina, envie:\n\`criar rotina\` ou \`criar lembrete\`.`
        });

        delete estadoPendenteRotinas[chatId];
        if (tarefaTimeouts[chatId]) {
            clearTimeout(tarefaTimeouts[chatId]);
            delete tarefaTimeouts[chatId];
        }
        console.log(`[LOG] finalizeRoutineCreation - Detalhes pendentes removidos para chat ${chatId}`);
        console.log(`[LOG] finalizeRoutineCreation - Processo finalizado com sucesso!`);
    } catch (error) {
        console.error(`[ERRO] finalizeRoutineCreation - Falha ao finalizar criação da rotina para chat ${chatId}: ${error}`);
        console.error(`[ERRO] finalizeRoutineCreation - Stack trace: ${error.stack}`);

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "❌ *Erro ao criar rotina!* Tente novamente."
        });
    }
}

/**
 * Função para extrair dados de rotina em formato robusto
 */
function extrairDadosRotinaRobusto(input) {
    // 1. Relativo: "daqui 10 dias tenho que fazer isso"
    const relativoRegex = /daqui\s*(\d+)\s*(minuto|minutos|hora|horas|dia|dias|semana|semanas|mês|meses|ano|anos)\s*(?:tenho que|vou|preciso|devo)?\s*(.*)/i;
    const relativoMatch = input.match(relativoRegex);
    if (relativoMatch) {
        const quantidade = parseInt(relativoMatch[1], 10);
        const unidade = relativoMatch[2].toLowerCase();
        const mensagem = relativoMatch[4] ? relativoMatch[4].trim() : 'Lembrete';
        const now = moment.tz("America/Sao_Paulo");
        let alvo = now.clone();
        if (unidade.startsWith('min')) alvo.add(quantidade, 'minutes');
        else if (unidade.startsWith('hora')) alvo.add(quantidade, 'hours');
        else if (unidade.startsWith('dia')) alvo.add(quantidade, 'days');
        else if (unidade.startsWith('sem')) alvo.add(quantidade, 'weeks');
        else if (unidade.startsWith('m')) alvo.add(quantidade, 'months');
        else if (unidade.startsWith('a')) alvo.add(quantidade, 'years');
        return {
            dayOrDate: alvo.format("YYYY-MM-DD"),
            time: alvo.format("HH:mm"),
            message: mensagem
        };
    }
    // 2. Recorrente: "toda terça e quinta vou ter reunião às 14 horas"
    const recorrenteRegex = /tod[oa]s?\s*(os|as)?\s*((?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:\s*e\s*(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo))*)[\s,]*(?:vou|tenho|preciso|devo|tenho que|preciso|devo)?\s*(?:.*)?\s*[àa]?s?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\s*(.*)/i;
    const recorrenteMatch = input.match(recorrenteRegex);
    if (recorrenteMatch) {
        // Dias podem estar separados por "e" ou ","
        let dias = recorrenteMatch[2].replace(/\s*e\s*/g, ',').replace(/\s+/g, '').split(',');
        dias = dias.map(d => d.replace('terca', 'terça').replace('sabado', 'sabado'));
        const hora = recorrenteMatch[3].padStart(2, '0');
        const minuto = recorrenteMatch[4] ? recorrenteMatch[4].padStart(2, '0') : '00';
        const mensagem = recorrenteMatch[5] ? recorrenteMatch[5].trim() : 'Lembrete';
        return {
            dayOrDate: dias.join(', '),
            time: `${hora}:${minuto}`,
            message: mensagem
        };
    }
    // 3. Todo dia: "todo dia de 08 horas tenho que fazer tal coisa"
    const todoDiaRegex = /tod[oa]s?\s*(os|as)?\s*dias?\s*(?:de|às|as)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\s*(.*)/i;
    const todoDiaMatch = input.match(todoDiaRegex);
    if (todoDiaMatch) {
        const hora = todoDiaMatch[2].padStart(2, '0');
        const minuto = todoDiaMatch[3] ? todoDiaMatch[3].padStart(2, '0') : '00';
        const mensagem = todoDiaMatch[4] ? todoDiaMatch[4].trim() : 'Lembrete';
        return {
            dayOrDate: 'todos',
            time: `${hora}:${minuto}`,
            message: mensagem
        };
    }
    // 4. Fallback: usar parser natural existente
    return extrairDadosRotinaNatural(input);
}

module.exports = {
    criarRotina,
    tratarDetalhesRotinas,
    estadoPendenteRotinas
};