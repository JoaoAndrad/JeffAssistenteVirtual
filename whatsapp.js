const { DisconnectReason, default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { processarComando } = require("./commands/base");
const { iniciarLembretes, obterRotinas, resetarTarefasRepetitivas } = require("./commands/rotinas/utilitariosRotina");
const schedule = require("node-schedule");
const moment = require("moment-timezone");

async function startBot() {
    console.log("🔧 Inicializando socket WhatsApp...");
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const sock = makeWASocket({ auth: state });

    sock.ev.on("creds.update", saveCreds);

    return new Promise((resolve, reject) => {
        console.log("🎯 Promise criada, aguardando eventos...");
        
        // Timeout de 30 segundos para evitar travamento
        const timeout = setTimeout(() => {
            console.log("⏰ Timeout atingido - forçando resolução da Promise");
            resolve(sock);
        }, 30000);
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log("🔍 Sem conexão ativa com um dispositivo usando WhatsApp");
                console.log("📲 Escaneie o QR Code abaixo para conectar:");
                qrcode.generate(qr, { small: true });
            }
            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log("Conexão encerrada. Motivo:", reason);
                if (reason !== DisconnectReason.loggedOut) {
                    console.log("🔄 Tentando reconectar...");
                    startBot();
                } else {
                    console.log("❌ Sessão expirada. Escaneie o QR Code novamente.");
                    reject(new Error("Sessão expirada"));
                }
            } else if (connection === "open") {
                console.log("✅ Bot conectado com sucesso!");

                // Inicializar todas as rotinas ativas do Firebase
                try {
                    console.log("[LOG] Inicializando rotinas já cadastradas...");
                    const routines = await obterRotinas();
                    await iniciarLembretes(sock, routines);
                    console.log("[LOG] ✅ Todas as rotinas ativas foram inicializadas com sucesso!");
                } catch (error) {
                    console.error("[ERRO] ❌ Falha ao inicializar rotinas:", error);
                }

                // Agendar redefinição diária à meia-noite no fuso horário America/Sao_Paulo
                async function agendarRedefinicaoTarefas() {
                    const now = moment.tz("America/Sao_Paulo");
                    let nextMidnight = now.clone().add(1, 'day').startOf('day');
                    const msAteMeiaNoite = nextMidnight.diff(now);
                    setTimeout(async () => {
                        const currentTime = moment.tz("America/Sao_Paulo").format("YYYY-MM-DD HH:mm:ss");
                        console.log(`[LOG] resetarTarefasRepetitivas de tarefas repetitivas às ${currentTime}...`);
                        try {
                            await resetarTarefasRepetitivas();
                            console.log("[LOG] ✅ Redefinição de tarefas repetitivas concluída com sucesso!");
                        } catch (error) {
                            console.error("[ERRO] ❌ Falha na redefinição de tarefas repetitivas:", error);
                        }
                        agendarRedefinicaoTarefas(); // Reagendar para o próximo dia
                    }, msAteMeiaNoite);
                }
                agendarRedefinicaoTarefas();
                
                // Resolver a Promise com o socket conectado
                console.log("🎯 WhatsApp totalmente inicializado, retornando socket...");
                clearTimeout(timeout);
                resolve(sock);
            }
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || !msg.key.remoteJid || msg.key.fromMe) return;

            // Delegar o processamento da mensagem ao arquivo commands/base.js
            const authorizedNumbers = process.env.AUTHORIZED_NUMBERS.split(","); // Dividir os números autorizados em uma lista
            await processarComando(sock, msg, process.env.TIMEZONE, authorizedNumbers);
        });
    });
}


module.exports = { startBot };