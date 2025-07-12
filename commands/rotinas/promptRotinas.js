const moment = require("moment-timezone");
const { sendGroqChat } = require("../../routes/groq");

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
            "Sua tarefa é extrair os campos estruturados da mensagem abaixo e convertê-la em um lembrete, rotina ou alarme.",
            "Sempre responda SOMENTE em JSON válido, sem explicações, comentários ou texto adicional.",
            "",
            "🧠 Objetivo:",
            "- Interpretar mensagens em linguagem natural para estruturar lembretes, rotinas e alarmes com base no conteúdo textual.",
            "📅 Regras para interpretação de datas:",
            "Se não houver data explícita, use o dia atual.",
            "- Use o horário atual informado no topo para base de cálculo.",
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
            "🔔 Detecção de Alarmes:",
            "- Se a mensagem mencionar termos como 'alarme', 'acordar', 'despertar', 'despertador', 'tocar alarme', 'me acorde', 'me acorda', 'me desperte', classifique como um alarme.",
            "- Para alarmes, inclua o campo 'categoria': 'alarme' no JSON.",
            "- Alarmes podem ser únicos ou recorrentes, conforme o texto.",
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
            "Regras para alarmes:",
            "- Se o horário informado já passou no dia atual, agende para o próximo dia.",
            "- Se tiver a palavra 'alarme', 'acordar', 'despertar', 'despertador', 'tocar alarme', 'me acorde', 'me acorda', 'me desperte', 'criar alarme' e etc classifique como um alarme.",
            "- Se for algo repetitivo (ex: \"todo dia\", \"todos os dias\"), defina:",
            "  - \"type\": \"repetitiva\"",
            "  - \"dayOrDate\": \"todos\"",
            "  - \"repetition\" como \"diariamente\"",
            "- Se for algo específico (ex: \"dia 15\", \"daqui 3 dias\"), defina:",
            "  - \"type\": \"unica\"",
            "  - \"dayOrDate\" com a data no formato \"YYYY-MM-DD\"",
            "- Se for uma tarefa (ex: lembrar de fazer algo), adicione \"isTask\": true",
            "- Categorize sempre como \"categoria\": \"alarme\"",
            "Mensagem: 'criar alarme para tocar todo dia às 7:00 da manhã'",
            "Resposta:",
            "{",
            "  \"dayOrDate\": \"todos\",",
            "  \"time\": \"07:00\",",
            "  \"message\": \"tocar alarme\",",
            "  \"type\": \"repetitiva\",",
            "  \"repetition\": \"diariamente\",",
            "  \"isTask\": false,",
            "  \"categoria\": \"alarme\"",
            "}",
            "Mensagem: 'Criar alarme para 08:00' (agora são 06:00)",
            "Resposta:",
            "{",
            `  "dayOrDate": "${dataAtual}",`,
            "  \"time\": \"08:00\",",
            "  \"message\": \"alarme\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": false,",
            "  \"categoria\": \"alarme\"",
            "}",
            "Mensagem : 'Criar alarme para terça feira às 19:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(3, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "09:00",',
            '  "message": "alarme",',
            '  "type": "unica",',
            '  "isTask": false,',
            '  "categoria": "alarme"',
            "}",
            "Mensagem: 'Criar alarme para 14:00' (agora são 19:00 de acordo com \"" + horaAtual + "\")",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(1, 'day').format('YYYY-MM-DD')}",`,
            "  \"time\": \"14:00\",",
            "  \"message\": \"alarme\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": false,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'Faz um alarme para daqui 3 dias às 09:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(3, 'days').format('YYYY-MM-DD')}",`,
            "  \"time\": \"09:00\",",
            "  \"message\": \"alarme\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": false,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'me lembre de comprar pão amanhã às 08:00 da manhã'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(1, 'day').format('YYYY-MM-DD')}",`,
            "  \"time\": \"08:00\",",
            "  \"message\": \"comprar pão\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": true,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'alarme para fazer o almoço às 10:00 da manhã'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${dataAtual}",`,
            "  \"time\": \"10:00\",",
            "  \"message\": \"fazer o almoço\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": false,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'crie um alarme para tomar água às 15:00 todos os dias'",
            "Resposta:",
            "{",
            "  \"dayOrDate\": \"todos\",",
            "  \"time\": \"15:00\",",
            "  \"message\": \"tomar água\",",
            "  \"type\": \"repetitiva\",",
            "  \"repetition\": \"diariamente\",",
            "  \"isTask\": true,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'preciso de um alarme para dia 15 para lembrar de mandar curriculo às 16:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().date(15).format('YYYY-MM-DD')}",`,
            "  \"time\": \"16:00\",",
            "  \"message\": \"mandar curriculo\",",
            "  \"type\": \"unica\",",
            "  \"isTask\": true,",
            "  \"categoria\": \"alarme\"",
            "}",

            "Mensagem: 'criar alarme para tocar todo dia às 7:00 da manhã'",
            "Resposta:",
            "{",
            `  "dayOrDate": "todos",`,
            '  "time": "07:00",',
            '  "message": "tocar alarme",',
            '  "type": "repetitiva",',
            '  "repetition": "diariamente",',
            '  "isTask": false,',
            '  "categoria": "alarme"',
            "}",
            "Mensagem: 'Criar alarme para 08:00' (e ainda são 06:00 em são paulo de acordo com \"" + horaAtual + "\")",
            "Resposta:",
            "{",
            `  "dayOrDate": "${dataAtual}",`,
            '  "time": "08:00",',
            '  "message": "alarme",',
            '  "type": "unica",',
            '  "isTask": false,',
            '  "categoria": "alarme"',
            "}",
            "Mensagem: 'Faz um alarme para daqui 3 dias às 09:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().add(3, 'days').format('YYYY-MM-DD')}",`,
            '  "time": "09:00",',
            '  "message": "alarme",',
            '  "type": "unica",',
            '  "isTask": false,',
            '  "categoria": "alarme"',
            "}",
            "Mensagem: 'me lembre de comprar pão amanhã às 08:00 da manhã'",
            "Mensagem: 'alarme para fazer o almoço às 10:00 da manhã'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${dataAtual}",`,
            '  "time": "10:00",',
            '  "message": "fazer o almoço",',
            '  "type": "unica",',
            '  "categoria": "alarme"',
            "}",
            "Mensagem: 'crie um alarme para tomar água às 15:00 todos os dias'",
            "Resposta:",
            "{",
            `  "dayOrDate": "todos",`,
            '  "time": "15:00",',
            '  "message": "tomar água",',
            '  "type": "repetitiva",',
            '  "repetition": "diariamente",',
            '  "isTask": true,',
            '  "categoria": "alarme"',
            "}",
            "",
            "Mensagem: 'preciso de um alarme para dia 15 para lembrar de mandar curriculo às 16:00'",
            "Resposta:",
            "{",
            `  "dayOrDate": "${saoPauloNow.clone().date(15).format('YYYY-MM-DD')}",`,
            '  "time": "16:00",',
            '  "message": "mandar curriculo",',
            '  "type": "unica",',
            '  "isTask": true,',
            '  "categoria": "alarme"',
            "}",
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
            "Mensagem: 'me lembra daqui a 20 minutos eu vou tomar café'",
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

            "Mensagem: 'me lembra que em 2 horas tenho que revisar o relatório'",
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

        // Ajuste para alarmes: se o horário já passou hoje, agendar para o próximo dia
        let dayOrDate = data.dayOrDate?.toString().trim() || '';
        let time = data.time?.toString().trim() || '';
        // Se dayOrDate vier com hora, extrair só a data
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dayOrDate)) {
            dayOrDate = dayOrDate.split(' ')[0];
        }
        // Se dayOrDate for apenas um número (ex: '10', '14') ou data tipo '10/07', '10-07', '2025-07-10' e já passou, agenda para o próximo mês
        const hoje = saoPauloNow;
        // Numérico puro
        if (/^\d{1,2}$/.test(dayOrDate)) {
            const diaNum = parseInt(dayOrDate, 10);
            if (!isNaN(diaNum)) {
                // Monta data para este mês
                let dataTest = moment.tz(`${hoje.year()}-${(hoje.month()+1).toString().padStart(2, '0')}-${diaNum.toString().padStart(2, '0')}`, "YYYY-MM-DD", "America/Sao_Paulo");
                if (dataTest.isBefore(hoje, 'day')) {
                    // Agenda para o próximo mês
                    const proximoMes = hoje.clone().add(1, 'month');
                    dayOrDate = proximoMes.year() + '-' + (proximoMes.month()+1).toString().padStart(2, '0') + '-' + diaNum.toString().padStart(2, '0');
                    console.log('[GROQ][rotina] Ajuste: dayOrDate numérico já passou, agendando para o próximo mês:', dayOrDate);
                } else {
                    dayOrDate = dataTest.format('YYYY-MM-DD');
                }
            }
        }
        // Formatos tipo '10/07', '10-07', '2025-07-10'
        else if (/^(\d{1,2})[\/\-](\d{1,2})$/.test(dayOrDate)) {
            // Ex: '10/07' ou '10-07'
            const match = dayOrDate.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
            if (match) {
                const diaNum = parseInt(match[1], 10);
                const mesNum = parseInt(match[2], 10);
                let dataTest = moment.tz(`${hoje.year()}-${mesNum.toString().padStart(2, '0')}-${diaNum.toString().padStart(2, '0')}`, "YYYY-MM-DD", "America/Sao_Paulo");
                if (dataTest.isBefore(hoje, 'day')) {
                    // Agenda para o próximo mês
                    let proximoMes = dataTest.clone().add(1, 'month');
                    dayOrDate = proximoMes.format('YYYY-MM-DD');
                    console.log('[GROQ][rotina] Ajuste: dayOrDate tipo DD/MM ou DD-MM já passou, agendando para o próximo mês:', dayOrDate);
                } else {
                    dayOrDate = dataTest.format('YYYY-MM-DD');
                }
            }
        }
        else if (/^\d{4}-\d{2}-\d{2}$/.test(dayOrDate)) {
            // Ex: '2025-07-10'
            let dataTest = moment.tz(dayOrDate, "YYYY-MM-DD", "America/Sao_Paulo");
            if (dataTest.isBefore(hoje, 'day')) {
                // Agenda para o próximo mês
                let proximoMes = dataTest.clone().add(1, 'month');
                dayOrDate = proximoMes.format('YYYY-MM-DD');
                console.log('[GROQ][rotina] Ajuste: dayOrDate tipo YYYY-MM-DD já passou, agendando para o próximo mês:', dayOrDate);
            }
        }
        if (data.categoria?.toString().trim() === 'alarme' && dayOrDate && time) {
            const now = saoPauloNow;
            const dataAlarme = moment.tz(`${dayOrDate} ${time}`, "YYYY-MM-DD HH:mm", "America/Sao_Paulo");
            if (dataAlarme.isBefore(now)) {
                // Se o horário já passou hoje, agendar para o próximo dia
                dayOrDate = now.clone().add(1, 'day').format('YYYY-MM-DD');
                console.log('[GROQ][rotina] Ajuste: horário de alarme já passou, agendando para o próximo dia:', dayOrDate, time);
            }
        }
        return {
            dayOrDate,
            time,
            message: data.message?.toString().trim() || '',
            type: data.type?.toString().trim() || 'unica',
            repetition: data.repetition?.toString().trim() || undefined,
            isTask: typeof data.isTask === 'boolean' ? data.isTask : undefined,
            categoria: data.categoria?.toString().trim() || 'lembrete'
        };
    } catch (e) {
        console.warn(`[GROQ][rotina] Falha ao analisar rotina: ${e.message}`);
        return null;
    }
}

module.exports = { analisarRotinaViaGroq };
