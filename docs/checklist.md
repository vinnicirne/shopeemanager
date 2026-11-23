# Checklist de execução

Cada etapa termina com o registro do comando ou procedimento executado, ambiente, resultado e impedimentos. A etapa seguinte começa após a validação da anterior.

## 0. Primeira entrega

- [x] Auditar código, arquitetura, dependências e licença do Pixel Agents.
- [x] Verificar o ambiente e identificar dependências externas.
- [x] Propor arquitetura e responsabilidades de cada módulo.
- [x] Inicializar Git e criar os diretórios do projeto.
- [x] Definir critérios de aceite e testes E2E.
- [x] Registrar a aprovação da direção técnica com ajustes de confiabilidade e operação.
- [x] Incorporar o adendo obrigatório à arquitetura e atualizar os critérios de aceite.

## 1. Fundação

- [x] Criar app React/Vite, Tailwind, TypeScript, lockfile npm e configuração de testes e CI.
- [x] Configurar PostgreSQL local via PGlite, migrações, autenticação de demonstração e vínculos por loja.
- [x] Documentar pré-requisitos, variáveis e comandos de desenvolvimento.
- [x] Validar instalação limpa com `npm ci`, build, autenticação local e isolamento por loja na API e no banco.
- [x] Verificar TLS do Session pooler, as seis migrações e o papel `manager_app` no Supabase de staging.
- [x] Confirmar no Supabase de staging que a primeira loja possui um proprietário vinculado ao Supabase Auth.
- [ ] Revalidar no navegador o login do proprietário em staging.

## 2. Escritório virtual

- [x] Fixar os módulos de renderização do Pixel Agents no commit auditado e preservar os avisos.
- [x] Criar planta do escritório com mesas, computadores e sete avatares identificáveis. Os departamentos aparecem nos perfis.
- [x] Implementar perfis clicáveis, navegação por teclado, seleção por lista e layout responsivo.
- [x] Exibir repouso, espera e trabalho a partir de fatos persistidos.
- [x] Validar renderização, sete perfis, teclado, escala móvel, pausa e o deslocamento entre a área de descanso e as mesas a partir da fila.

## 3. Agentes e comunicação

- [x] Configurar Vinni, Ana, Rafael, Beatriz, Gabriel, Mariana e Eduardo com instruções, ferramentas e memória por loja.
- [x] Implementar o provedor Gemini no backend, com contrato testado por respostas controladas, validação de saída, orçamento, métrica e tentativas.
- [x] Implementar fila, dependências, transferências, histórico e consolidação de Vinni.
- [x] Executar a fila no backend com reserva de processamento, deduplicação, transição após persistência e recuperação de tarefas interrompidas.
- [ ] Medir CPU, memória e duração em staging. Validar lotes limitados, timeout por chamada e retomada por etapa. Encaminhar operações indivisíveis acima do limite para um worker dedicado.
- [x] Validar localmente a cadeia de pesquisa a recomendação, interrupções e repetição segura.
- [x] Executar os cinco estágios de oportunidade com o Codex e busca web real. O worker isolado registrou fontes públicas de mercado e fornecedores e concluiu as cinco etapas na primeira tentativa. Caso de 23/11/2026 com porta-copos de MDF de 9 × 9 cm, em cerca de 2 min 35 s.
- [ ] Validar uma execução com a chave e o modelo Gemini de staging.

## 4. Shopee Open Platform

- [ ] Confirmar aplicativo, região, ambiente de testes, conta autorizada, escopos concedidos e callback registrado.
- [x] Registrar contratos oficiais de autorização, produtos, pedidos, anúncios CPC e alteração de preço.
- [x] Implementar autorização de loja, callback com estado de uso único, renovação e cifragem de tokens.
- [x] Implementar sincronização paginada e retomável de catálogo, variações, estoque, pedidos concluídos e anúncios CPC conforme escopo.
- [x] Implementar escrita de preço com aprovação, validação de versão e conciliação por leitura.
- [x] Validar com resposta controlada o caso de timeout após aplicação. O teste confirma uma única escrita.
- [x] Habilitar a configuração opcional do sandbox em staging e impedir o uso de credenciais live nesse ambiente.
- [ ] Validar revogação, permissões, limites por aplicativo e respostas inconclusivas em staging.
- [ ] Validar leitura e escrita permitidas no ambiente de testes da Shopee, com relatório dos escopos indisponíveis.

## 5. Inteligência comercial

- [x] Construir painel com receita informada, ranking, estoque, margem estimada e histórico diário. Exibir métricas de anúncios quando sincronizadas.
- [x] Consultar tendências públicas opcionais no Google Trends e processar oportunidades, complementos, kits e evidências fornecidas.
- [x] Calcular margem de contribuição por produto com preço, custo e taxa disponíveis.
- [x] Preparar sugestões de preço, promoção, lançamento e rascunhos de atendimento.
- [ ] Integrar fontes autorizadas de concorrência e tráfego da loja, repasses financeiros e dados de atendimento.
- [ ] Reconciliar indicadores com pedidos e repasses de referência. Cobrir cancelamentos, reembolsos, custos ausentes e períodos sem dados.

## 6. Automação e relatórios

- [x] Programar rotinas diárias por loja no fuso de São Paulo, com distribuição automática de tarefas.
- [x] Confirmar agendamento, processamento e entrega de relatórios com o navegador fechado.
- [x] Entregar relatório operacional e alertas internos de estoque e queda de receita comparável.
- [x] Implementar revisão de proposta, aprovação, rejeição, expiração e execução auditada.
- [x] Validar deduplicação de tarefas agendadas, recuperação de execução e reaplicação de aprovação.
- [ ] Configurar alertas operacionais externos para atraso da fila, sincronização e operações em conciliação em staging.

## 7. Administração

- [x] Entregar painel do proprietário com histórico de tarefas, sincronizações, erros e ações comerciais.
- [x] Ajustar papéis e permissões, configurar funcionários e gerir limites de gasto de IA.
- [x] Exibir tokens por funcionário, modelo, custo por tarefa, totais diários e mensais e limites configurados.
- [x] Validar reserva atômica de orçamento sob concorrência e contabilização de consumo incerto.
- [x] Vincular recomendação, evidência, aprovação, payload e resultado à trilha de auditoria.
- [x] Validar controle de acesso por papel e loja na API e no PostgreSQL local.

## 8. Testes E2E e publicação

- [x] Executar build de produção, 17 testes de integração e 10 E2E locais em Chromium em 23/11/2026.
- [ ] Testar com dados reais autorizados. Fazer smoke test de leitura e validar mudanças com autorização específica.
- [x] Validar funcionamento do painel e do Canvas em desktop e viewport móvel. O bundle inicial gerado ficou em cerca de 83 kB gzip de JavaScript.
- [x] Validar isolamento por loja, aprovação por papel e redação de contexto no contrato de IA. `npm audit --omit=dev` reportou zero vulnerabilidades conhecidas.
- [ ] Configurar staging e produção na Vercel e no Supabase. Aplicar migrações e validar domínio, callback, cron e monitoramento.
- [ ] Verificar produção após deploy e registrar evidências, recuperação e pendências de cada integração.

Na verificação de 23/11/2026, a demonstração e o staging local voltaram a responder em `4173` e `4174`. O banco Supabase hospedado confirmou o vínculo de proprietário e uma rodada recente do worker. O staging estava sem credenciais do sandbox Shopee. A cobertura da Shopee usa respostas controladas. O relatório do Playwright é gerado em `playwright-report/index.html`.

## Matriz E2E

| Jornada | Evidência esperada |
| --- | --- |
| Login e acesso | Proprietário acessa sua loja. Usuário anônimo, leitor e membros de outra loja têm acesso restrito ao respectivo escopo |
| Escritório | Sete personagens. Cada personagem abre seu perfil por clique e teclado. Trabalho, pausa e espera acompanham o estado efetivo |
| Colaboração | Descoberta de Rafael percorre avaliação, margem e estratégia até a recomendação de Vinni. Cada etapa registra autoria e resultado |
| Falha e recuperação | Erro do provedor gera tentativa registrada. Atualização da página mantém histórico. Reprocessamento retoma a cadeia sem duplicar resultados |
| Limite de execução | Uma interrupção após progresso parcial retoma da última etapa confirmada. Uma entrega repetida não grava o mesmo resultado duas vezes |
| Loja Shopee | Callback válido conecta loja autorizada. Retorno inválido é recusado. Sincronização persiste e atualiza catálogo, estoque e pedidos sem duplicar registros |
| Escrita externa incerta | Provedor de teste aplica a alteração e a resposta expira. Uma entrega repetida concilia sem segunda escrita. Quando a consulta é inconclusiva, a operação fica em revisão |
| Indicadores | Período, totais, ranking, margem, fontes e dados ausentes batem com a referência do ambiente |
| Rotinas sem sessão | Com os contextos do navegador fechados, o agendador inicia a rotina e o worker gera o relatório. A próxima sessão exibe o resultado. Dois acionamentos do mesmo período geram apenas uma rotina e uma notificação |
| Aprovação comercial | Apenas papel autorizado pode aprovar. Rejeição, expiração ou mudança no payload bloqueiam a execução. Aprovação válida produz confirmação auditada |
| Administração | Alterações de configuração e permissões persistem e aparecem no histórico. Visão de uso e erros é restrita ao proprietário |
| Custos de IA | O painel confere tokens por funcionário, modelo, custo por tarefa e totais diários e mensais. Chamadas concorrentes respeitam o saldo reservado e exibem o motivo da pausa |
| Auditoria | O proprietário rastreia recomendação, versão da evidência, aprovador, payload e confirmação externa. Usuário de outra loja não acessa a trilha |
| Produção | HTTPS, login, loja autorizada, carregamento do escritório, callback, sincronização, cron e alertas operacionais funcionam no ambiente publicado |

Playwright inicia a aplicação em um ambiente isolado e guarda rastros de falha. Os testes da aplicação usam banco de teste e respostas de provedores rotuladas. A validação de contrato dos provedores usa sandbox e a validação final usa credenciais e dados autorizados. Docker ou um projeto Supabase de teste, chave Gemini, app Shopee com loja autorizada e destinos Vercel/Supabase são dependências de execução. [Serviço de testes no Playwright](https://playwright.dev/docs/test-webserver)
