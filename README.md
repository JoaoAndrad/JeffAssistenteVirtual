# 🤖 Assistente Virtual para WhatsApp — Finanças & Rotinas

Olá, me chamo **Jeff** e sou seu assistente inteligente para WhatsApp, projetado para ajudar no **gerenciamento financeiro pessoal** e na **organização de rotinas e tarefas**, com suporte a linguagem natural, gráficos, lembretes e muito mais.

## 📌 Visão Geral

Este projeto utiliza a biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys) para se conectar ao WhatsApp de forma não oficial, permitindo a automação de interações com usuários. Ele combina funcionalidades de **controle financeiro**, **organização de tempo** e **produtividade**, com dados persistidos via Firebase e suporte a comandos por texto ou áudio.

## 🚧 Em desenvolvimento

As seguintes funcionalidades estão atualmente em construção para expandir ainda mais a capacidade do assistente:

- 🔗 Integração com **Google Calendar** para sincronização bidirecional de eventos
- ⏰ Sistema nativo de **alarmes e lembretes inteligentes** além das mensagens enviadas via WhatsApp
- 🗣️ Integração com **Alexa** através de uma skill personalizada para comandos por voz, comunicação da alexa direto com a API REST

Esses recursos permitirão eu Jeff atue como uma ponte entre sua rotina digital e seus dispositivos inteligentes.

## 🔧 Funcionalidades

O Assistente Virtual oferece recursos completos para ajudar usuários a manterem suas finanças organizadas e suas rotinas sob controle:

### 💸 Finanças Pessoais

- Registrar e consultar transações diretamente pelo WhatsApp
- Visualizar saldo e histórico financeiro detalhado
- Gerar relatórios mensais com gráficos interativos
- Categorizar despesas automaticamente com inteligência de linguagem natural
- **Importação automática de transações por notificações bancárias**
  > Através de um aplicativo Android desenvolvido pelo autor, o sistema detecta notificações de apps bancários e envia os dados diretamente para a API REST integrada ao assistente, garantindo que os gastos sejam registrados de forma automática e segura
- Suporte a múltiplas contas e perfis

### ⏱️ Gestão de Tempo e Rotinas

- Criar e acompanhar rotinas personalizadas (diárias, semanais, etc.)
- Gerenciar tarefas com lembretes inteligentes e automáticos
- Gerar imagens de agenda no estilo Google Calendar com suas atividades semanais
- Destaque para tarefas pendentes, eventos repetitivos e conclusão de metas

### 🧠 Recursos Inteligentes

- Processamento de linguagem natural (NLP) para entender comandos em texto
- Reconhecimento de voz via [AssemblyAI](https://www.assemblyai.com/) para transcrição de comandos por áudio
- Detecção automática de comandos usando expressões regulares e classificação semântica
- Integração com gráficos e notificações contextuais

### 🔒 Infraestrutura e Escalabilidade

- Persistência de dados no Firebase Firestore
- Estrutura modular, fácil de escalar com novos módulos e comandos
- Suporte a múltiplos usuários simultaneamente

## 📦 Tecnologias Utilizadas

- **Node.js** — Ambiente principal de execução
- **Baileys** — API WebSocket para conexão com o WhatsApp
- **Firebase (Firestore e Auth)** — Backend para dados e autenticação
- **AssemblyAI** — Transcrição de voz para texto
- **Natural** — Biblioteca de NLP para interpretação de comandos
- **Moment-Timezone** — Gerenciamento de datas com fuso horário
- **@napi-rs/canvas** — Geração de imagens e gráficos

## 📄 Licença

**Todos os direitos reservados**  
Copyright (c) 2025 João Andrade

Este projeto é de propriedade exclusiva do autor. Não é permitida a cópia, distribuição, modificação, uso comercial ou qualquer outro uso sem autorização expressa e por escrito do detentor dos direitos autorais.

---

**All rights reserved**  
Copyright (c) 2025 João Andrade

This project is the exclusive property of the author. Copying, distribution, modification, commercial use, or any other use is not allowed without the express written permission of the copyright holder.

---

👤 Desenvolvido por **João Andrade**  
🎓 Estudante de Engenharia da Computação | UFPB  
📬 E-mail: [joaov.andrade.dev@gmail.com](mailto:joaov.andrade.dev@gmail.com)  
📸 Instagram: [@andradev.joao](https://instagram.com/andradev.joao)
