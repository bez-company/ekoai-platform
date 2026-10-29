// library/index.ts: a biblioteca de modelos de post como dado tipado (SPEC 030, BEZ-477). Importação estática: o empacotamento do job
// (esbuild) leva os JSON junto. Um teste confere que todo arquivo da pasta está aqui; ao incluir um template, inclua a linha.

import type { PostTemplate } from '../model';

import t_antes_depois_1 from './antes-depois-1.json';
import t_antes_depois_2 from './antes-depois-2.json';
import t_bilhete_e_notas_1 from './bilhete-e-notas-1.json';
import t_bilhete_e_notas_2 from './bilhete-e-notas-2.json';
import t_capa_de_revista_1 from './capa-de-revista-1.json';
import t_capa_de_revista_2 from './capa-de-revista-2.json';
import t_cartaz_retro_1 from './cartaz-retro-1.json';
import t_cartaz_retro_2 from './cartaz-retro-2.json';
import t_cartaz_tipografico_1 from './cartaz-tipografico-1.json';
import t_cartaz_tipografico_2 from './cartaz-tipografico-2.json';
import t_cena_cotidiana_1 from './cena-cotidiana-1.json';
import t_cena_cotidiana_2 from './cena-cotidiana-2.json';
import t_citacao_grande_1 from './citacao-grande-1.json';
import t_citacao_grande_2 from './citacao-grande-2.json';
import t_colagem_editorial_3 from './colagem-editorial-3.json';
import t_colagem_editorial_4 from './colagem-editorial-4.json';
import t_diagrama_didatico_1 from './diagrama-didatico-1.json';
import t_diagrama_didatico_2 from './diagrama-didatico-2.json';
import t_grade_modular_1 from './grade-modular-1.json';
import t_grade_modular_2 from './grade-modular-2.json';
import t_ilustracao_geometrica_1 from './ilustracao-geometrica-1.json';
import t_mockup_anotado_1 from './mockup-anotado-1.json';
import t_numero_gigante_1 from './numero-gigante-1.json';
import t_numero_gigante_3 from './numero-gigante-3.json';
import t_objeto_heroi_1 from './objeto-heroi-1.json';
import t_objeto_heroi_2 from './objeto-heroi-2.json';
import t_surreal_fotografico_1 from './surreal-fotografico-1.json';
import t_surreal_fotografico_2 from './surreal-fotografico-2.json';

export const TEMPLATE_LIBRARY: PostTemplate[] = [
  t_antes_depois_1 as PostTemplate,
  t_antes_depois_2 as PostTemplate,
  t_bilhete_e_notas_1 as PostTemplate,
  t_bilhete_e_notas_2 as PostTemplate,
  t_capa_de_revista_1 as PostTemplate,
  t_capa_de_revista_2 as PostTemplate,
  t_cartaz_retro_1 as PostTemplate,
  t_cartaz_retro_2 as PostTemplate,
  t_cartaz_tipografico_1 as PostTemplate,
  t_cartaz_tipografico_2 as PostTemplate,
  t_cena_cotidiana_1 as PostTemplate,
  t_cena_cotidiana_2 as PostTemplate,
  t_citacao_grande_1 as PostTemplate,
  t_citacao_grande_2 as PostTemplate,
  t_colagem_editorial_3 as PostTemplate,
  t_colagem_editorial_4 as PostTemplate,
  t_diagrama_didatico_1 as PostTemplate,
  t_diagrama_didatico_2 as PostTemplate,
  t_grade_modular_1 as PostTemplate,
  t_grade_modular_2 as PostTemplate,
  t_ilustracao_geometrica_1 as PostTemplate,
  t_mockup_anotado_1 as PostTemplate,
  t_numero_gigante_1 as PostTemplate,
  t_numero_gigante_3 as PostTemplate,
  t_objeto_heroi_1 as PostTemplate,
  t_objeto_heroi_2 as PostTemplate,
  t_surreal_fotografico_1 as PostTemplate,
  t_surreal_fotografico_2 as PostTemplate,
];
