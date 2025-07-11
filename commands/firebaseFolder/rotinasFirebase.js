const db = require("./firebase");
const moment = require("moment-timezone");

// Função para criar uma nova rotina no Firebase
async function criarRotina(routineData) {
    try {
        const {
            id,
            time,
            days,
            message,
            status = "Ativo",
            repetition = "N/A",
            type,
            isTask = "Não",
            completed = "Não",
            completionDate = "N/A",
            userId = null,
            timezone = "America/Sao_Paulo"
        } = routineData;

        const routineDoc = {
            id: id.toString(),
            time,
            days,
            message,
            status,
            repetition,
            type,
            isTask,
            completed,
            completionDate,
            userId, // ID do usuário que criou a rotina
            timezone, // Fuso horário para o agendamento
            // Campos inteligentes opcionais
            proximoLembrete: routineData.proximoLembrete || null,
            ultimaNotificacao: routineData.ultimaNotificacao || null,
            proximaNotificacao: routineData.proximaNotificacao || null,
            ultimaRealizacao: routineData.ultimaRealizacao || null,
            proximaRealizacao: routineData.proximaRealizacao || null,
            version: "1.0", // Versão da estrutura de dados
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Criar documento na coleção "rotinas" com ID personalizado
        await db.collection("rotinas").doc(id.toString()).set(routineDoc);

        console.log(`[LOG] Rotina criada no Firebase com sucesso! ID: ${id}`);
        return { success: true, id };
    } catch (error) {
        console.error("❌ Erro ao criar rotina no Firebase:", error);
        throw error;
    }
}

// Função para obter todas as rotinas do Firebase
async function obterRotinas() {
    try {
        const snapshot = await db.collection("rotinas").orderBy("id").get();

        if (snapshot.empty) {
            console.log("[LOG] Nenhuma rotina encontrada no Firebase");
            return [];
        }

        const routines = [];
        const routinesToDelete = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Verificar se deve ser removida
            const isUnicaInativa = data.type === "unica" && (data.status === "Inativo" || data.status === "nao_realizada");
            const isTarefaNaoRepetitivaSuspensa = data.type !== "repetitiva" && data.status === "nao_realizada";
            if (isUnicaInativa || isTarefaNaoRepetitivaSuspensa) {
                routinesToDelete.push(data.id);
                return; // Não adiciona à lista
            }
            // Converter para formato de array compatível com o código existente
            routines.push([
                data.id,
                data.time,
                data.days,
                data.message,
                data.status,
                data.repetition,
                data.type,
                data.isTask,
                data.completed,
                data.completionDate,
                data.userId || null, // Adicionar userId para notificações
                data.proximoLembrete || null, // Campo para próximo lembrete
                data.ultimaNotificacao || null,
                data.proximaNotificacao || null,
                data.ultimaRealizacao || null,
                data.proximaRealizacao || null
            ]);
        });

        // Deletar rotinas inválidas
        for (const id of routinesToDelete) {
            db.collection("rotinas").doc(id.toString()).delete().then(() => {
                console.log(`[LOG] Rotina ${id} deletada automaticamente por estar inativa/não realizada.`);
            }).catch(() => {});
        }

        console.log(`[LOG] ${routines.length} rotinas recuperadas do Firebase (após limpeza)`);
        return routines;
    } catch (error) {
        console.error("❌ Erro ao obter rotinas do Firebase:", error);
        throw error;
    }
}

// Função para obter uma rotina específica por ID
async function getRoutineById(routineId) {
    try {
        const doc = await db.collection("rotinas").doc(routineId.toString()).get();

        if (!doc.exists) {
            console.log(`[LOG] Rotina com ID ${routineId} não encontrada`);
            return null;
        }

        return doc.data();
    } catch (error) {
        console.error(`❌ Erro ao obter rotina ${routineId} do Firebase:`, error);
        throw error;
    }
}

// Função para atualizar uma rotina existente
async function atualizarRotinas(routineId, updateData) {
    try {
        const routineRef = db.collection("rotinas").doc(routineId.toString());

        // Verificar se a rotina existe
        const doc = await routineRef.get();
        if (!doc.exists) {
            throw new Error(`Rotina com ID ${routineId} não encontrada`);
        }

        // Adicionar timestamp de atualização
        const dataToUpdate = {
            ...updateData,
            updatedAt: new Date().toISOString()
        };

        await routineRef.update(dataToUpdate);
        console.log(`[LOG] Rotina ${routineId} atualizada no Firebase com sucesso`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Erro ao atualizar rotina ${routineId} no Firebase:`, error);
        throw error;
    }
}

// Função para marcar uma rotina como concluída
async function completeRoutine(routineId) {
    try {
        const completionDate = moment().tz("America/Sao_Paulo").format("YYYY-MM-DD HH:mm:ss");

        await atualizarRotinas(routineId, {
            completed: "Sim",
            completionDate: completionDate
        });

        console.log(`[LOG] Rotina ${routineId} marcada como concluída`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Erro ao marcar rotina ${routineId} como concluída:`, error);
        throw error;
    }
}

// Função para inativar uma rotina
async function deactivateRoutine(routineId) {
    try {
        await atualizarRotinas(routineId, {
            status: "Inativo"
        });

        console.log(`[LOG] Rotina ${routineId} inativada`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Erro ao inativar rotina ${routineId}:`, error);
        throw error;
    }
}

// Função para deletar uma rotina
async function deleteRoutine(routineId) {
    try {
        await db.collection("rotinas").doc(routineId.toString()).delete();
        console.log(`[LOG] Rotina ${routineId} deletada do Firebase`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Erro ao deletar rotina ${routineId} do Firebase:`, error);
        throw error;
    }
}

// Função para obter o próximo ID disponível
async function getNextRoutineId() {
    try {
        const routines = await obterRotinas();

        if (routines.length === 0) {
            return 1;
        }

        // Encontrar o maior ID e adicionar 1
        const maxId = Math.max(...routines.map(routine => parseInt(routine[0])));
        return maxId + 1;
    } catch (error) {
        console.error("❌ Erro ao obter próximo ID de rotina:", error);
        throw error;
    }
}

// Função para obter rotinas ativas
async function getActiveRoutines() {
    try {
        const snapshot = await db.collection("rotinas")
            .where("status", "==", "Ativo")
            .orderBy("id")
            .get();

        const routines = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            routines.push([
                data.id,
                data.time,
                data.days,
                data.message,
                data.status,
                data.repetition,
                data.type,
                data.isTask,
                data.completed,
                data.completionDate
            ]);
        });

        return routines;
    } catch (error) {
        console.error("❌ Erro ao obter rotinas ativas do Firebase:", error);
        throw error;
    }
}

module.exports = {
    criarRotina,
    obterRotinas,
    getRoutineById,
    atualizarRotinas,
    completeRoutine,
    deactivateRoutine,
    deleteRoutine,
    getNextRoutineId,
    getActiveRoutines
};
