import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Rota - App do motorista (Android)',
  description:
    'Download do aplicativo Android do Sistema Rota para os motoristas. Versao de teste, assinada com chave de debug.',
};

/**
 * Pagina de download do app do motorista.
 *
 * Por que o APK mora em `public/`: e o unico lugar que da um link permanente
 * sem depender de token de terceiros. GitHub Releases exigiria credencial,
 * Supabase Storage exigiria a service_role key que nao existe neste ambiente,
 * e servir pela API usaria a URL temporaria do tunnel — que morre junto com o
 * computador. O preco e o binario no git; assumido de proposito enquanto o
 * app e de teste. Quando existir keystore de release (pendencia P-04), o
 * destino passa a ser um Release versionado.
 */
const APK = '/sistema-rota.apk';

const REQUISITOS = [
  ['Android', '8.0 (API 26) ou superior'],
  ['Espaco', 'cerca de 40 MB instalado'],
  ['Permissoes', 'localizacao em primeiro plano, durante a jornada'],
] as const;

const PASSOS = [
  {
    n: '01',
    titulo: 'Libere a instalacao de fontes desconhecidas',
    corpo:
      'No celular, abra Ajustes › Apps › acesso especial › instalar apps desconhecidos e autorize o aplicativo que hizo o download (normalmente o navegador ou o WhatsApp).',
  },
  {
    n: '02',
    titulo: 'Abra o arquivo baixado',
    corpo:
      'Toque no arquivo .apk e confirme a instalacao. O Android avisa que o app veio de fora da loja: e esperado.',
  },
  {
    n: '03',
    titulo: 'Entre com a conta que a empresa cadastrou',
    corpo:
      'O app nao tem senha propria. Use o mesmo acesso do painel, com o perfil de motorista.',
  },
] as const;

export default function ApkPage() {
  return (
    <main className="flex min-h-screen flex-col bg-base">
      <header className="border-b border-border-subtle px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between">
          <span className="font-mono text-label uppercase tracking-widest text-accent">
            Rota
          </span>
          <Link
            href="/entrar"
            className="text-body text-ink-secondary transition-colors duration-DEFAULT hover:text-accent"
          >
            Painel administrativo
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12" id="conteudo">
        <h1 className="text-metric font-semibold text-ink">App do motorista</h1>
        <p className="mt-3 max-w-xl text-body text-ink-secondary">
          O aplicativo que o motorista usa durante a jornada: rota do dia, registro
          de chegada e de atendimento, e envio das posicoes mesmo sem sinal.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a
            href={APK}
            download="sistema-rota.apk"
            className="rounded-md bg-accent px-6 py-3 text-body font-semibold text-ink-inverse transition-opacity duration-DEFAULT hover:opacity-90"
          >
            Baixar o APK
          </a>
          <span className="font-mono text-label uppercase tracking-widest text-ink-muted">
            versao 1.0.0 &middot; android 8.0+
          </span>
        </div>

        <section className="mt-12">
          <h2 className="font-mono text-label uppercase tracking-widest text-ink-muted">
            Requisitos
          </h2>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-border-subtle bg-border-subtle sm:grid-cols-3">
            {REQUISITOS.map(([rotulo, valor]) => (
              <div key={rotulo} className="bg-surface px-4 py-3">
                <dt className="font-mono text-label uppercase tracking-widest text-ink-muted">
                  {rotulo}
                </dt>
                <dd className="mt-1 text-body text-ink">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12">
          <h2 className="font-mono text-label uppercase tracking-widest text-ink-muted">
            Como instalar
          </h2>
          <ol className="mt-4 grid gap-4">
            {PASSOS.map((p) => (
              <li
                key={p.n}
                className="flex gap-4 rounded-md border border-border-subtle bg-surface px-4 py-4"
              >
                <span className="font-mono text-label tabular text-accent">{p.n}</span>
                <span>
                  <span className="block text-body font-semibold text-ink">{p.titulo}</span>
                  <span className="mt-1 block text-body text-ink-secondary">{p.corpo}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 rounded-md border border-border-strong bg-raised px-5 py-5">
          <h2 className="text-body font-semibold text-status-warn">
            Esta e uma versao de teste
          </h2>
          <ul className="mt-3 grid gap-2 text-body text-ink-secondary">
            <li>
              O arquivo e assinado com chave de <strong className="text-ink">debug</strong>. Cada
              reinstalacao gera uma assinatura diferente, entao o Android pode pedir para
              desinstalar antes de reinstalar.
            </li>
            <li>
              Nao e distribuivel pela Play Store e nao deve ser usado com a frota em producao.
            </li>
            <li>
              O app conversa com a API pela rede. Enquanto o servidor da empresa nao estiver no
              ar, o login falha — o aplicativo abre normalmente, mas nao sincroniza.
            </li>
          </ul>
        </section>

        <footer className="mt-12 border-t border-border-subtle pt-6">
          <p className="text-body text-ink-muted">
            Dados de teste nas telas do app sao ficticios e assim estao marcados.{' '}
            <Link href="/entrar" className="text-accent hover:underline">
              Acessar o painel
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}