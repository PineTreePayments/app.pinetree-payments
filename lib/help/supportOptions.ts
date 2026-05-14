export const supportTicketCategories = [
  "Payment Issue",
  "Wallet Connection",
  "Dashboard Issue",
  "Settlement Question",
  "POS Issue",
  "Feature Request",
  "API Support",
  "General Support"
] as const

export const supportTicketPriorities = ["Low", "Normal", "High", "Urgent"] as const

export const feedbackTypes = [
  "Product Feedback",
  "Documentation Feedback",
  "Payment Experience",
  "Dashboard Experience",
  "Feature Request",
  "Other"
] as const

export type SupportTicketCategory = typeof supportTicketCategories[number]
export type SupportTicketPriority = typeof supportTicketPriorities[number]
export type FeedbackType = typeof feedbackTypes[number]
