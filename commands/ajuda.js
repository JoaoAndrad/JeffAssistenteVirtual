const { simularDigitar } = require("./utilitariosComandos");

async function tratarComandoAjuda(sock, chatId) {
   const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

   // Mensagem 1: Introdução e Perfil Financeiro
   const helpMessage1 = `✨ *Olá! Tudo bem?* ✨  

Eu sou seu *assistente financeiro pessoal* 🤖💰, e estou aqui para transformar sua relação com dinheiro em algo *super simples e organizado*!  

📌 *Vamos começar? Aqui está o que posso fazer por você:*  

🆕 *1. CRIAR PERFIL FINANCEIRO*  
Seu ponto de partida para controle total! Basta me enviar:  
   → *"Criar perfil financeiro"*  

Nesse processo, você vai:  
   • 📥 Cadastrar contas (banco, carteira digital, investimentos)  
   • 💰 Definir saldos iniciais  
   • 🏷️ Personalizar categorias (se quiser!)  

*Dica:* Quanto mais completo seu perfil, mais preciso eu fico!`;

   await simularDigitar(sock, chatId);
   await sock.sendMessage(chatId, { text: helpMessage1 });
   await delay(2500);

   // Mensagem 2: Registrar Transações
   const helpMessage2 = `📝 *2. REGISTRAR TRANSAÇÕES*  
Fale comigo *como se fosse um amigo* – eu entendo linguagem natural!  

*Exemplos práticos:*  
   • 🛒 *"Gastei R$ 50 no mercado hoje"*  
   • 🎬 *"Paguei R$ 35 no ingresso do cinema"*  
   • 💵 *"Recebi R$ 1500 de salário"*  
   • 🚕 *"Gasolina: R$ 120 no Posto Ipiranga"*  

💡 *Dica bônus:*  
Use descrições claras (ex: *"Ifood - R$ 32,50"*) para eu categorizar automaticamente!`;

   await simularDigitar(sock, chatId);
   await sock.sendMessage(chatId, { text: helpMessage2 });
   await delay(2500);

   // Mensagem 3: Relatórios
   const helpMessage3 = `📊 *3. RELATÓRIOS INTELIGENTES*  
Visualize seus gastos e receitas *como um CEO*! 👔  

✍️ Peça um resumo com:  
   → *"Relatório mensal"* (mês atual)  
   → *"Relatório de março"* (específico)  

*O que você recebe:*  
   • 📈 Gráficos de pizza e barras  
   • 🔍 Relatório detalhado de despesas e receitas separados por categorias.  
   • 🎯 Meta de economia (Em breve)`;

   await simularDigitar(sock, chatId);
   await sock.sendMessage(chatId, { text: helpMessage3 });
   await delay(2500);

   // Mensagem 4: Rotinas e Lembretes
   const helpMessage4 = `🔔 *4. ROTINAS E LEMBRETES*  
Nunca mais esqueça suas tarefas financeiras! 📅  

*Criação interativa:*  
   → *"Criar rotina"* (modo passo a passo)  

*Criação rápida:*  
   → *"Criar rotina todos os dias às 19:00 anotar gastos"*  
   → *"Criar rotina segunda às 09:00 verificar saldo"*  
   → *"Criar lembrete 15/07 às 14:00 pagar conta"*  

*Comandos de gerenciamento:*  
   → *"Ver rotinas"* (listar todas)  
   → *"Editar rotina"* (modificar existente)  

*Respostas para tarefas:*  
   • ✅ *"Sim"* - Marca como concluída  
   • ⏰ *"Não"* - Reagenda para 1 hora  
   • 🚫 *"Não vou fazer"* - Suspende os lembretes  

*Dica:* Tarefas repetitivas se reagendam automaticamente!`;

   await simularDigitar(sock, chatId);
   await sock.sendMessage(chatId, { text: helpMessage4 });
   await delay(2500);

   // Mensagem 5: Comandos e Dicas Finais
   const helpMessage5 = `⚡ *COMANDOS RÁPIDOS*  

▸ *"Perfil"* → Editar seu cadastro  
▸ *"Saldo"* → Ver saldo atualizado  
▸ *"Atualizar saldo"* → Atualizar saldo de contas  
▸ *"Gastei [valor] em [descrição]"* → Registrar despesa  
▸ *"Criar rotina"* → Configurar lembretes  
▸ *"Ver rotinas"* → Listar suas rotinas  
▸ *"/comandos"* → Menu completo de ajuda  

*Para tarefas pendentes:*  
▸ *"Sim"* → Marcar como concluída  
▸ *"Não"* → Adiar lembrete  
▸ *"Não vou fazer"* → Suspender rotina  

💬 *Pronto para dominar suas finanças?*  
É só começar! Estou aqui 24/7 para te ajudar. 😊`;

   await simularDigitar(sock, chatId);
   await sock.sendMessage(chatId, { text: helpMessage5 });
}

module.exports = { tratarComandoAjuda };