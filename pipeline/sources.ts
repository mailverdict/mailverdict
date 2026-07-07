export type SourceKind = 'disposable' | 'free_provider' | 'allowlist' | 'role'

export interface Source {
  name: string
  kind: SourceKind
  /** Direct raw-file URL serving the list. */
  url: string
  /** Tried if the primary URL 404s (e.g. main vs master branch). */
  fallbackUrl?: string
  /** 'js-strings' extracts quoted string literals from a JS source file. */
  format: 'lines' | 'json' | 'js-strings'
  license: string
  repo: string
}

// Aggregated upstream lists — permissively licensed only (unlicensed and GPL
// repos are deliberately excluded). Per-source license and status recorded in
// data/meta.json on every build; credited in the README.
export const SOURCES: Source[] = [
  {
    name: 'disposable-email-domains',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf',
    format: 'lines',
    license: 'CC0-1.0',
    repo: 'https://github.com/disposable-email-domains/disposable-email-domains'
  },
  {
    // Upstream deleted allowlist.conf on 2026-04-12; this pins the last
    // commit that contained it. Complemented by the maintained groundcat list.
    name: 'disposable-email-domains/allowlist (pinned)',
    kind: 'allowlist',
    url: 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/02e480c6f933b8e5e0bc9695171f28cf3f7dbf50/allowlist.conf',
    format: 'lines',
    license: 'CC0-1.0',
    repo: 'https://github.com/disposable-email-domains/disposable-email-domains'
  },
  {
    name: 'disposable/disposable-email-domains',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt',
    fallbackUrl: 'https://disposable.github.io/disposable-email-domains/domains.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/disposable/disposable'
  },
  {
    name: 'groundcat/disposable-email-domain-list',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/groundcat/disposable-email-domain-list/master/domains.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/groundcat/disposable-email-domain-list'
  },
  {
    name: 'groundcat/allowlist',
    kind: 'allowlist',
    url: 'https://raw.githubusercontent.com/groundcat/disposable-email-domain-list/master/allowlist.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/groundcat/disposable-email-domain-list'
  },
  {
    name: 'mailchecker',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/FGRibreau/mailchecker/master/list.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/FGRibreau/mailchecker'
  },
  {
    name: 'burner-email-providers',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/wesbos/burner-email-providers/master/emails.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/wesbos/burner-email-providers'
  },
  {
    name: 'fakefilter',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/7c/fakefilter/main/txt/data.txt',
    format: 'lines',
    license: 'BSD-3-Clause',
    repo: 'https://github.com/7c/fakefilter'
  },
  {
    name: 'unkn0w/disposable-email-domain-list',
    kind: 'disposable',
    url: 'https://raw.githubusercontent.com/unkn0w/disposable-email-domain-list/main/domains.txt',
    format: 'lines',
    license: 'MIT',
    repo: 'https://github.com/unkn0w/disposable-email-domain-list'
  },
  {
    name: 'free-email-domains',
    kind: 'free_provider',
    url: 'https://raw.githubusercontent.com/Kikobeats/free-email-domains/master/domains.json',
    format: 'json',
    license: 'MIT',
    repo: 'https://github.com/Kikobeats/free-email-domains'
  },
  {
    // Canonical role-account list. The file is JS source (categorized string
    // arrays), so we extract string literals rather than line-splitting.
    name: 'role-based-email-addresses',
    kind: 'role',
    url: 'https://raw.githubusercontent.com/mixmaxhq/role-based-email-addresses/master/src/index.js',
    format: 'js-strings',
    license: 'MIT',
    repo: 'https://github.com/mixmaxhq/role-based-email-addresses'
  }
]
