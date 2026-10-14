/** 出典へのリンク。http(s) 以外の URL はリンクにしない */
export function SourceLink({ title, url }: { title: string; url: string }) {
  const label = title || hostOf(url);
  if (!/^https?:\/\//i.test(url)) return <span>{label}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url}>
      {label}
    </a>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
