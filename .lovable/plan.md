# Plano — Xis Photo Booth: novos recursos avançados

Escopo grande e com várias mudanças estruturais. Abaixo o plano completo antes de implementar.

## 1. Base de dados (migração única)

Novas tabelas / colunas no backend:

- `generic_frames` — biblioteca global de molduras (id, name, image_url, created_by, created_at). Leitura pública por admins autenticados; escrita apenas para Super Admin (Master).
- `event_frames` — vínculo N:N entre eventos e molduras usadas (id, event_id, frame_url, name, source `generic|custom`, position). Leitura pública; escrita apenas pelo dono do evento ou master.
- `events` — nova coluna `instagram_filter_url text null`.
- Bucket público `generic-frames` (para as molduras da biblioteca global).
- Realtime habilitado em `photos` (para o modo slideshow ao vivo).
- Políticas RLS + GRANTs adequados; sem quebrar as regras já existentes.

## 2. Molduras & overlays

- **Master**: nova aba/página em `/master` "Biblioteca de Molduras" — upload PNG + nome, listar, excluir.
- **Admin - criar/editar evento**: seletor múltiplo. Pode escolher várias molduras da biblioteca global e/ou fazer upload de PNGs próprios; podem ser combinadas. Também mantém o `logo_url` já existente e ganha campo `instagram_filter_url`.
- **Guest — seletor de moldura antes de capturar**:
  1. Escolher entre as molduras disponíveis do evento
  2. "Somente logo" (aplica só o logo no canto pré-definido)
  3. "Sem overlay" (foto limpa)
- A composição atual (`composeStrip` etc.) passa a receber a escolha do guest e aplica o overlay correto sobre foto ou vídeo.

## 3. Filtros de câmera ao vivo (guest)

- Barra de filtros na tela de captura: Normal, Vintage/Sépia, P&B, Vibrante, Soft Glow.
- Aplicados via CSS `filter` no `<video>` preview em tempo real.
- Ao capturar, o mesmo filtro é reaplicado via `ctx.filter` no canvas antes da moldura, para "queimar" o efeito nas fotos e nos vídeos gravados (para vídeo enviado, aplica no transcode existente).

## 4. Cartaz / QR do evento (admin)

- Nova página `/admin/event/:slug/card` (ou modal) com layout A4 pronto para impressão:
  - Título "Que bom que você veio!!!"
  - Instrução principal
  - QR code central (biblioteca `qrcode`) apontando para `/event/:slug`
  - Bullets ("Tirar fotos e compartilhar", "Ver fotos da festa", "Pegue suas fotos impressas")
  - Rodapé com o logo Xis Photo Booth
- Botão "Imprimir Card" com CSS `@page A4` + `@media print` escondendo cromo.

## 5. Slideshow ao vivo (`/event/$slug/live`)

- Rota pública nova em `src/routes/event.$slug.live.tsx`.
- Assina `postgres_changes` em `photos` filtrando por `event_id`, mantém ordenação, pré-carrega imagens novas.
- Carrossel full-screen com transições suaves (fade/scale via Tailwind + `key` animado), oculta chrome, dark background, mostra novo item ao entrar.
- Vídeos entram como thumbnail estático (poster) para não interromper o loop.

## 6. Exportações estendidas

- **ZIP de álbum**: usa `jszip` — botão "Baixar tudo (ZIP)" no admin e na galeria pública, baixa fotos e vídeos com nomes numerados.
- **PDF de álbum**: usa `jspdf` — grade limpa (3 por linha em A4 retrato) com todas as fotos; ignora vídeos ou lista como placeholder.
- Botão de download individual permanece.

## 7. Filtro do Instagram

- Campo no editor de evento: `instagram_filter_url` (validação básica de URL).
- Tela de boas-vindas do guest: se houver URL, exibe botão "Abrir Filtro no Instagram" que abre em nova aba.

## Detalhes técnicos

- Bibliotecas novas: `qrcode`, `jszip`, `jspdf` (via `bun add`).
- Realtime: adiciona `photos` ao publicação `supabase_realtime`.
- Storage: bucket `generic-frames` público; `event-frames` continua para custom uploads.
- RLS: `generic_frames` — SELECT authenticated, ALL para super admin; `event_frames` — SELECT público, ALL para dono via join com `events.owner_id` + master.
- Migração inclui `GRANT` em todas as novas tabelas conforme regra do projeto.
- Todas as strings em pt-BR mantendo o tema atual (teal/creme/dourado).

## Ordem de execução

1. Migração DB + buckets + realtime.
2. Instalar `qrcode`, `jszip`, `jspdf`.
3. Página Master "Biblioteca de Molduras".
4. Admin: seleção múltipla de molduras + campo Instagram + página do cartaz A4.
5. Guest: seletor de moldura + filtros ao vivo + botão Instagram.
6. Rota `/event/$slug/live` com Realtime.
7. Exportações ZIP + PDF nos painéis admin e público.

Confirma para eu seguir? É uma implementação grande (várias telas + migração), então prefiro validar antes de escrever tudo.
