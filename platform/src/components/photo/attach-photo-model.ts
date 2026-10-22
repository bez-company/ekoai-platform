// attach-photo-model.ts: o que o bloco "Anexar foto" do Criar post entrega (SPEC 017 decisão 7,
// BEZ-237). Puro, entra no bundle do navegador.

import type { PhotoUsage } from '@/lib/photo-question-model';

export type AttachedPhoto = {
  assetId: string;
  url: string;
  usage: PhotoUsage | null;
  text: string | null; // sugestão escolhida em "O que escrever?"; null = "Escrever eu" ou não perguntado
  ready: boolean; // o uso da foto está definido: dá para mandar o pedido
};

// A ideia que vai no POST /api/posts: o que a pessoa escreveu mais o texto escolhido para a imagem.
export function ideaWithPhotoText(idea: string, text: string | null): string {
  const base = idea.trim();
  if (!text) return base;
  return base ? `${base}. Texto da imagem: ${text}` : `Texto da imagem: ${text}`;
}

// Os campos do pedido de post para a foto, quando o uso está escolhido.
export function photoRequestFields(v: AttachedPhoto | null): { asset_id: string; photo_usage: PhotoUsage } | Record<string, never> {
  return v && v.ready && v.usage ? { asset_id: v.assetId, photo_usage: v.usage } : {};
}
