# Shopee Manager IA

Aplicação web independente para acompanhar Vinni e outros seis funcionários de IA em um escritório 2D e administrar a operação comercial de uma loja Shopee autorizada.

## Rodar localmente

Use Node.js 22.12 ou superior. O servidor inicia o frontend, a API, o PostgreSQL local com PGlite e o worker no mesmo processo. O worker continua processando enquanto o servidor estiver ligado.

```powershell
npm ci
npm run build
npm start
```

Abra [o escritório local](http://127.0.0.1:4173). A conta de proprietário é `demo@local.test` e a de leitor é `leitor@local.test`. A senha local padrão é `demonstracao`. O ambiente fica restrito ao loopback e usa dados de demonstração identificados. Para alterar configurações locais, copie `.env.example` para `.env`. O modo de desenvolvimento é `npm run dev`.

## Validação

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Os E2E usam banco em memória, servidor isolado e instância Chromium. Os resultados HTML ficam em `playwright-report/`. [Abrir o relatório local](playwright-report/index.html)

## Arquitetura e operação

O adendo de confiabilidade complementa o documento mestre e define os requisitos operacionais para a execução.

- [Auditoria do Pixel Agents](docs/auditoria-pixel-agents.md)
- [Arquitetura e estrutura do projeto](docs/arquitetura.md)
- [Adendo obrigatório de confiabilidade e operação](docs/arquitetura.md#adendo-obrigatório--confiabilidade-e-operação)
- [Checklist de execução e matriz de testes E2E](docs/checklist.md)
- [Configuração de Gemini, Supabase e publicação](docs/operacao.md)
- [Checklist passo a passo da integração e do sandbox Shopee](docs/checklist-shopee.md)

## Diretórios

| Caminho | Responsabilidade |
| --- | --- |
| `apps/web/` | Aplicação React, escritório Canvas, painéis e perfis dos funcionários |
| `packages/office/` | Renderização do Pixel Agents, arte licenciada e adaptação do estado dos personagens |
| `packages/contracts/` | Esquemas de validação e tipos compartilhados |
| `server/` | API autenticada, worker agendado, armazenamento e provedores de análise |
| `supabase/migrations/` | Esquema PostgreSQL e políticas RLS aplicáveis ao Supabase |
| `tests/integration/` | Testes de persistência, segurança e contratos externos |
| `tests/e2e/` | Fluxos completos no navegador |
| `docs/` | Auditoria, arquitetura, execução e operação |
