/**
 * Declaracoes para os modulos de extensao do PGlite.
 *
 * O PGlite expoe as extensoes contrib pelo "exports" do pacote, que o
 * `moduleResolution: node` classico nao resolve. A alternativa seria subir o
 * tsconfig para node16/nodenext (mudando a semantica do projeto inteiro),
 * entao declaramos apenas estes modulos.
 */
declare module '@electric-sql/pglite/contrib/pg_trgm' {
  export const pg_trgm: {
    name: string;
    setup: (pg: unknown, emscriptenOpts: unknown) => Promise<{ bundlePath: URL }>;
  };
}
