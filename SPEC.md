# Especificação de Requisitos e Arquitetura
**Módulo Foundry VTT: Renome / Reputação (D&D 5.5e / 2024)**

| Campo | Valor |
|-------|-------|
| Nome técnico | `tidy-renown` |
| Título exibido | Tidy Renown – Facções & Reputação |
| Versão inicial alvo | 1.0.0 |
| Foundry VTT | **v14** (mínimo `14`) |
| Sistema obrigatório | `dnd5e` **6.0.0+** (regras 2024 / 5.5e) |
| Dependência obrigatória | `tidy5e-sheet` (Tidy 5e Sheets) **v14+** |
| Autor / Mantenedor | a definir |

> **Fonte única de regras:** apenas o *Dungeon Master's Guide* (2024), seção **Renown** do capítulo "DM's Toolbox". Regras do DMG 2014, do Adventurers League e de suplementos antigos (ranks Initiate/Agent/Stalwart/Mentor/Exemplar, facções "oficiais" como Harpers/Zhentarim, requisitos de missões secretas) **não fazem parte deste módulo**.
>
> Comportamentos que **não** estão no DMG 2024 e são automações próprias do módulo estão marcados como **[Extensão do módulo]**.

---

## 1. Visão Geral e Objetivos

O módulo implementa a regra opcional de **Renown** (Renome) do DMG 2024, permitindo gerenciar de forma simples e visual:

- Grupos: facções, organizações ou comunidades (o DMG trata os três da mesma forma).
- Score de renome por personagem (ou pelo grupo/party) em cada grupo.
- Ranks e títulos definidos pelo GM a partir de limiares de score.
- Benefícios (Recognition, Rank, Perks) exibidos como texto descritivo.
- **[Extensão do módulo]** Relações negativas de grupos e NPCs com personagens de jogadores e ajuste automático da disposição dos tokens.

**Princípios de design**

1. **Simplicidade de uso:** CRUD rápido de grupos e ajuste de score em poucos cliques.
2. **Integração nativa com o Tidy 5e Sheets** exclusivamente pela API oficial (o Tidy é renderizado em Svelte; manipular o DOM diretamente briga com o renderizador).
3. **Dependência obrigatória do Tidy:** sem ele, o módulo não registra nenhuma funcionalidade.
4. **Uma única fonte de dados por ator:** associação e score vivem só nas flags do ator; listas de membros são calculadas em runtime.
5. **Esteira automatizada** de build, release no GitHub e publicação no site do Foundry (Package Release API).

---

## 2. Regras de Negócio

### 2.1 Regras do DMG 2024 (RAW)

| Conceito | Regra |
|----------|-------|
| Escopo | Renome é rastreado por personagem **ou** pela party inteira, separadamente para cada grupo. |
| Valor inicial | 0 |
| Completar missões | +1 por avançar os interesses do grupo; +2 por missão atribuída pelo grupo ou que o beneficie diretamente; +3 ou +4 por missões de enorme importância. Tudo a critério do DM. |
| Envolvimento com o grupo (downtime) | Com score 1+, o personagem que passar entre aventuras um número de dias igual a 10 × score atual fazendo tarefas menores para o grupo ganha +1. |
| Perda de renome | Discordâncias não causam perda; ofensas graves contra o grupo ou seus membros causam perda de renome e de rank, na medida que o DM decidir. |
| Piso | O score de um personagem com um grupo **nunca fica abaixo de 0**. |
| Teto | O DMG não define teto. O maior limiar de benefício citado é 50. |
| Renome por nível (opcional) | Em vez de rastrear o score, o DM pode usar o nível do personagem como equivalente: nível 1 → 1, 3 → 3, 5 → 10, 11 → 25, 17 → 50. |

### 2.2 Benefícios (RAW, somente descritivo)

| Score | Benefício sugerido pelo DMG |
|-------|-----------------------------|
| 3+ | **Recognition:** o personagem é membro respeitado; outros membros são Friendly por padrão e oferecem abrigo e comida em situações extremas. **Perks:** contato confiável, esconderijo ou desconto em equipamento. |
| 10+ | **Perks:** acesso a poções e pergaminhos, possibilidade de pedir um favor, apoio em missões perigosas. |
| 50 | **Perks:** convocar um pequeno exército, adquirir um item mágico Raro, acesso a um conjurador prestativo, atribuir missões a membros de status inferior. |

O módulo exibe esses textos (editáveis por grupo) na ficha. **Não há automação mecânica de benefícios.**

### 2.3 Ranks

O DMG 2024 **não define ranks padrão**: o DM cria hierarquias e títulos e usa limiares de score como pré-requisito (não necessariamente o único).

- Cada grupo tem uma lista de ranks: `nome`, `score mínimo`, `descrição` (texto livre, onde o GM anota outros pré-requisitos), `ícone`.
- Um grupo novo nasce **sem ranks**. O botão "Usar limiares do DMG" cria três entradas sem nome (3, 10 e 50) já preenchidas com os textos de benefício da seção 2.2, para o GM nomear.
- O rank atual é o de maior `score mínimo` ≤ score do personagem, calculado em runtime.
- Pré-requisitos além do score são apenas texto; o módulo não os valida.

### 2.4 Membros e relações

- Qualquer `Actor` pode se relacionar com um grupo.
- **Personagens de jogador** (`character`) e o **ator de grupo** (`group`, para renome da party) guardam, nas próprias flags, o score com cada grupo e se são membros dele.
- **NPCs** (`npc`) guardam nas próprias flags a lista de grupos aos quais pertencem.
- A lista de membros de um grupo é **calculada em runtime** varrendo `game.actors`; nada é duplicado no grupo.

### 2.5 [Extensão do módulo] Relações negativas

O DMG mantém o piso em 0 para quem tem renome com o grupo. O módulo acrescenta **relações de hostilidade**, que existem fora da condição de membro:

| Situação | Faixa do score |
|----------|----------------|
| Personagem **membro** do grupo | `0` até o teto (piso RAW respeitado) |
| Personagem **não membro** do grupo | pode ficar negativo |
| Relação **individual** de um personagem com um NPC específico | pode ficar negativa |

- Ao expulsar um membro (desmarcar "membro"), o score passa a aceitar valores negativos.
- Ao marcar um personagem como membro, um score negativo é elevado a 0.

### 2.6 [Extensão do módulo] Disposição automática dos tokens

O score de relação se reflete na disposição dos tokens dos NPCs (`TokenDocument.disposition`).

**Score efetivo de um NPC em relação a um personagem (`s`)**

1. Se o personagem tem relação individual com o NPC, usa esse valor.
2. Senão, usa o **menor** score do personagem entre os grupos dos quais o NPC é membro (sem entrada conta como 0).
3. Se o NPC não pertence a nenhum grupo e não há relação individual, o NPC fica fora da automação.

**Score da party (`S`)**

1. Se o ator da party principal do dnd5e (`game.actors.party`) tem entrada para o mesmo alvo, usa esse valor (renome rastreado pela party, como o DMG permite).
2. Senão, usa a **média** de `s` entre os membros da party principal.
3. Se não houver party principal, usa a média entre todos os atores `character` que tenham um jogador como dono.

**Disposição resultante** (limiares configuráveis; padrão −10 e 10)

| Condição | Disposição |
|----------|------------|
| `S < −10` | Hostil (`CONST.TOKEN_DISPOSITIONS.HOSTILE`) |
| `S > 10` | Amigável (`CONST.TOKEN_DISPOSITIONS.FRIENDLY`) |
| Caso contrário | Neutro (`CONST.TOKEN_DISPOSITIONS.NEUTRAL`) |

**Regras de aplicação**

- Atualiza o `prototypeToken` do NPC e todos os tokens dele já colocados em cenas.
- Tokens com disposição **Secret** não são alterados.
- Tokens com a flag `tidy-renown.lockDisposition = true` não são alterados (trava manual do GM).
- Só um cliente executa a atualização: o GM ativo (`game.users.activeGM?.isSelf`).
- Gatilhos: alteração de flags de renome em qualquer ator, criação de token, mudança da party principal e mudança dos limiares.
- Só grava quando a disposição muda (evita updates em cascata).
- Pode ser desligada globalmente nas configurações.

> Nota de regra: o *Recognition* do DMG (membros Friendly a partir de 3+) é uma diretriz de interpretação de NPCs. A automação de token acima é uma regra de mesa do módulo e usa limiares próprios. O GM pode aproximá-la do RAW ajustando o limiar amigável.

---

## 3. Requisitos Funcionais

### RF-01 – Gerenciamento de grupos (GM)
- Criar, editar e excluir grupos.
- Campos: nome, tipo (facção / organização / comunidade, só rótulo), descrição, imagem, cor de destaque, escala da barra de progresso (padrão 50, apenas visual), teto opcional (vazio = sem teto, como no RAW), ranks e textos de benefício.
- Lista de membros e relações calculada em runtime, com score e rank.
- Disponível apenas para GMs (ApplicationV2).
- Ao excluir um grupo, o módulo remove as entradas correspondentes das flags dos atores.

### RF-02 – Edição de renome (somente GM)
- **Só o GM altera scores** e associações de qualquer ator.
- Adicionar ou remover um personagem como membro; associar ou desassociar NPCs.
- Ajuste por botões rápidos (+1, +2, +3/+4, −1, −2) e input numérico.
- Criar relação individual personagem ↔ NPC (a partir da ficha do NPC ou do gerenciador).
- Aplicação das faixas da seção 2.5 (piso 0 para membros).

### RF-03 – Aumento pelos jogadores (opcional)
- Setting world `playersCanIncrease`, **desabilitado por padrão**.
- Quando ligado, o dono de um personagem vê um botão **+1** nas próprias entradas.
- O pedido vai por socket ao GM ativo, que valida: usuário é dono do ator, delta é exatamente +1 e o teto é respeitado. Só então grava.
- Sem GM ativo conectado, o botão fica desabilitado com tooltip explicativo.
- Jogadores nunca diminuem score, criam relações nem alteram associações.

### RF-04 – Visualização na ficha (Tidy)
- **Personagem e party:** aba "Renome" com cards por grupo: imagem, nome, barra de progresso, score, rank atual, próximo limiar, textos de benefício alcançados, notas. Relações individuais com NPCs em uma seção separada.
- **NPC:** aba "Renome" com os grupos dos quais é membro, relações individuais e a disposição calculada (com indicador de trava).
- Botões de edição visíveis só ao GM (e o +1 do RF-03, quando habilitado).
- Estado vazio amigável quando não houver relações.
- Tema herdado do Tidy (claro/escuro e cor de destaque).

### RF-05 – Configurações do módulo
| Setting | Escopo | Padrão |
|---------|--------|--------|
| `playersCanIncrease` | world | `false` |
| `autoDisposition` | world | `true` |
| `hostileThreshold` | world | `-10` (hostil se score `<` valor) |
| `friendlyThreshold` | world | `10` (amigável se score `>` valor) |
| `showNpcRelationsToPlayers` | world | `false` |
| `factions` | world, oculto | `{}` (definições dos grupos) |

i18n completa em `en` e `pt-BR`.

### RF-06 – Dependência obrigatória do Tidy
- `module.json` declara `relationships.requires` com `tidy5e-sheet` (seção 5.4); o Foundry não deixa ativar o módulo sem a dependência.
- Verificação defensiva no hook `ready`: se `game.modules.get("tidy5e-sheet")?.active` for falso, exibe erro e não registra nada.

### RF-07 – Persistência
- **Definições dos grupos** → setting world `tidy-renown.factions`.
- **Dados de ator** → somente flags do próprio ator (seção 5.3).
- Nenhuma outra cópia de membros ou scores é mantida.

---

## 4. Requisitos Não Funcionais

| ID | Requisito |
|----|-----------|
| RNF-01 | Abertura da aba Renome < 100 ms com até 20 grupos. |
| RNF-02 | Cálculo de membros em runtime < 50 ms em mundos com até 2.000 atores (índice em memória invalidado nos hooks `createActor`/`updateActor`/`deleteActor`). |
| RNF-03 | Contraste adequado nos temas claro e escuro do Tidy. |
| RNF-04 | TypeScript + ESLint + Prettier; build sem erros nem warnings de lint. |
| RNF-05 | Build com Vite. |
| RNF-06 | CI/CD via GitHub Actions, com publicação automática no site do Foundry. |
| RNF-07 | Manifest dinâmico: `manifest` aponta para `/releases/latest/download/module.json`. |
| RNF-08 | i18n desde a primeira versão. |
| RNF-09 | Compatibilidade: Foundry v14, dnd5e 6.x, Tidy 5e Sheets v14+. Nenhum suporte a versões anteriores. |

---

## 5. Arquitetura Técnica

### 5.1 Estrutura de pastas

```
tidy-renown/
├── .github/workflows/
│   └── release.yml              # build + GitHub Release + Foundry Package Release API
├── src/
│   ├── main.ts                  # init/ready, checagem do Tidy, registro de settings
│   ├── module.json              # template (versão e URLs injetadas no build)
│   ├── apps/
│   │   └── FactionManagerApp.ts # ApplicationV2 (GM)
│   ├── tidy/
│   │   └── register-tabs.ts     # registerCharacterTab / registerNpcTab / registerGroupTab
│   ├── data/
│   │   ├── types.ts
│   │   ├── factions.ts          # CRUD das definições (setting)
│   │   ├── renown.ts            # leitura/escrita das flags, faixas e piso
│   │   └── membership-index.ts  # lista de membros em runtime
│   ├── services/
│   │   ├── disposition.ts       # cálculo e aplicação da seção 2.6
│   │   └── socket.ts            # pedidos +1 de jogadores (RF-03)
│   ├── styles/
│   │   └── tidy-renown.css
│   ├── templates/
│   │   ├── faction-manager.hbs
│   │   ├── actor-renown-tab.hbs
│   │   └── npc-renown-tab.hbs
│   └── lang/
│       ├── en.json
│       └── pt-BR.json
├── dist/                        # saída do build
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 5.2 Integração com o Tidy 5e Sheets (API confirmada)

Documentação de referência: wiki "07. Developer API" e API gerada em `kgar.github.io/foundry-vtt-tidy-5e-sheets`.

- A API fica disponível no hook `tidy5e-sheet.ready` ou em `game.modules.get('tidy5e-sheet').api`.
- Métodos de aba disponíveis: `registerActorTab`, `registerCharacterTab`, `registerNpcTab`, `registerVehicleTab`, `registerGroupTab`, `registerEncounterTab`, `registerItemTab`, `registerCharacterSidebarTab`.
- Modelos de aba: `HtmlTab`, `HandlebarsTab`, `SvelteTab`. O `tabId` é obrigatório e deve ter o prefixo do módulo.
- O usuário pode ocultar ou reordenar a aba nas configurações de Tab Selection do Tidy.
- As fichas Classic não existem mais no Tidy v14; o módulo só mira as fichas atuais.

```ts
Hooks.once("tidy5e-sheet.ready", (api) => {
  const makeTab = (tabId: string, path: string) =>
    new api.models.HandlebarsTab({
      title: game.i18n.localize("TIDY_RENOWN.TabTitle"),
      tabId,
      path,
      getData: async (data) => {
        data.tidyRenown = await buildRenownContext(data.actor);
        return data;
      },
      onRender(params) {
        bindRenownControls(params.tabContentsElement, params.app);
      },
    });

  api.registerCharacterTab(makeTab("tidy-renown-character",
    "modules/tidy-renown/templates/actor-renown-tab.hbs"));
  api.registerGroupTab(makeTab("tidy-renown-group",
    "modules/tidy-renown/templates/actor-renown-tab.hbs"));
  api.registerNpcTab(makeTab("tidy-renown-npc",
    "modules/tidy-renown/templates/npc-renown-tab.hbs"));
});
```

**Injeção avulsa (só se necessário):** para pequenos elementos fora da aba (ex.: selo de rank no cabeçalho), usar `registerActorContent` ou, em último caso, o hook `renderActorSheetV2` com `api.isTidy5eSheet(...)` e o atributo `data-tidy-render-scheme="handlebars"`, que faz o conteúdo re-renderizar a cada render do Tidy.

**Identidade visual:** reutilizar as classes utilitárias do Tidy (ex.: `inline-transparent-button`) e as variáveis CSS de tema do Tidy em vez de cores fixas. Os nomes exatos das variáveis devem ser conferidos no código-fonte do Tidy v14 durante a implementação.

### 5.3 Modelo de dados

```ts
/** Setting world `tidy-renown.factions`: Record<string, FactionDef> */
interface FactionDef {
  id: string;                 // foundry.utils.randomID()
  name: string;
  kind: "faction" | "organization" | "community"; // só rótulo
  description?: string;
  img?: string;
  color?: string;
  progressMax: number;        // escala da barra (padrão 50)
  cap?: number | null;        // teto opcional; null = sem teto (RAW)
  ranks: RankDef[];
}

interface RankDef {
  id: string;
  name: string;
  minScore: number;
  description?: string;       // benefícios e pré-requisitos extras (texto livre)
  icon?: string;
}

/**
 * Flags de atores `character` e `group`:
 *   flags["tidy-renown"].relations: Record<RelationKey, RelationEntry>
 * RelationKey:
 *   "f_<factionId>"  → relação com um grupo
 *   "n_<npcActorId>" → relação individual com um NPC do mundo
 * (IDs são usados em vez de UUIDs porque pontos em chaves de flag viram aninhamento.)
 */
interface RelationEntry {
  score: number;
  member?: boolean;           // só para chaves "f_"; aplica piso 0 quando true
  notes?: string;
}

/** Flags de atores `npc`: flags["tidy-renown"].memberOf: string[] (ids de grupos) */

/** Flag de TokenDocument: flags["tidy-renown"].lockDisposition: boolean */
```

**Cálculos em runtime**
- `getMembers(factionId)`: personagens/party com `relations["f_<id>"].member === true` e NPCs com `memberOf` contendo o id.
- `getRank(faction, score)`: maior `minScore` ≤ score.
- Tokens não vinculados leem as flags pelo `token.actor` (ator sintético), respeitando eventuais deltas.

### 5.4 `src/module.json` (template)

```json
{
  "id": "tidy-renown",
  "title": "Tidy Renown – Facções & Reputação",
  "description": "Renome do DMG 2024 integrado ao Tidy 5e Sheets.",
  "version": "0.0.0",
  "compatibility": { "minimum": "14", "verified": "14" },
  "authors": [{ "name": "a definir" }],
  "esmodules": ["scripts/main.js"],
  "styles": ["styles/tidy-renown.css"],
  "languages": [
    { "lang": "en", "name": "English", "path": "lang/en.json" },
    { "lang": "pt-BR", "name": "Português (Brasil)", "path": "lang/pt-BR.json" }
  ],
  "socket": true,
  "relationships": {
    "systems": [
      { "id": "dnd5e", "type": "system", "compatibility": { "minimum": "6.0.0" } }
    ],
    "requires": [
      { "id": "tidy5e-sheet", "type": "module", "compatibility": { "minimum": "14.0.0" } }
    ]
  },
  "url": "https://github.com/OWNER/tidy-renown",
  "manifest": "",
  "download": ""
}
```

`version`, `manifest` e `download` são preenchidos pelo workflow. Antes da primeira release, confirmar a versão mínima exata do Tidy compatível com dnd5e 6.x na página de releases do Tidy e ajustar `verified` para o build do Foundry v14 testado.

---

## 6. Esteira de Build & Publish

### 6.1 Ferramentas
- Build: Vite (copia `module.json`, `lang/`, `templates/` e estilos para `dist/`).
- Tipos: `@league-of-foundry-developers/foundry-vtt-types` (conferir a versão que cobre v14).
- Lint: ESLint + Prettier.

### 6.2 Scripts `package.json`

```json
{
  "scripts": {
    "build": "vite build",
    "build:watch": "vite build --watch",
    "link": "node ./tools/link-foundry.mjs",
    "lint": "eslint src"
  }
}
```

### 6.3 Pré-requisitos de publicação no Foundry
1. O pacote `tidy-renown` precisa existir no site do Foundry (submissão inicial manual).
2. Na página do pacote, copiar o **Package Release Token** (campo acima de "Save Package"; começa com `fvttp_`).
3. Salvar no GitHub em *Settings → Secrets and variables → Actions* como `FOUNDRY_PACKAGE_TOKEN`.
4. O token permite editar o pacote: nunca commitar. Se vazar, usar o botão "Refresh" na página do pacote.

### 6.4 `.github/workflows/release.yml`

Disparo: publicação de uma Release no GitHub com tag `vX.Y.Z`.

Etapas:
1. Build.
2. Geração do `module.json` final.
3. Anexo dos artefatos à Release.
4. Validação na Package Release API com `dry-run`.
5. Publicação real (pula prereleases).

```yaml
name: Release

on:
  release:
    types: [published]

permissions:
  contents: write

env:
  MODULE_ID: tidy-renown
  FOUNDRY_API: https://foundryvtt.com/_api/packages/release_version/

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Extrair versão da tag
        id: meta
        run: |
          TAG="${{ github.event.release.tag_name }}"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "version=${TAG#v}" >> "$GITHUB_OUTPUT"

      - name: Instalar, lint e build
        run: |
          npm ci
          npm run lint
          npm run build

      - name: Gerar module.json final
        env:
          VERSION: ${{ steps.meta.outputs.version }}
          MANIFEST: https://github.com/${{ github.repository }}/releases/latest/download/module.json
          DOWNLOAD: https://github.com/${{ github.repository }}/releases/download/${{ steps.meta.outputs.tag }}/module.zip
        run: |
          jq --arg v "$VERSION" --arg m "$MANIFEST" --arg d "$DOWNLOAD" \
            '.version = $v | .manifest = $m | .download = $d' \
            src/module.json > dist/module.json

      - name: Empacotar
        run: cd dist && zip -r ../module.zip .

      - name: Anexar artefatos à Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload "${{ steps.meta.outputs.tag }}" dist/module.json module.zip --clobber

      - name: Montar payload da Package Release API
        env:
          VERSION: ${{ steps.meta.outputs.version }}
          # manifest da versão específica (não o /latest)
          RELEASE_MANIFEST: https://github.com/${{ github.repository }}/releases/download/${{ steps.meta.outputs.tag }}/module.json
          NOTES: ${{ github.event.release.html_url }}
        run: |
          jq -n \
            --arg id "$MODULE_ID" \
            --arg v "$VERSION" \
            --arg m "$RELEASE_MANIFEST" \
            --arg n "$NOTES" \
            --argjson c "$(jq '.compatibility | {minimum, verified, maximum: (.maximum // "")}' dist/module.json)" \
            '{id: $id, release: {version: $v, manifest: $m, notes: $n, compatibility: $c}}' \
            > payload.json
          cat payload.json

      - name: Validar no Foundry (dry-run)
        env:
          FOUNDRY_TOKEN: ${{ secrets.FOUNDRY_PACKAGE_TOKEN }}
        run: |
          jq '. + {"dry-run": true}' payload.json > payload-dry.json
          ./.github/scripts/foundry-release.sh payload-dry.json

      - name: Publicar no Foundry
        if: ${{ !github.event.release.prerelease }}
        env:
          FOUNDRY_TOKEN: ${{ secrets.FOUNDRY_PACKAGE_TOKEN }}
        run: ./.github/scripts/foundry-release.sh payload.json
```

### 6.5 `.github/scripts/foundry-release.sh`

Envia o payload, respeita o `Retry-After` em caso de `429` (limite de uma release por pacote a cada 60 s) e falha o job em qualquer resposta diferente de `status: success`.

```bash
#!/usr/bin/env bash
set -euo pipefail

PAYLOAD_FILE="$1"
API="${FOUNDRY_API:-https://foundryvtt.com/_api/packages/release_version/}"

send() {
  curl -sS -o response.json -D headers.txt -w '%{http_code}' \
    -X POST "$API" \
    -H 'Content-Type: application/json' \
    -H "Authorization: ${FOUNDRY_TOKEN}" \
    --data @"$PAYLOAD_FILE"
}

CODE=$(send)

if [ "$CODE" = "429" ]; then
  WAIT=$(grep -i '^retry-after:' headers.txt | tr -dc '0-9')
  echo "Limite de requisições; aguardando ${WAIT:-60}s"
  sleep "${WAIT:-60}"
  CODE=$(send)
fi

echo "HTTP $CODE"
cat response.json; echo

if [ "$CODE" != "200" ] || [ "$(jq -r '.status' response.json)" != "success" ]; then
  echo "::error::Falha na Package Release API do Foundry"
  exit 1
fi
```

Lembrar de `git update-index --chmod=+x .github/scripts/foundry-release.sh`.

**Formato da API (referência oficial)**
- `POST https://foundryvtt.com/_api/packages/release_version/`
- Header `Authorization: fvttp_...` e `Content-Type: application/json`.
- Corpo: `id` (obrigatório); `dry-run` (opcional; `true` valida sem salvar); `release.version` (obrigatório); `release.manifest` (obrigatório, URL da versão específica); `release.notes` (opcional); `release.compatibility.minimum` e `.verified` (obrigatórios), `.maximum` (opcional).
- Sucesso: `200` com `{"status": "success", "page": ...}`.
- Erros: `400` com `errors` por campo (ou `__all__`, ex.: versão duplicada) e `429` com `Retry-After`.

### 6.6 URLs no `module.json` publicado

```json
"manifest": "https://github.com/OWNER/tidy-renown/releases/latest/download/module.json",
"download": "https://github.com/OWNER/tidy-renown/releases/download/v1.0.0/module.zip"
```

### 6.7 Desenvolvimento local
1. `npm run build:watch`
2. `npm run link` → symlink de `dist/` para `Data/modules/tidy-renown`
3. Recarregar o mundo (F5)

---

## 7. Interface (UI/UX)

### 7.1 Gerenciador de grupos (GM)
- Lista em cards no estilo Tidy, com botão "Novo grupo".
- Formulário do grupo: dados básicos, ranks (com botão "Usar limiares do DMG") e textos de benefício.
- Lista de membros e relações (runtime) com ajuste rápido de score, alternância membro/não membro e drag-and-drop de atores do diretório.
- Ação rápida "Recalcular disposições" para forçar a seção 2.6.

### 7.2 Aba Renome – personagem / party
- Cabeçalho com título e botão "Gerenciar" (só GM).
- Card por grupo:
  - imagem e nome;
  - barra de progresso (positiva até `progressMax`; negativa em cor de alerta);
  - score, rank atual e próximo limiar;
  - benefícios já alcançados;
  - botões de ajuste (GM) ou +1 (jogador, se RF-03 ativo).
- Seção "Relações com NPCs" (relações individuais).

### 7.3 Aba Renome – NPC
- Grupos dos quais o NPC é membro (GM pode adicionar ou remover).
- Relações individuais com personagens.
- Score da party calculado e disposição resultante, com controle de trava.

### 7.4 Tema
Herdar claro/escuro e cor de destaque do Tidy; nenhuma cor absoluta no CSS.

---

## 8. Segurança e Permissões

| Ação | Quem pode |
|------|-----------|
| Criar, editar ou excluir grupos | GM |
| Alterar score, associação ou relações | GM |
| +1 no próprio personagem | Dono do ator, só com `playersCanIncrease` ativo e validado pelo GM via socket |
| Ver os próprios scores | Dono do ator |
| Ver relações de NPCs | GM; jogadores só com `showNpcRelationsToPlayers` |
| Atualizar disposição de tokens | Apenas o GM ativo |

- Todos os handlers verificam `game.user.isGM` ou `actor.isOwner`.
- O handler de socket nunca confia no payload: revalida dono, delta e teto no lado do GM.

---

## 9. Roadmap

| Versão | Entregas |
|--------|----------|
| **0.9 (MVP)** | CRUD de grupos, flags de relação, membros em runtime, abas do Tidy (personagem, party, NPC), edição pelo GM, pipeline completa com Package Release API. |
| **1.0** | Ranks configuráveis, relações negativas e individuais, disposição automática, opção de +1 por jogadores, i18n en/pt-BR, documentação. |
| **1.1** | Histórico de alterações de score; export/import de grupos; modo "Renome por nível" (RAW, seção 2.1); assistente de "Envolvimento com o grupo" (dias de downtime). |
| **1.2+** | Integração com Journal (missões de grupos), API pública do módulo. |

---

## 10. Critérios de Aceitação (MVP + 1.0)

- [ ] O módulo não registra nada se o Tidy 5e Sheets não estiver ativo.
- [ ] Só ativa em Foundry v14 com dnd5e 6.0.0+.
- [ ] GM cria um grupo, adiciona um personagem e ajusta o score em até 3 cliques.
- [ ] Score de membro nunca fica abaixo de 0; não membro e relação individual aceitam negativos.
- [ ] Lista de membros é derivada só das flags dos atores (nenhuma lista persistida no grupo).
- [ ] Aba Renome aparece nas fichas Tidy de personagem, party e NPC e respeita o tema.
- [ ] Com `autoDisposition` ativo, um NPC membro de um grupo com score da party `< −10` fica Hostil, `> 10` fica Amigável e, entre os dois, Neutro; tokens Secret ou travados não mudam.
- [ ] Com `playersCanIncrease` desligado (padrão), jogadores não alteram nada; ligado, só fazem +1 nos próprios personagens.
- [ ] Dados persistem após recarregar o mundo.
- [ ] Ao publicar uma Release `vX.Y.Z`, o workflow anexa `module.json` e `module.zip`, passa no dry-run e cria a versão no site do Foundry.
- [ ] `manifest` aponta para `/latest`; `download` e o manifest enviado à API apontam para a tag.
- [ ] Lint e build sem erros.

---

## 11. Referências

- D&D *Dungeon Master's Guide* (2024), capítulo 3 "DM's Toolbox", seção **Renown**.
- Tidy 5e Sheets: wiki "07. Developer API" e API gerada (`kgar.github.io/foundry-vtt-tidy-5e-sheets`), incluindo as referências de `TidyHooks` e `TidyFlags`.
- Foundry VTT: *Package Release API* (`foundryvtt.com/article/package-release-api/`).
- Foundry VTT: *Introduction to Module Development* e *Package Management*.
