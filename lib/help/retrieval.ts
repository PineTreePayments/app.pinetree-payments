import { helpArticles, type HelpArticle } from "./helpContent"

export type HelpSearchResult = {
  article: HelpArticle
  score: number
  snippet: string
}

function normalize(value: string) {
  return value.toLowerCase().trim()
}

function scoreArticle(article: HelpArticle, terms: string[]) {
  const haystack = normalize([
    article.title,
    article.category,
    article.description,
    article.body,
    article.tags.join(" ")
  ].join(" "))

  return terms.reduce((score, term) => {
    if (!term) return score
    if (normalize(article.title).includes(term)) return score + 5
    if (normalize(article.tags.join(" ")).includes(term)) return score + 3
    return haystack.includes(term) ? score + 1 : score
  }, 0)
}

function buildSnippet(article: HelpArticle, terms: string[]) {
  const body = article.body.trim()
  const normalizedBody = normalize(body)
  const firstMatch = terms
    .map((term) => normalizedBody.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]

  if (firstMatch === undefined) return article.description

  const start = Math.max(0, firstMatch - 48)
  const snippet = body.slice(start, start + 180).trim()
  return `${start > 0 ? "... " : ""}${snippet}${start + 180 < body.length ? " ..." : ""}`
}

export function searchHelpArticles(query: string, limit = 5): HelpSearchResult[] {
  const terms = normalize(query)
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) {
    return helpArticles.slice(0, limit).map((article) => ({
      article,
      score: 0,
      snippet: article.description
    }))
  }

  return helpArticles
    .map((article) => {
      const score = scoreArticle(article, terms)
      return {
        article,
        score,
        snippet: buildSnippet(article, terms)
      }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
