import { searchHelpArticles } from "@/lib/help/retrieval"

export type HelpAssistantDraftAnswer = {
  enabled: false
  answer: string
  sources: Array<{
    id: string
    title: string
    snippet: string
  }>
}

export function answerHelpQuestion(question: string): HelpAssistantDraftAnswer {
  const results = searchHelpArticles(question, 3)

  return {
    enabled: false,
    answer: "PineTree Assistant is not enabled yet. When enabled, answers will be grounded in PineTree documentation, transaction states, and merchant account context.",
    sources: results.map((result) => ({
      id: result.article.id,
      title: result.article.title,
      snippet: result.snippet
    }))
  }
}
