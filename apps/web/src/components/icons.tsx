/**
 * Icones de linha, desenhados no mesmo grid de 24px e com a mesma espessura
 * de traco da tipografia. Sem dependencia externa e sem emoji: o painel e uma
 * ferramenta de trabalho densa, nao um app de consumo.
 *
 * Regra: `aria-hidden` em tudo. O nome acessivel vem sempre do texto vizinho.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconGauge(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 18 0" />
      <path d="M12 12l4.5-3.2" />
      <circle cx={12} cy={12} r={1.4} />
      <path d="M3 12v3h18v-3" />
    </Icon>
  );
}

export function IconMap(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" />
      <path d="M9 4v13M15 6.5v13" />
    </Icon>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx={9} cy={8} r={3.2} />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 5.5" />
      <path d="M18 20a5.6 5.6 0 0 0-2.2-4.4" />
    </Icon>
  );
}

export function IconRoute(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx={5.5} cy={5.5} r={2.5} />
      <circle cx={18.5} cy={18.5} r={2.5} />
      <path d="M8 5.5h6.5A3.5 3.5 0 0 1 18 9v0a3.5 3.5 0 0 1-3.5 3.5h-5A3.5 3.5 0 0 0 6 16v0a2.5 2.5 0 0 0 2.5 2.5h7.5" />
    </Icon>
  );
}

export function IconStore(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
      <path d="M3 9.5 4.8 4.5h14.4L21 9.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
      <path d="M9.5 21v-6h5v6" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5.2l3.4 2" />
    </Icon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 16V11a6 6 0 1 0-12 0v5l-1.6 2.4h15.2L18 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 21h18" />
      <rect x={4.5} y={12} width={4} height={6} rx={0.5} />
      <rect x={10} y={7} width={4} height={11} rx={0.5} />
      <rect x={15.5} y={10} width={4} height={8} rx={0.5} />
    </Icon>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </Icon>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </Icon>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx={11} cy={11} r={6.5} />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.8 2.6 20h18.8L12 3.8z" />
      <path d="M12 10v4.4" />
      <circle cx={12} cy={17.4} r={0.9} fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  );
}

export function IconWifi(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 9a15 15 0 0 1 19 0" />
      <path d="M5.5 12.5a10.5 10.5 0 0 1 13 0" />
      <path d="M8.7 16a6 6 0 0 1 6.6 0" />
      <circle cx={12} cy={19.5} r={1.1} fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconWifiOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 9a15 15 0 0 1 5.2-3.2" />
      <path d="M21.5 9a15 15 0 0 0-7.6-3.6" />
      <path d="M5.5 12.5a10.5 10.5 0 0 1 4-2.2" />
      <path d="M18.5 12.5a10.5 10.5 0 0 0-2.6-1.9" />
      <path d="M8.7 16a6 6 0 0 1 4.6-.6" />
      <circle cx={12} cy={19.5} r={1.1} fill="currentColor" stroke="none" />
      <path d="M3.5 3.5 20.5 20.5" />
    </Icon>
  );
}