# Auditoria do Pixel Agents

Auditoria de 22/11/2026 sobre a versão **1.6.0**, commit `4dd14d612fd37d89ffbbc977959f572395c4eec8`, em checkout temporário. [Commit auditado](https://github.com/pixel-agents-hq/pixel-agents/tree/4dd14d612fd37d89ffbbc977959f572395c4eec8)

## Licença

O código está sob licença MIT, com copyright de Pablo De Lucca. A distribuição dos módulos reutilizados deve incluir os avisos originais. O escopo da licença de alguns recursos visuais e tipográficos empacotados foi questionado e segue sem confirmação do mantenedor na discussão consultada. Usar arte própria ou de licença verificada e registrar origem, autorização e avisos de cada recurso. Auditar também fontes, ícones e sprites importados indiretamente por módulos de código. [Licença do código](https://github.com/pixel-agents-hq/pixel-agents/blob/4dd14d612fd37d89ffbbc977959f572395c4eec8/LICENSE) · [Discussão sobre a arte](https://github.com/pixel-agents-hq/pixel-agents/issues/355)

## Compatibilidade

| Componente inspecionado | Constatação | Aplicação proposta |
| --- | --- | --- |
| `webview-ui/package.json` | React 19, TypeScript 5.9, Vite 8, Tailwind 4 e Vitest | Compilar o escritório junto à aplicação React |
| `webview-ui/src/office/engine/` | Canvas 2D, renderização, seleção e ciclo de animação | Reaproveitar o motor e seus testes pertinentes em módulo isolado |
| `webview-ui/src/office/components/OfficeCanvas.tsx` | React ligado ao editor, eventos de áudio e transporte do upstream | Criar um componente hospedeiro pequeno e manter seleção e acessibilidade no app |
| `webview-ui/src/characters/` e `core/src/assets/` | Renderização de personagens, folhas de sprites e carregamento de arte | Criar sete personagens com recursos licenciados e compatíveis com o motor |
| `webview-ui/src/transport/` | WebSocket no modo standalone e `postMessage` na extensão | Traduzir estados persistidos no Shopee Manager IA na fronteira do renderizador |
| `server/`, `core/src/terminalAdapter.ts` e `adapters/vscode/` | Servidor Fastify, terminal de agentes locais e integração com VS Code | Preservar o upstream e manter o runtime comercial independente |

O renderizador usa módulos internos de geometria, paletas, projeção, sprites e seleção. A reutilização deve levantar a dependência transitiva de cada arquivo copiado. A confirmação de integração exige um teste com layout próprio, sete personagens e cliques no Canvas e na lista acessível. O pacote standalone foi projetado para sessões de terminal e usa um token local para operações de edição e execução. A autenticação da aplicação comercial será feita pelo Supabase Auth. [Código do renderizador](https://github.com/pixel-agents-hq/pixel-agents/blob/4dd14d612fd37d89ffbbc977959f572395c4eec8/webview-ui/src/office/engine/renderer.ts) · [Documentação do modo standalone](https://github.com/pixel-agents-hq/pixel-agents/tree/4dd14d612fd37d89ffbbc977959f572395c4eec8#standalone-cli)

## Ambiente verificado

O computador tem Node.js 24.11.1, npm 11.6.2, Git 2.51.2, Supabase CLI 2.98.2 e Vercel CLI 48.10.5. Docker e `psql` não foram encontrados no PATH. A etapa de banco precisa confirmar um runtime local compatível com o Supabase CLI ou usar um projeto de teste autorizado. [Desenvolvimento local com Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Resultados dos testes

| Verificação no checkout original | Resultado |
| --- | --- |
| `npm ci` | Instalação concluída com o lockfile do upstream |
| `npm run test:webview` (via `npm test`) | 439 testes passaram em 54 arquivos |
| `npm run build:webview` | Build de produção concluído. Vite sinalizou um bundle inicial grande no upstream |
| `npm run test:server` (via `npm test`) | 944 testes passaram, 80 falharam e 31 foram ignorados no Windows. Entre as falhas observadas estão testes de terminal, persistência e integração da barra de status do Claude |
| `npm run test:package-contract` | Sete testes passaram |

A integração proposta reaproveita o motor visual e mantém o servidor de terminal fora da aplicação comercial. Os testes acima cobrem o Pixel Agents original. O aceite do Shopee Manager IA requer os testes do adaptador, do sistema e da matriz E2E após a implementação.
