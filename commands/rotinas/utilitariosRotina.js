const { obterRotinas, atualizarRotinas } = require("../firebaseFolder/rotinasFirebase");
const schedule = require("node-schedule");
const moment = require("moment-timezone");
const { simularDigitar } = require("../utilitariosComandos");
const { sendGroqChat } = require("../../routes/groq");

const lembretesAtivos = {}; // Estado para rastrear lembretes ativos

// Função para validar o formato de horário
function validarFormatoHora(time) {
    const regex = /^\d{2}:\d{2}$/;
    return regex.test(time);
}

// Função para formatar a resposta das rotinas
function formatRoutineResponse(routines) {
    if (!routines || routines.length === 0) {
        return "Nenhuma rotina encontrada.";
    }

    let response = "📋 Rotinas Programadas:\n";
    routines.forEach(([time, message, status, repetition], index) => {
        response += `${index + 1}. ${time} - ${message} (${status}) - Repetição: ${repetition}\n`;
    });

    return response;
}

// Função para obter todas as rotinas do Firebase
async function obterRotinasFromFirebase() {
    let routines = await obterRotinas(); // Ler as rotinas do Firebase

    // Remover rotinas unicas inativas ou marcadas como não realizadas
    routines = (routines || []).filter((routine) => {
        const [id, , , , status, , type, , , , , ] = routine;
        // Se for rotina unica e está inativa ou não realizada, remove
        if (type === "unica" && (status === "Inativo" || status === "nao_realizada")) {
            // Apagar do Firebase
            atualizarRotinas(id, { deletar: true }).catch(() => {});
            return false;
        }
        // Se for tarefa não repetitiva e suspensa, remove
        if (type !== "repetitiva" && status === "nao_realizada") {
            atualizarRotinas(id, { deletar: true }).catch(() => {});
            return false;
        }
        return true;
    });

    // Log para depuração
    //console.log("[DEBUG] Dados brutos retornados por obterRotinas:", routines);

    // Garantir que os dados estejam limpos
    const cleanedRoutines = (routines || []).map((routine) => {
        return routine.map((field) => (field ? field.toString().trim() : "N/A"));
    });

    // Log para verificar os dados limpos
    //console.log("[DEBUG] Dados limpos:", cleanedRoutines);

    return cleanedRoutines;
}

// Função para agendar uma rotina usando o campo proximoLembrete
function scheduleRoutine(id, time, days, message, repetition, sock, isTask, completed, userId, proximoLembrete, type) {
    const timeZone = "America/Sao_Paulo";

    // Validar se o userId foi fornecido
    if (!userId) {
        console.error(`[ERRO] userId não fornecido para a rotina ID ${id}. Não é possível agendar notificação.`);
        return;
    }

    // Usar o proximoLembrete se fornecido, senão calcular
    let nextReminderDate;
    if (proximoLembrete && proximoLembrete !== "N/A") {
        nextReminderDate = moment.tz(proximoLembrete, "YYYY-MM-DD HH:mm:ss", timeZone);
    } else {
        // Fallback: calcular o primeiro lembrete
        const firstReminder = calculateFirstReminder(time, days, repetition, type);
        nextReminderDate = moment.tz(firstReminder, "YYYY-MM-DD HH:mm:ss", timeZone);
    }

    // Verificar se a data/hora já passou - se sim, não agendar
    if (nextReminderDate.isBefore(moment.tz(timeZone))) {
        console.log(`[LOG] ⚠️ Ignorando agendamento para data passada: ${nextReminderDate.format("YYYY-MM-DD HH:mm:ss")}`);

        // Para rotinas repetitivas, calcular o próximo lembrete válido
        if (type === "repetitiva") {
            const nextValidReminder = calculateNextReminder(nextReminderDate.format("YYYY-MM-DD HH:mm:ss"), repetition, time, days);
            nextReminderDate = moment.tz(nextValidReminder, "YYYY-MM-DD HH:mm:ss", timeZone);

            // Atualizar o proximoLembrete no Firebase
            atualizarRotinas(id, { proximoLembrete: nextValidReminder }).catch(error => {
                console.error(`[ERRO] Falha ao atualizar proximoLembrete para rotina ID ${id}:`, error);
            });
        } else {
            return; // Para rotinas unicas passadas, não agendar
        }
    }

    const localTime = nextReminderDate.format("YYYY-MM-DD HH:mm:ss");
    const utcTime = nextReminderDate.utc().format("YYYY-MM-DD HH:mm:ss");

    // Ajuste: exibir "Evento único" para rotinas unicas
    const repeticaoExibida = (type === "unica") ? "Evento único" : (repetition || "N/A");

    console.log(` 
        [LOG] Criando lembrete:
        - ID: ${id}
        - UserId: ${userId}
        - Tipo: ${type}
        - Dias: ${days}
        - Mensagem: "${message}"
        - Próximo Lembrete: ${localTime}
        - Horário UTC: ${utcTime}
        - Repetição: ${repeticaoExibida}
        - É tarefa: ${isTask ? "Sim" : "Não"}
    `);

    schedule.scheduleJob(nextReminderDate.toDate(), async () => {
        console.log(`[LOG] Enviando lembrete para a rotina ID ${id} ao usuário ${userId}: "${message}"`);
        try {
            // Criar momento atual no fuso horário correto para formatação
            const nowLocal = moment.tz(timeZone);
            const reminderTimeLocal = moment.tz(nextReminderDate, timeZone);

            let messageText = `🔔 *${isTask ? 'Tarefa' : 'Lembrete'}:*\n\n📝 "${message}"\n\n🕒 *Horário:* ${reminderTimeLocal.format("HH:mm")}\n📅 *Data:* ${reminderTimeLocal.format("DD/MM/YYYY")}`;

            if (isTask) {
                messageText += `\n\n📌 *Esta é uma TAREFA!* 
                
🔔 *IMPORTANTE:* Após completar a tarefa, responda:
• ✅ \`SIM\` - para marcar como concluída
• ➡️ \`DEPOIS\` - para adiar e ser lembrado novamente em 1 hora
• 🚫 \`NÃO VOU FAZER\` - para suspender futuros lembretes

💡 *Dica:* Você pode responder a qualquer momento, mesmo agora!`;

                // Encerrar qualquer estado pendente anterior para este usuário
                if (lembretesAtivos[userId]) {
                    console.log(`[LOG] Encerrando estado pendente anterior para usuário ${userId} - Tarefa ID ${lembretesAtivos[userId].id}: "${lembretesAtivos[userId].message}"`);
                    delete lembretesAtivos[userId];
                }

                // Definir a nova tarefa como pendente IMEDIATAMENTE
                lembretesAtivos[userId] = { id, message, isFirstAsk: false };
                console.log(`[LOG] Nova tarefa notificada para usuário ${userId} - ID ${id}: "${message}" - Estado pendente ATIVO`);
            }

            await simularDigitar(sock, userId);
            await sock.sendMessage(userId, { text: messageText });

            // Para rotinas repetitivas, calcular e agendar o próximo lembrete
            if (type === "repetitiva") {
                const nextReminder = calculateNextReminder(localTime, repetition, time, days);
                await atualizarRotinas(id, { proximoLembrete: nextReminder });
                console.log(`[LOG] Próximo lembrete agendado para rotina ID ${id}: ${nextReminder}`);

                // Reagendar automaticamente para o próximo ciclo
                scheduleRoutine(id, time, days, message, repetition, sock, isTask, completed, userId, nextReminder, type);
            } else {
                // Para rotinas unicas, marcar como inativa após o lembrete
                // Se não for tarefa e não tem repetição, apagar a rotina
                if (!isTask && (!repetition || repetition === "N/A")) {
                    await atualizarRotinas(id, { deletar: true });
                    console.log(`[LOG] Rotina única não-tarefa ID ${id} apagada após lembrete.`);
                } else {
                    await atualizarRotinas(id, {
                        status: "Inativo",
                        proximoLembrete: "N/A"
                    });
                    console.log(`[LOG] Rotina única ID ${id} marcada como inativa após lembrete.`);
                }
            }

            if (isTask) {
                // Perguntar após 10 minutos se a tarefa foi concluída
                const followUpDate = reminderTimeLocal.clone().add(10, "minutes");
                schedule.scheduleJob(followUpDate.toDate(), async () => {
                    console.log(`[LOG] Perguntando sobre a conclusão da tarefa ID ${id} ao usuário ${userId} após 10 minutos`);
                    await sock.sendMessage(userId, {
                        text: `❓ *VERIFICAÇÃO DE TAREFA* ❓\n\n📝 Você já concluiu a tarefa: *"${message}"*?\n\n✅ Responda \`SIM\` se já fez\n❌ Responda \`DEPOIS\` se ainda não fez\n🚫 Responda \`NÃO VOU FAZER\` para cancelar\n\n⏰ *Esta é uma verificação automática após 10 minutos*`
                    });

                    // Não sobrescrever se já existe um activeReminder
                    if (!lembretesAtivos[userId]) {
                        lembretesAtivos[userId] = { id, message, isFirstAsk: true };
                    }
                    // Atualizar proximoLembrete para o followUpDate
                    try {
                        await atualizarRotinas(id, { proximoLembrete: followUpDate.format("YYYY-MM-DD HH:mm:ss") });
                        console.log(`[LOG] proximoLembrete atualizado para tarefa ID ${id}: ${followUpDate.format("YYYY-MM-DD HH:mm:ss")}`);
                    } catch (error) {
                        console.error(`[ERRO] Falha ao atualizar proximoLembrete para tarefa ID ${id}:`, error);
                    }
                });
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao enviar notificação para o usuário ${userId}:`, error);
        }
    });
}

// Função para converter o nome do dia para o índice do `node-schedule`
function obterDiaDaSemana(day) {
    const diasDaSemana = {
        domingo: 0,
        segunda: 1,
        terça: 2,
        terca: 2, // Adicionado para lidar com strings sanitizadas
        quarta: 3,
        quinta: 4,
        sexta: 5,
        sábado: 6,
        sabado: 6 // Adicionado para lidar com strings sanitizadas
    };
    return diasDaSemana[day] || null; // Retorna null se o dia não for válido
}

// Função para processar respostas de lembretes
async function tratarRespostaDeLembrete(sock, chatId, messageContent) {
    // Se o usuário digitar "sim" e há uma tarefa ativa, processar mesmo que não esteja aguardando resposta
    if (messageContent.toLowerCase() === "sim" && lembretesAtivos[chatId]) {
        console.log(`[LOG] tratarRespostaDeLembrete - "sim" detectado com tarefa ativa para chat ${chatId}`);
        // Processar a conclusão da tarefa
        const { id, message } = lembretesAtivos[chatId];
        console.log(`[LOG] tratarRespostaDeLembrete - Processando conclusão da tarefa ID ${id}: "${message}"`);
        await processTaskCompletion(sock, chatId, id, message);
        return true;
    }
    if (!lembretesAtivos[chatId]) {
        return false; // Não há lembrete ativo para este chat
    }
    const { id, message, isFirstAsk } = lembretesAtivos[chatId];
    const normalizedMessage = messageContent.toLowerCase().trim();
    console.log(`[LOG] tratarRespostaDeLembrete - Processando resposta "${normalizedMessage}" para tarefa ID ${id}`);

    if (normalizedMessage.includes("sim") || normalizedMessage === "s" || normalizedMessage === "yes" || normalizedMessage === "1") {
        console.log(`[LOG] tratarRespostaDeLembrete - Processando "sim" para tarefa ID ${id}`);
        await processTaskCompletion(sock, chatId, id, message);
        
    } else if (normalizedMessage.includes("depois") || normalizedMessage.includes("dps") || normalizedMessage.includes("later") || normalizedMessage === "2") {
        if (isFirstAsk) {
            // Reagendar para 10 minutos
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `🔄 *Entendido!*\n\nVou lembrá-lo novamente em 10 minutos sobre a tarefa:\n📝 "${message}"`
            });
            const tenMinutesLater = moment().add(10, 'minutes');
            schedule.scheduleJob(tenMinutesLater.toDate(), async () => {
                await sock.sendMessage(chatId, {
                    text: `❓ *Lembrete de Tarefa (10 min depois):*\n\nVocê já concluiu a tarefa: "${message}"?\n\nResponda com "Sim" ou "Depois".`
                });
                lembretesAtivos[chatId] = { id, message, isFirstAsk: true };
                await atualizarRotinas(id, { proximoLembrete: tenMinutesLater.format("YYYY-MM-DD HH:mm:ss") });
            });
            await atualizarRotinas(id, { proximoLembrete: tenMinutesLater.format("YYYY-MM-DD HH:mm:ss") });
        } else {
            // Reagendar para 1 hora
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `🔄 *Entendido!*\n\nVou lembrá-lo novamente em 1 hora sobre a tarefa:\n📝 "${message}"`
            });
            const oneHourLater = moment().add(1, 'hour');
            schedule.scheduleJob(oneHourLater.toDate(), async () => {
                await sock.sendMessage(chatId, {
                    text: `❓ *Lembrete de Tarefa (1h depois):*\n\nVocê já concluiu a tarefa: "${message}"?\n\nResponda com "Sim" ou "Depois".`
                });
                lembretesAtivos[chatId] = { id, message, isFirstAsk: false };
                await atualizarRotinas(id, { proximoLembrete: oneHourLater.format("YYYY-MM-DD HH:mm:ss") });
            });
            await atualizarRotinas(id, { proximoLembrete: oneHourLater.format("YYYY-MM-DD HH:mm:ss") });
        }
        lembretesAtivos[chatId] = { id, message, isFirstAsk: isFirstAsk };
    } else if (normalizedMessage.includes('não vou fazer') ||
        normalizedMessage.includes('nao vou fazer') ||
        normalizedMessage.includes('não farei') ||
        normalizedMessage.includes('nao farei') ||
        normalizedMessage.includes('desisti') ||
        normalizedMessage.includes('deixa') ||
        normalizedMessage.includes('cancelar')) {

        console.log(`[LOG] Usuário ${chatId} escolheu suspender a tarefa ID ${id}`);

        try {
            // Marcar como "não realizada" no Firebase
            await atualizarRotinas(id, {
                ultimaExecucao: new Date().toISOString(),
                status: 'nao_realizada',
                proximoLembrete: null // Remove próximo lembrete
            });

            // Remover do estado ativo
            delete lembretesAtivos[chatId];

            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: `✅ Entendi! A tarefa "${message}" foi marcada como *não realizada* e os lembretes foram suspensos.\n\n💡 Se mudar de ideia, você pode criar uma nova rotina.`
            });

            console.log(`[LOG] Tarefa ID ${id} suspensa com sucesso`);

        } catch (error) {
            console.error(`[ERRO] Falha ao suspender tarefa ID ${id}:`, error);
            await sock.sendMessage(chatId, {
                text: "❌ Houve um erro ao suspender a tarefa. Tente novamente."
            });
        }
    } else {
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `❓ *Resposta Inválida!*\n\nPor favor, responda apenas com:\n- "Sim"\n- "Depois"\n- "Não vou fazer"\n\n📝 *Tarefa:* "${message}"`
        });
    }

    return true;
}

// Função auxiliar para processar a conclusão de uma tarefa
async function processTaskCompletion(sock, chatId, id, message) {
    console.log(`[LOG] processTaskCompletion - Iniciando processamento para chat ${chatId}, tarefa ID ${id}`);
    console.log(`[LOG] processTaskCompletion - Mensagem da tarefa: "${message}"`);

    try {
        console.log(`[LOG] processTaskCompletion - Buscando rotinas no Firebase...`);
        const routines = await obterRotinas();
        console.log(`[LOG] processTaskCompletion - ${routines.length} rotinas encontradas`);

        const targetRoutine = routines.find((routine) => routine[0] === id.toString());
        if (!targetRoutine) {
            console.error(`[ERRO] processTaskCompletion - Tarefa com ID ${id} não encontrada no Firebase.`);
            await simularDigitar(sock, chatId);
            await sock.sendMessage(chatId, {
                text: "❌ *Erro:* Não foi possível localizar a tarefa no Firebase. Verifique os logs."
            });
            return;
        }

        console.log(`[LOG] processTaskCompletion - Tarefa encontrada: ${JSON.stringify(targetRoutine)}`);

        const completionDate = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD HH:mm:ss");
        console.log(`[LOG] processTaskCompletion - Data de conclusão: ${completionDate}`);

        const routineType = targetRoutine[6]; // Coluna "Tipo" (unica ou repetitiva)

        // Atualizar no Firebase
        if (routineType === "unica") {
            // Rotinas unicas: marcar como concluída e inativar
            await atualizarRotinas(id, {
                status: "Inativo",
                completed: "Sim",
                completionDate: completionDate
            });
            console.log(`[LOG] Rotina unica ID ${id} marcada como concluída e inativada.`);
        } else {
            // Rotinas repetitivas: marcar como concluída temporariamente
            // Mas agendar redefinição para permitir próximos lembretes
            await atualizarRotinas(id, {
                completed: "Sim",
                completionDate: completionDate
            });
            console.log(`[LOG] Rotina repetitiva ID ${id} marcada como concluída temporariamente.`);

            // Para tarefas repetitivas, redefinir status em 30 minutos para permitir próximos agendamentos
            const resetTime = moment().add(30, 'minutes');
            schedule.scheduleJob(resetTime.toDate(), async () => {
                try {
                    await atualizarRotinas(id, {
                        completed: "Não",
                        completionDate: "N/A"
                    });
                    console.log(`[LOG] Status da tarefa repetitiva ID ${id} redefinido automaticamente após conclusão.`);
                } catch (error) {
                    console.error(`[ERRO] Falha ao redefinir tarefa repetitiva ID ${id}:`, error);
                }
            });
        }

        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: `✅ *Tarefa Concluída!*\n\n📝 *Tarefa:* "${message}"\n\n🕒 *Horário:* ${moment().tz("America/Sao_Paulo").format("HH:mm")}\n📅 *Data:* ${moment().tz("America/Sao_Paulo").format("DD/MM/YYYY")}`
        });

        delete lembretesAtivos[chatId];
    } catch (error) {
        console.error("[ERRO] Falha ao atualizar no Firebase:", error);
        await simularDigitar(sock, chatId);
        await sock.sendMessage(chatId, {
            text: "❌ *Erro:* Não foi possível atualizar a tarefa no Firebase. Verifique os logs."
        });
    }
}

async function iniciarLembretes(sock, routines) {
    console.log("[LOG] Inicializando lembretes...");
    routines.forEach(async ([id, time, days, message, status, repetition, type, isTask, completed, completionDate, userId, proximoLembrete]) => {
        if (status === "Ativo") {
            // Para rotinas unicas concluídas, não agendar novamente
            if (type === "unica" && completed === "Sim") {
                console.log(`[LOG] Ignorando rotina unica concluída ID ${id}`);
                return;
            }

            // Para rotinas repetitivas, sempre agendar independentemente do status de conclusão
            // pois elas devem continuar nos próximos ciclos
            console.log(`[DEBUG] Agendando rotina ID ${id} com proximoLembrete: ${proximoLembrete}`);

            // Se for tarefa e proximoLembrete está no futuro, reagendar verificação
            if (isTask === "Sim" && proximoLembrete && proximoLembrete !== "N/A") {
                const now = moment.tz("America/Sao_Paulo");
                const proximo = moment.tz(proximoLembrete, "YYYY-MM-DD HH:mm:ss", "America/Sao_Paulo");
                if (proximo.isAfter(now)) {
                    lembretesAtivos[userId] = { id, message, isFirstAsk: true };
                    schedule.scheduleJob(proximo.toDate(), async () => {
                        await sock.sendMessage(userId, {
                            text: `❓ *Lembrete de Tarefa (verificação):*\n\nVocê já concluiu a tarefa: "${message}"?\n\nResponda com \`Sim\`, \`Depois\` ou \`cancelar\`.`
                        });
                        lembretesAtivos[userId] = { id, message, isFirstAsk: true };
                    });
                }
            } else {
                // Chamar scheduleRoutine para agendar a rotina
                scheduleRoutine(id, time, days, message, repetition, sock, isTask === "Sim", completed, userId, proximoLembrete, type);
            }
        }
    });
    console.log("[LOG] Lembretes inicializados com sucesso.");
}

async function initializeSingleReminder(sock) {
    console.log("[LOG] Inicializando lembrete para a última rotina salva...");

    // Obter todas as rotinas da planilha
    const routines = await obterRotinas();
    if (!routines || routines.length === 0) {
        console.error("[ERRO] Nenhuma rotina encontrada para inicializar.");
        return;
    }

    // Selecionar a última rotina salva
    const routine = routines[routines.length - 1];
    const [id, time, days, message, status, repetition, type, isTask, completed, completionDate, userId, proximoLembrete] = routine;

    if (status === "Ativo") {
        console.log(`[DEBUG] Agendando última rotina salva ID ${id} com proximoLembrete: ${proximoLembrete}`);

        // Chamar scheduleRoutine para agendar a nova rotina
        scheduleRoutine(id, time, days, message, repetition, sock, isTask === "Sim", completed, userId, proximoLembrete, type);
    }
    console.log("[LOG] Lembrete inicializado com sucesso para a última rotina salva.");
}

// Função para redefinir o status de conclusão de tarefas repetitivas
async function resetarTarefasRepetitivas() {
    try {
        const routines = await obterRotinas();

        for (const routine of routines) {
            const [id, , , , status, , type, , completed] = routine;

            // Verificar se é uma tarefa repetitiva e está marcada como concluída
            if (type === "repetitiva" && completed === "Sim") {
                await atualizarRotinas(id, {
                    completed: "Não",
                    completionDate: "N/A"
                }); // Redefinir status e limpar data de conclusão
                console.log(`[LOG] Tarefa repetitiva ID ${id} redefinida para "Não concluída".`);
            }
        }
    } catch (error) {
        console.error("[ERRO] Falha ao redefinir tarefas repetitivas:", error);
    }
}

// Remova o agendamento diário
// schedule.scheduleJob("0 0 * * *", async () => {
//     console.log("[LOG] Executando redefinição de tarefas repetitivas...");
//     await resetarTarefasRepetitivas();
// });

function pegarDataHoje() {
    return moment.tz("America/Sao_Paulo").format("YYYY-MM-DD");
}

// Função para calcular o próximo lembrete baseado na repetição
function calculateNextReminder(dataAtual, repetition, time, days) {
    const timeZone = "America/Sao_Paulo";
    const [hour, minute] = time.split(":").map(Number);

    let nextDate = moment.tz(dataAtual, timeZone).hour(hour).minute(minute).second(0).millisecond(0);

    switch (repetition) {
        case "diariamente":
            nextDate.add(1, 'day');
            break;

        case "semanalmente":
            nextDate.add(1, 'week');
            break;

        case "a cada 2 semanas":
            nextDate.add(2, 'weeks');
            break;

        case "mensalmente":
            nextDate.add(1, 'month');
            break;

        case "anualmente":
            nextDate.add(1, 'year');
            break;

        default:
            // Para rotinas com dias específicos da semana
            if (days !== "todos" && days.includes(",")) {
                const dayNames = days.split(",").map(d => d.trim().toLowerCase());
                const dayIndices = dayNames.map(d => obterDiaDaSemana(d)).filter(d => d !== null);

                // Encontrar o próximo dia da semana na lista
                const currentDayIndex = nextDate.day();
                let foundNext = false;

                for (let i = 0; i < 7 && !foundNext; i++) {
                    const targetDay = (currentDayIndex + i + 1) % 7;
                    if (dayIndices.includes(targetDay)) {
                        nextDate.day(targetDay);
                        if (i === 0 && nextDate.isBefore(moment.tz(timeZone))) {
                            // Se é hoje mas já passou o horário, vai para próxima semana
                            nextDate.add(1, 'week');
                        }
                        foundNext = true;
                    }
                }

                if (!foundNext) {
                    // Se não encontrou, vai para a próxima semana com o primeiro dia da lista
                    nextDate.day(dayIndices[0]).add(1, 'week');
                }
            } else if (days !== "todos") {
                // Dia único da semana
                const dayIndex = obterDiaDaSemana(days.trim().toLowerCase());
                if (dayIndex !== null) {
                    nextDate.add(1, 'week');
                }
            }
            break;
    }

    return nextDate.format("YYYY-MM-DD HH:mm:ss");
}

// Função para calcular o primeiro lembrete de uma nova rotina
function calculateFirstReminder(time, days, repetition, type) {
    const timeZone = "America/Sao_Paulo";
    const [hour, minute] = time.split(":").map(Number);
    const now = moment.tz(timeZone);

    if (type === "unica") {
        // Para rotinas unicas, usar a data específica
        if (moment(days, "YYYY-MM-DD", true).isValid()) {
            return moment.tz(days, "YYYY-MM-DD", timeZone).hour(hour).minute(minute).second(0).millisecond(0).format("YYYY-MM-DD HH:mm:ss");
        }
        // Se for "hoje"
        const today = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        return today.format("YYYY-MM-DD HH:mm:ss");
    }

    // Para rotinas repetitivas
    if (days === "todos") {
        // Verificar se ainda não passou o horário de hoje
        const today = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
        if (today.isAfter(now)) {
            return today.format("YYYY-MM-DD HH:mm:ss");
        } else {
            return today.add(1, 'day').format("YYYY-MM-DD HH:mm:ss");
        }
    }

    if (days.includes(",")) {
        // Múltiplos dias da semana
        const dayNames = days.split(",").map(d => d.trim().toLowerCase());
        const dayIndices = dayNames.map(d => obterDiaDaSemana(d)).filter(d => d !== null);
        const currentDayIndex = now.day();

        // Verificar se hoje é um dos dias e ainda não passou o horário
        if (dayIndices.includes(currentDayIndex)) {
            const today = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
            if (today.isAfter(now)) {
                return today.format("YYYY-MM-DD HH:mm:ss");
            }
        }

        // Encontrar o próximo dia da lista
        for (let i = 1; i <= 7; i++) {
            const targetDay = (currentDayIndex + i) % 7;
            if (dayIndices.includes(targetDay)) {
                const nextDate = now.clone().day(targetDay).hour(hour).minute(minute).second(0).millisecond(0);
                if (i > 0) {
                    return nextDate.format("YYYY-MM-DD HH:mm:ss");
                }
            }
        }
    } else {
        // Dia único da semana
        const dayIndex = obterDiaDaSemana(days.trim().toLowerCase());
        if (dayIndex !== null) {
            const currentDayIndex = now.day();
            let nextDate = now.clone().day(dayIndex).hour(hour).minute(minute).second(0).millisecond(0);

            // Se é hoje mas já passou o horário, ou se já passou este dia da semana
            if (dayIndex < currentDayIndex || (dayIndex === currentDayIndex && nextDate.isBefore(now))) {
                nextDate.add(1, "week");
            }

            return nextDate.format("YYYY-MM-DD HH:mm:ss");
        }
    }

    // Fallback: amanhã no mesmo horário
    return now.clone().add(1, 'day').hour(hour).minute(minute).second(0).millisecond(0).format("YYYY-MM-DD HH:mm:ss");
}

/**
 * Analisa uma mensagem de rotina usando Groq LLM e retorna os campos estruturados.
 * Se mencionar um dia numeral (ex: "dia 7 tenho que...") e não for recorrente, agendar para o próximo mês se o dia já passou.
 * Sempre retorna os campos: dayOrDate, time, message, type, repetition (quando aplicável).
 * @param {string} texto
 * @returns {Promise<{dayOrDate: string, time: string, message: string, type: string, repetition?: string}|null>} Retorna os campos ou null se falhar
 */
async function analisarRotinaViaGroq(texto) {
    try {
        const saoPauloNow = moment.tz("America/Sao_Paulo");
        const dataAtual = saoPauloNow.format("YYYY-MM-DD");
        const horaAtual = saoPauloNow.format("HH:mm");
        const diaAtual = saoPauloNow.date();
        const mesAtual = saoPauloNow.month() + 1;
        const anoAtual = saoPauloNow.year();
        // Função auxiliar para calcular próxima data para qualquer dia numeral
        function proximaDataNumeral(dia) {
            let diaNum = parseInt(dia, 10);
            if (isNaN(diaNum) || diaNum < 1 || diaNum > 31) return null;
            let data = moment.tz(`${anoAtual}-${mesAtual.toString().padStart(2, '0')}-${diaNum.toString().padStart(2, '0')}`, "YYYY-MM-DD", "America/Sao_Paulo");
            if (data.isBefore(saoPauloNow, 'day')) {
                data = data.add(1, 'month');
            }
            return data.format("YYYY-MM-DD");
        }
        const prompt = [
            `Horário atual em São Paulo: ${dataAtual} ${horaAtual}`,
            "Sua tarefa é extrair os campos estruturados da mensagem abaixo e convertê-la em um lembrete ou rotina.",
            "Sempre responda SOMENTE em JSON válido, sem explicações, comentários ou texto adicional.",
            "",
            "🧠 Objetivo:",
            "- Interpretar mensagens em linguagem natural para estruturar lembretes e rotinas com base no conteúdo textual.",
            "📅 Regras para interpretação de datas:",
            "- Use o horário atual informado no topo para base de cálculo.",
            "- Quando o usuário mencionar apenas um dia numeral (ex: 'dia 10'), e o dia atual for maior que esse número, agende para o mês seguinte.",
            "- Quando houver datas no formato DD/MM ou DD/MM/YYYY, normalize para 'YYYY-MM-DD'.",
            "- Para dias da semana como 'terça-feira' 'terça' 'quarta-feira' 'próxima quarta' 'nessa quinta' 'essa quinta-feira', calcule a próxima ocorrência (nunca datas passadas).",
            "- Palavras como 'amanhã', 'depois de amanhã', 'semana que vem' devem ser convertidas para a data correta baseada em 'dataAtual'.",
            "",
            "⏰ Regras para interpretação de tempo:",
            "- Horários devem sempre ser convertidos para o formato 24h (ex: '8 da noite' -> '20:00').",
            "- Interpretações relativas como 'em 2 horas', 'daqui a 30 minutos' devem ser calculadas com base em horaAtual.",
            "- Se a mensagem não tiver horário explícito nem relativo, defina: \"time\": \"\"",
            "",
            "🔁 Regras para mensagens recorrentes:",
            "- Termos como 'todo', 'toda', 'sempre', 'diariamente', 'semanalmente', 'mensalmente' indicam repetição.",
            "- Use: type: 'repetitiva' e o campo repetition com: 'diariamente', 'semanalmente', 'mensalmente', etc.",
            "- Exemplo: 'todo sábado', repetition: 'semanalmente', dayOrDate: 'sábado'",
            "- Repetições numéricas: 'todo dia 10' -> dayOrDate: '10', repetition: 'mensalmente' type: 'repetitiva'",
            "",
            "🧼 Regras para o campo 'message':",
            "- Remova termos desnecessários como: 'me lembra de', 'tenho que', 'preciso', 'vou', 'lembrar de', 'agendar', 'programar'.",
            "- Mantenha a descrição limpa, direta e concisa.",
            "",
            "✅ Quando usar o campo 'isTask':",
            "- Use \"isTask\": true para compromissos relevantes (reuniões, consultas, tomar remédio, pagar contas, tarefas com ação).",
            "- Evite usar para eventos informais (ex: 'ver filme', 'ir ao parque').",
            "",
            "⚠️ Importante:",
            "- Sempre retorne campos com aspas duplas. Use estrutura JSON válida.",
            "- Caso algum dado esteja ausente (ex: sem horário), ainda assim responda com os demais campos e time como \"\".",
            "- O campo 'Message' jamais pode ter informações que não estejam na mensagem original, se atente a isso, revise duas vezes o contexto da mensagem para garantir que a mensagem será devidamente retirada da frase, mesmo com os exemplos abaixo.",
            "",
            "📚 Exemplos de entrada e saída:",
            "",
            "Mensagem: 'dia 7 tenho que levar o carro no mecânico' (e hoje é dia 8 do mes)",
            "Resposta:",
            "{",
            `  "dayOrDate": "${proximaDataNumeral(7)}",`,
            '  "message": "levar o carro no mecânico",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "",
            "Mensagem: 'amanhã às 14:30 reunião com equipe'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(1, 'day').format('YYYY-MM-DD')}",`,
            '  "time": "14:30",',
            '  "message": "reunião com equipe",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "",
            "Mensagem: 'todo dia 10 pagar o aluguel'",
            "Resposta:",
            "{",
            '  "dayOrDate": "10",',
            '  "message": "pagar o aluguel",',
            '  "type": "repetitiva",',
            '  "repetition": "mensalmente",',
            '  "isTask": true',
            "}",
            "",
            "Mensagem: 'daqui a 45 minutos ligar para o cliente'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(45, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(45, 'minutes').format('HH:mm')}",`,
            '  "message": "ligar para o cliente",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "",
            "Mensagem: 'daqui a 20 minutos eu vou tomar café'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(20, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(20, 'minutes').format('HH:mm')}",`,
            '  "message": "tomar café",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "",
            "Mensagem: 'daqui a 45 minutos ligar para o cliente'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(45, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(45, 'minutes').format('HH:mm')}",`,
            '  "message": "ligar para o cliente",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "Mensagem: 'daqui 5 minutos enviar e-mail para o cliente'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(5, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(5, 'minutes').format('HH:mm')}",`,
            '  "message": "ligar para o cliente",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'me lembra de tomar remédio em 15 minutos'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(15, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(15, 'minutes').format('HH:mm')}",`,
            '  "message": "tomar remédio",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'em 2 horas revisar o relatório'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(2, 'hours').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(2, 'hours').format('HH:mm')}",`,
            '  "message": "revisar o relatório",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'em 5 horas sair para o aeroporto'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(5, 'hours').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(5, 'hours').format('HH:mm')}",`,
            '  "message": "sair para o aeroporto",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'daqui 2 dias reunião com a equipe'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(2, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "",',
            '  "message": "reunião com a equipe",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'daqui a 3 dias ir ao cinema'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(3, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "",',
            '  "message": "ir ao cinema",',
            '  "type": "unica"',
            "}",
            "Mensagem: 'revisar o TCC daqui a 2 dias'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(2, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "",',
            '  "message": "revisar o TCC",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "Mensagem: 'Amanhã às 10h pegar os exames'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(1, 'day').format('YYYY-MM-DD')}",`,
            '  "time": "10:00",',
            '  "message": "pegar os exames",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'Todo sábado às 18h ir à academia'",
            "Resposta:",
            "{",
            '  "dayOrDate": "sábado",',
            '  "time": "18:00",',
            '  "message": "ir à academia",',
            '  "type": "repetitiva",',
            '  "repetition": "semanalmente"',
            "}",

            "Mensagem: 'Me lembra de pagar o aluguel dia 10'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${proximaDataNumeral(10)}",`,
            '  "time": "",',
            '  "message": "pagar o aluguel",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",

            "Mensagem: 'Daqui a 30 minutos ligar para o João'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(30, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(30, 'minutes').format('HH:mm')}",`,
            '  "message": "ligar para o João",',
            '  "type": "unica",',
            "}",

            "Mensagem: 'Consulta médica em 2 dias às 9h'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(2, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "09:00",',
            '  "message": "consulta médica",',
            '  "type": "unica",',
            '  "isTask": true',
            "}",
            "Mensagem: 'daqui uma semana entregar o projeto final'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(1, 'week').format('YYYY-MM-DD')}",`,
            '  "time": "",',
            '  "message": "entregar o projeto final",',
            '  "type": "unica",',
            '  "isTask": true',
            '  "isRelativeTime": true',
            "}",
            "Mensagem: 'em meia hora devo escovar os dentes'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(30, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(30, 'minutes').format('HH:mm')}",`,
            '  "message": "escovar os dentes",',
            '  "type": "unica"',
            '  "isRelativeTime": true',
            "}",
            "Mensagem: 'em 40 minutos devo sair'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(40, 'minutes').format('YYYY-MM-DD')}",`,
            `  "time": "${saoPauloNow.clone().add(40, 'minutes').format('HH:mm')}",`,
            '  "message": "sair",',
            '  "type": "unica"',
            '  "isRelativeTime": true',
            "}",
            "Mensagem: 'daqui duas semanas consulta com dentista às 09:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(2, 'weeks').format('YYYY-MM-DD')}",`,
            '  "time": "09:00",',
            '  "message": "consulta com dentista",',
            '  "type": "unica",',
            '  "isTask": true',
            '  "isRelativeTime": true',
            "}",
            `Mensagem: "${texto}"`
        ].join('\n');


        const resposta = await sendGroqChat(prompt, {
            systemMessage: 'Você é um extrator de campos para criação de rotinas/lembretes. Responda apenas em JSON com os campos dayOrDate, time, message, type, repetition, isRelativeTime.'
        });


        if (!resposta) return null;
        // Tentar extrair JSON da resposta
        const jsonMatch = resposta.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;


        const data = JSON.parse(jsonMatch[0]);
        console.log(`[GROQ][rotina] analisarRotinaViaGroq detectou: ${JSON.stringify(data)}`);

        // Se Groq indicar que é horário relativo, validar o cálculo
        if (data.isRelativeTime === true && data.time) {
            // Tenta extrair o valor relativo do texto
            const matchMin = texto.match(/(\d+)\s*minuto|minutos/i);
            const matchHour = texto.match(/(\d+)\s*hora|horas/i);
            let esperado;
            if (matchMin) {
                const min = parseInt(matchMin[1], 10);
                esperado = saoPauloNow.clone().add(min, 'minutes');
            } else if (matchHour) {
                const hr = parseInt(matchHour[1], 10);
                esperado = saoPauloNow.clone().add(hr, 'hours');
            }
            if (esperado) {
                // Verifica se o time retornado bate com o esperado
                const timeRetornado = moment.tz(`${data.dayOrDate} ${data.time}`, "YYYY-MM-DD HH:mm", "America/Sao_Paulo");
                const diff = Math.abs(esperado.diff(timeRetornado, 'minutes'));
                if (diff > 2) { // tolerância de 2 minutos
                    // Recalcula
                    data.dayOrDate = esperado.format('YYYY-MM-DD');
                    data.time = esperado.format('HH:mm');
                    console.log('[GROQ][rotina] Horário relativo ajustado:', data.dayOrDate, data.time);
                }
            }
        }

        return {
            dayOrDate: data.dayOrDate?.toString().trim() || '',
            time: data.time?.toString().trim() || '',
            message: data.message?.toString().trim() || '',
            type: data.type?.toString().trim() || 'unica',
            repetition: data.repetition?.toString().trim() || undefined,
            isTask: typeof data.isTask === 'boolean' ? data.isTask : undefined
        };
    } catch (e) {
        console.warn(`[GROQ][rotina] Falha ao analisar rotina: ${e.message}`);
        return null;
    }
}

module.exports = {
    validarFormatoHora,
    formatRoutineResponse,
    obterRotinas: obterRotinasFromFirebase,
    scheduleRoutine,
    obterDiaDaSemana,
    iniciarLembretes,
    tratarRespostaDeLembrete,
    lembretesAtivos,
    resetarTarefasRepetitivas,
    initializeSingleReminder,
    pegarDataHoje,
    calculateNextReminder,
    calculateFirstReminder,
    processTaskCompletion,
    analisarRotinaViaGroq,
};