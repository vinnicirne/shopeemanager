# Arquitetura do Shopee Manager IA

## Aplicação e serviços

O frontend será React e TypeScript com Vite e Tailwind CSS, hospedado na Vercel. O renderizador do Pixel Agents roda no navegador. Um adaptador converte os estados da fila em poses e animações. Perfis, tarefas, relatórios e aprovações têm interfaces HTML que também funcionam com teclado e em telas pequenas. [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite)

Supabase Auth identifica o usuário em produção. PostgreSQL mantém as lojas, permissões e dados de operação. A API Node valida sessão, vínculo com a loja e autorização. A conexão da API assume por transação um papel restrito por RLS ao escopo da loja. O frontend atualiza o escritório por polling enquanto a aba está visível. Chamadas à Shopee e ao Gemini partem do backend. [Segurança por linha no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) · [API Gemini](https://ai.google.dev/api/generate-content)

O agendador do serviço Node aciona o worker inicial, que consome a fila persistida no PostgreSQL. O próximo estágio só é liberado quando o anterior grava um resultado validado. A transação grava resultado, atividade e transição de estado. O escritório acompanha esse estado e recupera o histórico ao reconectar. Supabase Cron e PGMQ são alternativas para hospedar o gatilho e o consumo em uma implantação futura. [Supabase Cron](https://supabase.com/docs/guides/cron) · [Supabase Queues](https://supabase.com/docs/guides/queues)

## Adendo obrigatório — confiabilidade e operação

1. O processamento deverá funcionar independentemente da sessão do navegador. O worker terá credencial de serviço restrita às operações necessárias e será acionado pelo agendador no backend. O navegador consulta o estado persistido. O monitoramento registra a última execução bem-sucedida, a idade da mensagem mais antiga, falhas e operações pendentes de conciliação.
2. Uma mensagem que volta a ficar visível pode ser entregue novamente. Cada etapa terá uma identidade estável, uma restrição de unicidade no banco e uma reserva de execução com prazo. Ao gravar o resultado, o worker verificará se ainda é dono da reserva. A confirmação da mensagem na fila ocorre após a gravação durável. Para escritas na Shopee, registrar a operação com identidade estável, payload aprovado e versão do recurso antes de chamar a API. Reutilizar a mesma chave externa quando o contrato oferecer idempotência. Após timeout ou queda entre a chamada e a gravação, registrar o resultado como incerto e consultar o estado ou a confirmação da Shopee. Uma nova escrita exige confirmação de que a operação anterior não foi aplicada ou uma garantia de idempotência prevista no contrato. Se a verificação for inconclusiva, encaminhar para revisão. [Extensão PGMQ do Supabase](https://supabase.com/docs/guides/queues/pgmq)
3. Definir prazo e tamanho de lote com margem para os limites de CPU, memória e duração do ambiente. Cada chamada externa tem timeout próprio. Dividir tarefas longas em etapas com progresso persistido e retomada. Para operações indivisíveis que excedam os limites medidos, usar um worker dedicado consumindo a mesma fila. Verificar os limites do plano e testar interrupção e retomada em staging. [Limites das Edge Functions](https://supabase.com/docs/guides/functions/limits)
4. Registrar por chamada o funcionário, a tarefa, a tentativa, o provedor, o modelo, os tokens informados pelo provedor e o custo estimado com tarifa, vigência e moeda. O painel do proprietário mostra tokens por funcionário, custo por tarefa, modelo usado e totais diários e mensais no fuso da loja. Reservar orçamento atomicamente antes de aceitar uma chamada, considerando consumo acumulado e reservas concorrentes. Ao concluir, ajustar a reserva com o uso informado. Se o consumo ficar incerto, manter a pendência contabilizada até a conciliação. Ao atingir um limite, pausar novas chamadas e registrar o motivo. [Referência da API Gemini](https://ai.google.dev/api/generate-content) · [Preços da Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
5. Gravar eventos de auditoria somente por acréscimo. Relacionar loja, tarefa e proposta, funcionário que recomendou, evidências e suas versões, decisão do aprovador, payload autorizado, data, tentativas e confirmação ou falha. A trilha permite reconstituir a decisão e o resultado, respeitando as permissões da loja e a redação de dados sensíveis.

## Estrutura atual

```text
apps/web/
  src/main.tsx          sessão, navegação, escritório e painéis
  src/styles.css        estilos do workspace e leiaute responsivo
packages/office/
  src/upstream/         módulos do Pixel Agents fixados no commit auditado
  src/adapter/          mapeamento de estado, seleção e ciclo de animação
  NOTICE.md             proveniência e atribuições
packages/contracts/
  src/                  esquemas de dados, tarefas, permissões e eventos
supabase/
  migrations/           tabelas, RLS, fila e notificações
server/
  db.ts                 conexões e escopo por loja
  index.ts              API Node, autenticação e agendador
  operations.ts         fila, execução e aprovações
  providers.ts          regras locais e Gemini
  shopee-client.ts      contratos, assinaturas e cifragem
  shopee.ts             autorização, sincronização e conciliação Shopee
tests/
  integration/          banco, RLS, fila e contratos dos provedores
  e2e/                  Playwright, dados de teste e jornadas do proprietário
docs/                   decisões, checklist e instruções operacionais
```

## Equipe e ferramentas

| Funcionário | Personalidade | Ferramentas e entregas |
| --- | --- | --- |
| Vinni, Gerente Geral | Direto e responsável por prioridades | Cria e distribui tarefas, consulta resultados, consolida recomendações e encaminha propostas para aprovação |
| Ana, Analista de Dados | Metódica e orientada por métricas | Lê vendas, estoque e dados de tráfego disponíveis. Calcula indicadores, detecta quedas e produz relatórios |
| Rafael, Pesquisador de Mercado | Investigativo e criterioso com fontes | Consulta fontes de pesquisa autorizadas. Registra concorrentes, tendências, evidências e oportunidades |
| Beatriz, Especialista em Produtos | Criativa e pragmática | Consulta catálogo, estoque e descobertas. Avalia novos produtos, complementos e kits |
| Gabriel, Estrategista Comercial | Experimental e orientado a resultado | Lê catálogo, preços, métricas e análises. Prepara propostas de anúncios, promoções e lançamentos |
| Mariana, Atendimento | Empática e objetiva | Consulta dúvidas autorizadas e minimizadas. Agrupa recorrências e prepara respostas para revisão |
| Eduardo, Diretor Financeiro | Conservador e preciso | Consulta custos, taxas, pedidos e repasses disponíveis. Apura margem e lucro por produto |

Cada funcionário terá instruções versionadas, lista de ferramentas permitidas e memória de tarefas, evidências e descobertas da loja. O motor Gemini terá configuração por ambiente e interface de provedor. Ferramentas validam escopo e argumentos no servidor. Os agentes compartilham referências a resultados persistidos, com autoria e origem dos dados.

Uma pesquisa de Rafael pode gerar uma avaliação de Beatriz. A avaliação alimenta o cálculo de Eduardo, que fundamenta a proposta de Gabriel. Vinni consolida os resultados confirmados. Uma falha, uma etapa aguardando dados ou uma execução expirada interrompe a cadeia dependente e fica visível para a equipe.

## Estados, dados e autorizações

- Tarefas podem estar na fila, em execução, aguardando dados, concluídas, falhas ou canceladas. O personagem só trabalha visualmente enquanto existe execução vigente. Pausa configurada usa pose de descanso. Sem trabalho vigente, o estado é de espera. Eventos de reconexão atualizam a visão pelo estado persistido.
- Entidades iniciais incluem lojas, vínculos de usuários, perfis de agentes, tarefas, dependências, tentativas, resultados, descobertas, eventos, propostas, decisões, notificações, dados sincronizados e consumo de IA.
- Perfis iniciais de acesso incluem proprietário, operador e leitor. O proprietário configura a equipe e aprova ações comerciais. A aprovação referencia o payload exato, a versão do anúncio, o decisor e o prazo de validade. O executor revalida escopo e versão imediatamente antes da operação.
- Chaves dos provedores ficam no armazenamento de segredos do backend. Tokens por loja ficam cifrados e restritos ao integrador. Dados de compradores são minimizados, com redação em logs e nos dados enviados ao modelo. Falhas registram código e correlação, sem corpo sensível.
- Indicadores incluem fonte, período, moeda e última sincronização. Valores financeiros usam decimal ou centavos inteiros e parâmetros documentados. Custos faltantes produzem margem estimada ou indisponível conforme a cobertura. Conversão exige dados compatíveis de tráfego e vendas. Fixtures ficam marcadas e isoladas por ambiente.
- O adaptador usa contratos oficiais para catálogo, estoque, pedidos, anúncios CPC e atualização de preço. A autorização real e os escopos dependem do app parceiro e da loja. Repasses e atendimento da Shopee exigem contratos e permissões adicionais. Pesquisa usa o briefing e as evidências fornecidas. [Documentação da Shopee Open Platform](https://open.shopee.com/documents/v2/api-reference) · [Ambiente de testes da Shopee](https://open.test-stable.shopee.com/)
