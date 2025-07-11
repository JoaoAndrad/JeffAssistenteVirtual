const {
    criarRotina,
    obterRotinas,
    getNextRoutineId,
    atualizarRotinas,
    deleteRoutine
} = require("./routinesFirebase");

async function testFirebaseRoutines() {
    console.log("🔥 Testando operações de rotinas no Firebase...\n");

    try {
        // 1. Obter próximo ID
        console.log("1. Obtendo próximo ID...");
        const nextId = await getNextRoutineId();
        console.log(`   Próximo ID: ${nextId}\n`);

        // 2. Criar uma rotina de teste
        console.log("2. Criando rotina de teste...");
        const routineData = {
            id: nextId,
            time: "14:30",
            days: "segunda, quarta, sexta",
            message: "Reunião de equipe",
            status: "Ativo",
            repetition: "semanalmente",
            type: "repetitiva",
            isTask: "Sim",
            completed: "Não",
            completionDate: "N/A"
        };

        const result = await criarRotina(routineData);
        console.log(`   Rotina criada com sucesso! ID: ${result.id}\n`);

        // 3. Listar todas as rotinas
        console.log("3. Listando todas as rotinas...");
        const routines = await obterRotinas();
        console.log(`   Total de rotinas: ${routines.length}`);
        routines.forEach(routine => {
            console.log(`   - ID: ${routine[0]}, Hora: ${routine[1]}, Dias: ${routine[2]}, Mensagem: ${routine[3]}`);
        });
        console.log("");

        // 4. Atualizar a rotina
        console.log("4. Atualizando rotina...");
        await atualizarRotinas(nextId, {
            message: "Reunião de equipe - ATUALIZADA",
            time: "15:00"
        });
        console.log("   Rotina atualizada com sucesso!\n");

        // 5. Verificar a atualização
        console.log("5. Verificando a atualização...");
        const updatedRoutines = await obterRotinas();
        const updatedRoutine = updatedRoutines.find(r => r[0] === nextId.toString());
        console.log(`   Rotina atualizada: ${JSON.stringify(updatedRoutine)}\n`);

        // 6. Deletar a rotina de teste
        console.log("6. Deletando rotina de teste...");
        await deleteRoutine(nextId);
        console.log("   Rotina deletada com sucesso!\n");

        // 7. Verificar a deleção
        console.log("7. Verificando a deleção...");
        const finalRoutines = await obterRotinas();
        const deletedRoutine = finalRoutines.find(r => r[0] === nextId.toString());
        if (!deletedRoutine) {
            console.log("   ✅ Rotina deletada com sucesso!\n");
        } else {
            console.log("   ❌ Erro: Rotina ainda existe!\n");
        }

        console.log("🎉 Todos os testes passaram com sucesso!");

    } catch (error) {
        console.error("❌ Erro durante os testes:", error);
    }
}

// Executar os testes
testFirebaseRoutines();
