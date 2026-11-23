# Checklist de publicação e integração Shopee

Atualizado em 23/11/2026. Este arquivo registra o estado observado e os passos para terminar a autorização de uma loja de teste. A integração usa backend e mantém tokens de loja cifrados no Supabase.

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
- [ ] Confirmar no navegador o login Supabase no domínio permanente.
- [ ] Publicar as próximas alterações por push para `main`. O domínio acompanha a implantação de produção.

## Shopee Open Platform

- [x] Criar o aplicativo `Shopee Manager IA` como **Seller In House System**.
- [x] Confirmar que o app aparece como `Developing` e tem um Partner ID de teste.
- [x] Preparar uma identidade visual e descrição para o app.
- [x] Configurar no backend o Partner ID, a Partner Key de teste e `SHOPEE_ENV=sandbox`.
- [x] Guardar a Partner Key e a chave de cifragem dos tokens nas variáveis privadas da Vercel.
- [ ] Atualizar **Test Redirect URL Domain** na Shopee para `https://shopeemanager.vercel.app`, a origem configurada no backend.
- [ ] Criar ou confirmar uma conta de vendedor de teste na ferramenta **Test Account-Sandbox v2**.
- [ ] Confirmar que o app e a conta de vendedor de teste estão disponíveis para a mesma região brasileira.
- [ ] Entrar no Shopee Manager IA pelo domínio permanente com a conta proprietária.
- [ ] Abrir **Integrações** e autorizar o app com a conta de teste.
- [ ] Conferir que o retorno chega a `/api/shopee/callback` e que a loja aparece conectada em modo sandbox.
- [ ] Solicitar sincronização de teste e confirmar catálogo, estoque e pedidos retornados pela Shopee.
- [ ] Relatar os escopos disponíveis. Os anúncios CPC dependem da permissão de Ads.
- [x] Manter gravação de preços desligada durante os testes de leitura.
- [ ] Validar uma alteração em sandbox somente após revisar a proposta e ativar a gravação apenas para esse ambiente.
- [ ] Fazer revisão das permissões, retirando as que não forem necessárias.
- [ ] Solicitar Go-Live após os testes e a aprovação exigida pela Shopee.
- [ ] Configurar credenciais live em ambiente e variáveis separados depois da aprovação.

## Fluxo de autorização esperado

1. A conta proprietária inicia a autorização em **Integrações**.
2. O backend gera um `state` de uso único e redireciona à Shopee.
3. A Shopee devolve o código de autorização e o identificador da loja ao callback HTTPS.
4. O backend valida o `state`, troca o código por tokens e cifra os tokens no Supabase.
5. O worker sincroniza as informações cobertas pelos escopos autorizados.

O fluxo usa os contratos existentes no adaptador em `server/shopee-client.ts` e no serviço de integração em `server/shopee.ts`. Testes locais exercitam respostas controladas. Eles não substituem a autorização e os dados reais do sandbox.

## Bloqueios identificados

- A implantação de produção está pronta e os domínios permanentes existem.
- O endereço atualmente registrado na Shopee redireciona para a autenticação da Vercel. O novo domínio deve ser salvo no console do aplicativo.
- O aplicativo seguia como `Developing`, sem Partner ID live e sem credenciais live.
- O navegador não confirmou uma conta de vendedor de teste vinculada ao aplicativo.
- A autorização da loja, o retorno com um código emitido pela Shopee e a sincronização real continuam pendentes. A sincronização depende de um worker Node com a configuração do mesmo sandbox.

## Referências do projeto

- [Checklist geral](checklist.md)
- [Operação e configuração](operacao.md)
- [Arquitetura](arquitetura.md)
- [Console do app Shopee](https://open.shopee.com/console/app/252598)
- [Ambiente de testes Shopee](https://open.test-stable.shopee.com/)
