import { searchHelpArticles } from "@/lib/help/retrieval"

export type HelpAssistantDraftAnswer = {
  enabled: false
  question: string
  answer: string
  sources: Array<{
    id: string
    title: string
    snippet: string
  }>
}

export function answerHelpQuestion(question: string): HelpAssistantDraftAnswer {
  const cleanedQuestion = String(question || "").trim()
  const results = searchHelpArticles(cleanedQuestion, 3)

  return {
    enabled: false,
    question: cleanedQuestion,
    answer: results.length > 0
      ? "PineTree Assistant is not enabled yet. This preview only returns matching PineTree help documentation and does not generate an AI response."
      : "PineTree Assistant is not enabled yet. No local help documentation matched this question.",
    sources: results.map((result) => ({
      id: result.article.id,
      title: result.article.title,
      snippet: result.snippet
    }))
  }
}
