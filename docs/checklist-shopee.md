# Checklist de publicação e integração Shopee

Atualizado em 25/11/2026. A loja brasileira está autorizada em produção. O backend guarda os tokens cifrados no Supabase. Os testes do sandbox e a operação da loja real têm estados separados.

## GitHub e Vercel

- [x] Criar e vincular o projeto Vercel `shopeemanager` ao repositório GitHub.
- [x] Enviar o código e a configuração da API para `main`.
- [x] Publicar o domínio permanente com HTTPS.
- [x] Manter autenticação do Shopee Manager IA e sessão Supabase na mesma origem.
- [x] Configurar variáveis privadas de Supabase e o certificado TLS na Vercel.
- [x] Verificar o domínio permanente: `https://shopeemanager.vercel.app`.
- [x] Verificar o segundo domínio permanente: `https://shopeemanager-vinicius-projects-9c337fc5.vercel.app`.
- [x] Verificar que a implantação mais recente consultada estava `Ready`.
- [x] Confirmar que as variáveis de produção incluem Supabase, certificado TLS e domínio.
- [x] Confirmar no navegador o login Supabase no domínio permanente.
- [x] Publicar as correções de sincronização e arquivamento em `main` e verificar a implantação.

## Shopee Open Platform

- [x] Criar o aplicativo `Shopee Manager IA` como **Seller In House System**.
- [x] Obter o Partner ID de teste e confirmar o status `Online` após o Go-Live.
- [x] Preparar uma identidade visual e descrição para o app.
- [x] Configurar no backend o Partner ID, a Partner Key de teste e `SHOPEE_ENV=sandbox`.
- [x] Guardar a Partner Key e a chave de cifragem dos tokens nas variáveis privadas da Vercel.
- [x] Confirmar **Test Redirect URL Domain** e **Live Redirect URL Domain** apontando para `https://shopeemanager.vercel.app`.
- [x] Confirmar no **Test Account-Sandbox v2** uma conta de vendedor de teste na região **Local - BR**.
- [x] Confirmar que **Login Seller** abre a Central do Vendedor com a conta brasileira de teste.
- [ ] Confirmar que o app e a conta de vendedor de teste estão disponíveis para a mesma região brasileira.
- [x] Entrar no Shopee Manager IA pelo domínio permanente com a conta proprietária.
- [ ] Abrir **Integrações** e autorizar o app com a conta de teste.
- [ ] Conferir que o retorno chega a `/api/shopee/callback` e que a loja aparece conectada em modo sandbox.
- [ ] Solicitar sincronização de teste e confirmar catálogo, estoque e pedidos retornados pela Shopee.
- [ ] Relatar os escopos disponíveis. Os anúncios CPC dependem da permissão de Ads.
- [x] Manter gravação de preços desligada durante os testes de leitura.
- [ ] Validar uma alteração em sandbox somente após revisar a proposta e ativar a gravação apenas para esse ambiente.
- [ ] Fazer revisão das permissões, retirando as que não forem necessárias.
- [x] Solicitar Go-Live e confirmar a aprovação.
- [x] Configurar as credenciais live nas variáveis privadas de produção.
- [x] Autorizar a loja real e verificar o retorno e o vínculo de produção.
- [x] Sincronizar catálogo e pedidos concluídos e comparar uma amostra com a Central do Vendedor.
- [x] Preservar o arquivamento de produtos no painel durante a sincronização.
- [x] Conferir e registrar repasses, taxas e reembolsos dos pedidos da aba Lucro.

## Fluxo de autorização esperado

1. A conta proprietária inicia a autorização em **Integrações**.
2. O backend gera um `state` de uso único e redireciona à Shopee.
3. A Shopee devolve o código de autorização e o identificador da loja ao callback HTTPS.
4. O backend valida o `state`, troca o código por tokens e cifra os tokens no Supabase.
5. O worker sincroniza as informações cobertas pelos escopos autorizados.

O fluxo usa os contratos existentes no adaptador em `server/shopee-client.ts` e no serviço de integração em `server/shopee.ts`. Testes locais exercitam respostas controladas. Eles não substituem a autorização e os dados reais do sandbox.

## Pendências do sandbox e da integração

- A conta de vendedor **Local - BR** existe. O vínculo de sandbox continua pendente.
- Em 23/11/2026, **Login Seller** abriu a Central do Vendedor do sandbox brasileiro. Na autorização do aplicativo, a Shopee exibiu **Error. Please try again later** e o login registrou HTTP 500 em `/api/account/login/` com a região **Brazil** selecionada. A consulta ao banco encontrou uma autorização pendente e nenhum vínculo para a loja de teste. [Chamado de suporte](https://service.open-platform.cs.shopee.com/detail/2124959056616321074)
- O endpoint de autorização do sandbox respondeu com um redirecionamento para o login da Shopee. O erro precisa ser investigado nessa etapa. O retorno com código e o domínio registrado no console ainda precisam ser confirmados.
- Autorização, callback e sincronização do sandbox continuam pendentes. O ambiente de produção já tem vínculo e sincronização confirmados.

## Referências do projeto

- [Checklist geral](checklist.md)
- [Operação e configuração](operacao.md)
- [Arquitetura](arquitetura.md)
- [Console do app Shopee](https://open.shopee.com/console/app/252598)
- [Ambiente de testes Shopee](https://open.test-stable.shopee.com/)
