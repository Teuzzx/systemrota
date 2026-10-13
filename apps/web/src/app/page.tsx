import { redirect } from 'next/navigation';

/**
 * Raiz do painel.
 *
 * O acesso comeca em /entrar: o token vive em memoria no navegador (nao em
 * cookie legivel por script), entao o servidor nao consegue saber, no primeiro
 * request, se a sessao esta ativa. Redirecionar para /entrar e a unica opcao
 * honesta no servidor — quem ja tem sessao e levado ao painel pela propria
 * tela de login.
 *
 * Sem esta pagina, abrir a raiz do dominio devolvia 404.
 */
export default function RootPage(): never {
  redirect('/entrar');
}