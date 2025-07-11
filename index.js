require("dotenv").config();
const express = require('express');
const { startBot } = require('./whatsapp');
const { configurarEndpointNotificacao } = require('./routes/integracaoDeNotificacao');
const db = require('./commands/firebaseFolder/firebase');
const { treinarGerenciadorNLP } = require('./commands/movimentacao/utilitariosFinanceiros');

const app = express();

// Configurações do Express
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logs de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

let sock;

// Função para verificar se WhatsApp está conectado
function isWhatsAppConnected() {
  return sock && sock.user && sock.user.id;
}

// Função para tentar reconectar WhatsApp caso caia
async function tryReconnectWhatsApp() {
  if (isWhatsAppConnected()) return sock;
  
  console.log("🔄 Tentando reconectar WhatsApp...");
  try {
    const { startBot } = require('./whatsapp');
    const startTime = Date.now();
    sock = await startBot();
    const endTime = Date.now();
    console.log(`✅ WhatsApp reconectado em ${endTime - startTime}ms`);
    
    // Reconfigurar endpoints com nova conexão para a api continuar funcionando
    if (global.expressApp && global.expressApp.configurarEndpointNotificacao) {
      await configurarEndpointNotificacao(global.expressApp, sock);
      console.log("✅ Endpoints atualizados após reconexão!");
    }
    
    return sock;
  } catch (error) {
    console.error("❌ Falha na reconexão do WhatsApp:", error);
    return null;
  }
}

async function inicializarBot() {
  try {
    console.log("🚀 Acordando...");
    const moment = require('moment-timezone');
    const saoPauloNow = moment.tz('America/Sao_Paulo');
    console.log("⏰ Data e hora (São Paulo):", saoPauloNow.format('DD/MM/YY HH:mm:ss'));

    // Treinar NLP antes de iniciar o bot
    console.log("🧠 Treinando modelo NLP...");
    await treinarGerenciadorNLP();
    console.log("✅ NLP treinado!");

    // Armazenar referência global do app para reconexões
    global.expressApp = app;
    global.tryReconnectWhatsApp = tryReconnectWhatsApp;
    
    // CRIAR SERVIDOR PRIMEIRO (Squarecloud exige porta 80 e host)
    const PORT = process.env.PORT || 80;
    const HOST = process.env.HOST || '0.0.0.0';
    
    console.log("🌐 Criando servidor HTTP...");
    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 SERVIDOR RODANDO NA PORTA ${PORT}`);
      console.log(`🌐 Host: ${HOST}`);
      console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 URL: https://assistentevirtual-financeiro-bot.squareweb.app`);
      console.log(`🏥 Health check: /health`);
      console.log(`✅ SERVIDOR HTTP CRIADO COM SUCESSO EM!`);
    });
    
    // Configurar endpoints básicos SEM WhatsApp (para health check)
    console.log("🔗 Configurando endpoints básicos...");
    await configurarEndpointNotificacao(app, null); // null indica que WhatsApp não está pronto
    console.log("✅ Endpoints básicos configurados!");
    
    // AGORA conectar ao WhatsApp em paralelo (não bloqueia o servidor)
    console.log("📱 Conectando ao WhatsApp em background...");
    console.log("⏳ Aguardando resolução da Promise startBot()...");
    
    const startTime = Date.now();
    sock = await startBot();
    const endTime = Date.now();
    
    console.log("✅ WhatsApp conectado!");
    console.log(`⏱️ Tempo de conexão WhatsApp: ${endTime - startTime}ms`);
    
    // Reconfigurar endpoints COM WhatsApp
    console.log("🔗 Atualizando endpoints com WhatsApp...");
    // Remover handlers antigos antes de adicionar novos
    app._router.stack = app._router.stack.filter(
      (layer) => {
        if (!layer.route) return true;
        const path = layer.route.path;
        return path !== '/api/send-message' && path !== '/health';
      }
    );
    await configurarEndpointNotificacao(app, sock);
    console.log("✅ Endpoints atualizados com WhatsApp!");
    
    console.log("🎊 APLICAÇÃO TOTALMENTE INICIALIZADA!");
    console.log("🔥 TODOS OS SISTEMAS OPERACIONAIS!");
    console.log("🌟 BOT PRONTO PARA RECEBER TRANSAÇÕES DO APP MOBILE!");
    console.log(`📱 Endpoint de integração: /api/send-message`);
    console.log(`🔗 URL pública: https://assistentevirtual-financeiro-bot.squareweb.app`);
    
    if (process.env.NODE_ENV === 'production') {
      console.log("🌩️ Rodando em produção na Squarecloud");
    } else {
      console.log("🛠️ Rodando em desenvolvimento local");
    }
    
  } catch (error) {
    console.error("❌ Erro fatal ao iniciar aplicação:", error);
    console.error("💥 FALHA CRÍTICA NA INICIALIZAÇÃO!");
    
    // Mesmo com erro no WhatsApp, manter servidor rodando para health check
    if (!sock) {
      console.log("⚠️ Mantendo servidor ativo mesmo sem WhatsApp para health checks");
    }
    
    process.exit(1);
  }
}

// Handlers de processo
process.on('uncaughtException', (error) => {
  console.error('❌ Exceção não tratada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada sem tratamento em:', promise, 'motivo:', reason);
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando graciosamente...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando graciosamente...');
  process.exit(0);
});

// Iniciar aplicação
inicializarBot();
