# Tidy Renown – Facções & Reputação

Módulo para **Foundry VTT v14** e **dnd5e 6.x** que implementa a regra opcional de **Renown** do
_Dungeon Master's Guide_ (2024), integrada ao **Tidy 5e Sheets** (dependência obrigatória).

A especificação completa está em [`SPEC.md`](SPEC.md).

## Funcionalidades

- **Grupos** (facção, organização ou comunidade) com descrição, imagem, cor, escala da barra, teto
  opcional e ranks próprios. O botão "Usar limiares do DMG" cria os limiares 3, 10 e 50 com os
  benefícios sugeridos pelo livro (só texto, sem automação). O gerenciador é dividido em abas
  (Detalhes, Ranks, Membros); descrições usam o editor formatado do Foundry e ranks são criados e
  editados em uma janela própria.
- **Renome por personagem ou pela party** (ator `group` do dnd5e), separado por grupo. Membros
  nunca ficam abaixo de 0 (regra do DMG); não membros e relações individuais com NPCs podem ficar
  negativos (extensão do módulo).
- **Membros calculados em runtime** a partir das flags dos atores; nada é duplicado no grupo.
- **Abas "Renome" no Tidy** para personagem, party e NPC, registradas pela API oficial do Tidy.
- **Disposição automática dos tokens** (extensão do módulo): NPCs ficam Hostis abaixo de −10 e
  Amigáveis acima de 10 (limiares configuráveis), conforme a pontuação da party com os grupos do NPC
  ou com o próprio NPC. Tokens Secret ou travados não mudam.
- **Só o mestre edita.** Opcionalmente (desligado por padrão), jogadores podem pedir +1 nos próprios
  personagens; o pedido vai por socket e o mestre ativo valida antes de gravar.
- **i18n** em `en` e `pt-BR`.

## Uso rápido (mestre)

1. Abra o gerenciador pelo botão **Renome** no diretório de atores, pelas configurações do módulo
   ou pelo botão **Gerenciar** na aba Renome.
2. Clique em **Novo grupo**, dê um nome e, se quiser, **Usar limiares do DMG**.
3. Na aba **Membros**, clique em **Adicionar atores** (seletor organizado por pasta, com busca e
   seleção da pasta inteira) ou arraste atores da barra lateral; ajuste a pontuação com − / +.

API para macros: `game.modules.get("tidy-renown").api` expõe `openManager`, `getFactions`,
`getMembers`, `getRelations`, `computeNpcStanding` e `recalculateDispositions`.

## Desenvolvimento

Requisitos: Node 22+.

```bash
npm install            # gera o package-lock.json (faça commit dele)
npm run build:watch    # build contínuo em dist/
npm run link           # symlink de dist/ para <Data>/modules/tidy-renown
npm run check          # tipos, lint, formatação, i18n e testes
```

`npm run link` lê o caminho de dados do Foundry da variável `FOUNDRY_DATA` ou de
`foundryconfig.json` (veja `foundryconfig.example.json`).

### Estrutura

| Caminho                         | Conteúdo                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/data/rules.ts`             | Regras puras (piso, teto, ranks, pontuação da party, disposição). |
| `src/data/renown.ts`            | Leitura e escrita das flags dos atores.                           |
| `src/data/membership-index.ts`  | Listas de membros em runtime.                                     |
| `src/services/disposition.ts`   | Disposição automática dos tokens.                                 |
| `src/services/socket.ts`        | Pedidos de +1 dos jogadores.                                      |
| `src/tidy/`                     | Abas do Tidy (contexto, eventos, registro).                       |
| `src/apps/FactionManagerApp.ts` | Gerenciador de grupos (ApplicationV2).                            |
| `tests/`                        | Testes de regras e de integração com um mock do Foundry.          |

## Publicação

A cada **Release** publicada no GitHub com tag `vX.Y.Z`, o workflow `release.yml`:

1. roda `npm run check` e `npm run build`;
2. gera o `module.json` final (`manifest` → `/releases/latest/…`, `download` → zip da tag);
3. anexa `module.json` e `module.zip` à Release;
4. valida na **Package Release API** do Foundry com `dry-run`;
5. publica a versão no site do Foundry (pula prereleases).

Antes da primeira release:

1. Crie o pacote `tidy-renown` no site do Foundry (submissão inicial manual).
2. Copie o **Package Release Token** (começa com `fvttp_`) da página do pacote.
3. Salve-o no GitHub em _Settings → Secrets and variables → Actions_ como `FOUNDRY_PACKAGE_TOKEN`.
4. Confira `compatibility.verified` em `src/module.json` com o build do Foundry v14 testado e a
   versão mínima do Tidy em `relationships.requires`.
