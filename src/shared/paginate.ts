/** ページ送り。page が範囲外（削除で件数が減ったときなど）なら最後のページに寄せる */
export function paginate<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(current * size, (current + 1) * size), page: current, pages };
}
